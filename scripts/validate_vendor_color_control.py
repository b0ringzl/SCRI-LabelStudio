"""Vendor-colored map/image consistency control; not independent calibration truth."""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import cv2
import numpy as np

from prepare_vmms_sample import world_from_flu
from validate_extrinsics import hypotheses, project, sample_image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cloud', required=True, type=Path)
    parser.add_argument('--vmms-parent', required=True, type=Path)
    parser.add_argument('--frames', required=True, type=Path)
    parser.add_argument('--extrinsics', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--stream', default='hewentian_pano')
    parser.add_argument('--frame-ids', nargs='+', default=['004319', '004335', '004338', '004374'])
    args = parser.parse_args()
    with args.cloud.open('rb') as f:
        header = {}
        while True:
            raw = f.readline()
            if not raw: raise ValueError('Incomplete cloud header')
            key, _, value = raw.decode('ascii').strip().partition(' '); header[key] = value
            if key == 'DATA': break
        if header['DATA'] != 'binary' or header['FIELDS'] != 'x y z rgb': raise ValueError('Require packed binary XYZRGB')
        data = f.read()
    dtype = np.dtype([('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('rgb', '<u4')])
    if len(data) != int(header['POINTS'])*dtype.itemsize: raise ValueError('Cloud payload size mismatch')
    cloud = np.frombuffer(data, dtype=dtype)
    xyz = np.column_stack([cloud[k] for k in ('x', 'y', 'z')]).astype(float)
    packed = cloud['rgb']; colors = np.column_stack([(packed >> n) & 255 for n in (16, 8, 0)]).astype(float)
    with args.frames.open(encoding='utf-8-sig') as f:
        frames = {r['frame_id']: r for r in csv.DictReader(f) if r['stream_id'] == args.stream}
    with args.extrinsics.open(encoding='utf-8-sig') as f: rows = list(csv.DictReader(f))
    if len(rows) != 1: raise ValueError('Require one CSV row')
    candidates = hypotheses(rows[0]); results = []
    zero = np.diag([-1., -1., 1., 1.])
    for frame_id in args.frame_ids:
        row = frames[frame_id]
        raw = cv2.imdecode(np.fromfile(args.vmms_parent/row['source_image_relpath'], dtype=np.uint8), cv2.IMREAD_COLOR)
        image = cv2.cvtColor(cv2.resize(raw, (2048, 1024), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(float)
        position = np.asarray([float(row[k]) for k in ('local_x', 'local_y', 'local_z')])
        rotation = np.asarray(world_from_flu(*(float(row[k]) for k in ('roll_rad', 'pitch_rad', 'heading_rad'))))
        body = (xyz-position) @ rotation; radius = np.linalg.norm(body, axis=1)
        selected = np.flatnonzero(np.isfinite(body).all(1) & (radius >= 3) & (radius <= 80))
        if len(selected) > 100000: selected = selected[np.linspace(0, len(selected)-1, 100000).astype(int)]
        body, color = body[selected], colors[selected]
        chroma = color / np.maximum(color.sum(1, keepdims=True), 20.)

        def score(transform, mirror=False, shift=0.):
            camera = (body-transform[:3, 3]) @ transform[:3, :3]
            u, v, depth = project(camera, 2048, 1024, (mirror, False, shift))
            pixel = np.floor(v).astype(int)*2048+np.floor(u).astype(int)
            order = np.lexsort((depth, pixel)); sorted_pixel = pixel[order]
            ids = order[np.r_[True, sorted_pixel[1:] != sorted_pixel[:-1]]]
            observed = np.column_stack([sample_image(image[:, :, channel], u[ids], v[ids]) for channel in range(3)])
            observed_chroma = observed/np.maximum(observed.sum(1, keepdims=True), 20.)
            return {'rgbMae': float(np.mean(np.abs(observed-color[ids]))),
                    'chromaMae': float(np.mean(np.abs(observed_chroma-chroma[ids]))), 'pixels': len(ids)}

        curve = []
        for mirror in (False, True):
            for shift in range(0, 360, 2):
                curve.append({'mirror': mirror, 'longitudeShiftDeg': shift, **score(np.eye(4), mirror, shift)})
        best = min(curve, key=lambda r: r['chromaMae'])
        base = score(zero)
        comparison = []
        for c in candidates:
            for chain, transform in (('zero_then_csv', zero@c['matrix']), ('csv_then_zero', c['matrix']@zero)):
                comparison.append({'hypothesis': c['id'], 'chain': chain, **score(transform)})
        comparison.sort(key=lambda r: r['chromaMae'])
        results.append({'frameId': frame_id, 'sourceImage': row['source_image_relpath'], 'bestColorOrientationProxy': best,
                        'baselineZero180': base, 'csvComparisons': comparison, 'orientationCurve': curve})
        print(frame_id, 'color orientation proxy=', best, 'zero180=',base, 'best CSV=',comparison[0], flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'vendor_color_control.json').write_text(json.dumps({'applyRecommended': False,
        'warning': 'Colorized cloud may originate from the tested image; color agreement is a consistency control, not independent pose truth or proof of CSV provenance.',
        'stream': args.stream, 'frames': results}, indent=2), encoding='utf-8')


if __name__ == '__main__': main()
