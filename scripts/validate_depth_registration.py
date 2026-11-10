"""Run the real DA2 checkpoint on a local scene, retaining read-only evidence.

Survey imagery/results are written only under ignored local-samples. No source
pose, annotation or survey data is modified; no accuracy ground truth assumed.
"""
from __future__ import annotations
import argparse
import base64
import json
import sys
from pathlib import Path
import cv2
import numpy as np
from scipy.spatial.transform import Rotation
from pointcloud_io import open_binary, xyz
from depth_worker import solve

ROOT = Path(__file__).resolve().parents[1]


def payload_for(scene, frame_name=None):
    folder = ROOT/'local-samples/generalization-suite'/scene
    frames = json.loads((folder/'registration.json').read_text(encoding='utf-8'))['frames']
    frame = next((f for f in frames if f['image']==frame_name), None) if frame_name else frames[len(frames)//2]
    if frame is None:
        raise ValueError('Frame not found')
    matrix = np.asarray(frame['cameraToCloud']).reshape(4, 4)
    prior = {'position': matrix[:3, 3].tolist(),
             'rotation': Rotation.from_matrix(matrix[:3, :3]).as_euler('YXZ', degrees=True).tolist()}
    cloud, _ = open_binary(folder/'scene-cloud.pcd')
    points = xyz(cloud[::max(1, int(np.ceil(len(cloud)/180000)))])
    distance = np.linalg.norm(points-matrix[:3, 3], axis=1)
    points = points[np.isfinite(points).all(1) & (distance>1.5) & (distance<75)]
    if len(points)>28000:
        points = points[np.floor(np.arange(28000)*len(points)/28000).astype(int)]
    image = cv2.imdecode(np.frombuffer((folder/'panoramas'/frame['image']).read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    image = cv2.resize(image, (1536, 768), interpolation=cv2.INTER_AREA)
    encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 94])[1]
    return {'schemaVersion': 'registration-depth/1.0', 'frameId': frame['image'], 'prior': prior,
            'points': points.tolist(), 'imageDataUrl': 'data:image/jpeg;base64,'+base64.b64encode(encoded).decode()}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', default='floor6')
    parser.add_argument('--frame')
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--compact', action='store_true')
    args = parser.parse_args()
    payload = payload_for(args.scene, args.frame)
    if args.fixture:
        print(json.dumps(payload))
        return
    output = ROOT/'local-samples/depth-registration-validation'/args.scene/Path(payload['frameId']).stem
    output.mkdir(parents=True, exist_ok=True)
    result = solve(payload)
    (output/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    (output/'depth-preview.jpg').write_bytes(base64.b64decode(result['depthPreviewDataUrl'].split(',', 1)[1]))
    (output/'panorama.jpg').write_bytes(base64.b64decode(payload['imageDataUrl'].split(',', 1)[1]))
    summary = {key: value for key, value in result.items() if key!='depthPreviewDataUrl'}
    if args.compact:
        summary = {key: result[key] for key in ('frameId', 'status', 'metrics', 'inference', 'cacheHit')}
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
