"""Compare unverified CSV interpretations on local VMMS data; never apply poses.

Requires numpy, scipy and opencv-python in an isolated Python environment.
Outputs contain private survey derivatives and must remain outside Git.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree

from prepare_vmms_sample import DEFAULT_FRAMES, DEFAULT_VMMS, world_from_flu


def csv_matrix(row, angle_mode='degrees', scale=1.0):
    if angle_mode not in ('degrees', 'raw_values_as_radians'):
        raise ValueError('Unknown angle interpretation')
    a = np.asarray([float(row[k]) for k in ('roll_deg', 'pitch_deg', 'yaw_deg')])
    t = np.asarray([float(row[k]) for k in ('tx', 'ty', 'tz')])
    if not np.isfinite(a).all() or not np.isfinite(t).all() or not math.isfinite(scale) or scale <= 0:
        raise ValueError('CSV values and unit scale must be finite; scale must be positive')
    if angle_mode == 'degrees':
        a = np.deg2rad(a)
    x, y, z = a
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    out = np.eye(4)
    out[:3, :3] = [[cz*cy, sx*sy*cz-cx*sz, cx*sy*cz+sx*sz],
                  [sz*cy, sx*sy*sz+cx*cz, cx*sy*sz-sx*cz],
                  [-sy, sx*cy, cx*cy]]
    out[:3, 3] = t*scale
    return out


def hypotheses(row):
    bases = {'FLU': np.eye(3), 'FRU': np.diag([1., -1., 1.]),
             'RDF_optical': np.asarray([[0., 0., 1.], [-1., 0., 0.], [0., -1., 0.]]),
             'viewer_RUB': np.asarray([[0., 0., -1.], [-1., 0., 0.], [0., 1., 0.]])}
    result = [{'id': 'identity', 'matrix': np.eye(4), 'angle': 'none', 'unit': 'none', 'direction': 'none', 'axes': 'FLU'}]
    for angle in ('degrees', 'raw_values_as_radians'):
        for unit, scale in (('m', 1.), ('cm', .01), ('mm', .001)):
            source = csv_matrix(row, angle, scale)
            for direction in ('camera_to_body', 'inverse'):
                transform = source if direction == 'camera_to_body' else np.linalg.inv(source)
                for axes, basis in bases.items():
                    b = np.eye(4); b[:3, :3] = basis
                    matrix = b @ transform @ b.T
                    result.append({'id': f'{angle}/{unit}/{direction}/{axes}', 'matrix': matrix,
                                   'angle': angle, 'unit': unit, 'direction': direction, 'axes': axes})
    return result


def load_map(vmms, cache):
    files = sorted((vmms/'pointcloud'/'mapping').glob('pointcloud_DS_*.pcd'))
    fingerprint = [{'name': p.name, 'bytes': p.stat().st_size, 'mtimeNs': p.stat().st_mtime_ns} for p in files]
    cache.mkdir(parents=True, exist_ok=True)
    meta = cache/'map-cache.json'; data = cache/'map.npy'
    if meta.is_file() and data.is_file() and json.loads(meta.read_text()) == fingerprint:
        return np.load(data, mmap_mode='r'), fingerprint
    chunks = []
    for path in files:
        with path.open('rb') as stream:
            header = {}
            while True:
                raw = stream.readline()
                if not raw: raise ValueError(f'Missing PCD DATA header: {path.name}')
                line = raw.decode('ascii').strip()
                if not line: continue
                key, _, value = line.partition(' '); header[key] = value
                if key == 'DATA': break
            if header['DATA'] != 'ascii' or header['FIELDS'].split() != ['x', 'y', 'z', 'intensity']:
                raise ValueError(f'Unsupported map format: {path.name}')
            points = np.loadtxt(stream, dtype=np.float32, ndmin=2)
            if len(points) != int(header['POINTS']) or not np.isfinite(points).all():
                raise ValueError(f'Point count/nonfinite data: {path.name}')
            chunks.append(points)
            print(f'Loaded {path.name}: {len(points)} points', flush=True)
    if not chunks: raise ValueError('No DS intensity maps found')
    np.save(data, np.concatenate(chunks))
    meta.write_text(json.dumps(fingerprint), encoding='utf-8')
    return np.load(data, mmap_mode='r'), fingerprint


def entropy(p):
    p = p[p > 0]
    return float(-np.sum(p*np.log(p)))


def nid(gray, intensity_bins):
    image_bins = np.clip((gray*16/256).astype(np.int32), 0, 15)
    hist = np.bincount(image_bins*16+intensity_bins, minlength=256).reshape(16, 16).astype(float)
    hist /= hist.sum()
    joint = entropy(hist)
    return 1-(entropy(hist.sum(0))+entropy(hist.sum(1))-joint)/joint if joint > 0 else 1.


def project(points, width, height, orientation=(False, False, 0.)):
    radius = np.linalg.norm(points, axis=1)
    u = .5-np.arctan2(points[:, 1], points[:, 0])/(2*np.pi)
    v = .5-np.arctan2(points[:, 2], np.hypot(points[:, 0], points[:, 1]))/np.pi
    mirror, flip, shift = orientation
    if mirror: u = 1-u
    if flip: v = 1-v
    u = (u+shift/360) % 1
    return u*width, np.clip(v*height, 0, height-1.001), radius


def visible(points, intensity_bins, width, height, orientation):
    u, v, radius = project(points, width, height, orientation)
    keep = (radius > 3) & (radius < 55) & (v > height*.17) & (v < height*.83)
    ids = np.flatnonzero(keep)
    pixel = np.floor(v[ids]).astype(int)*width+np.floor(u[ids]).astype(int)
    order = np.argsort(radius[ids])
    _, first = np.unique(pixel[order], return_index=True)
    ids = ids[order[first]]
    return ids, u[ids], v[ids], intensity_bins[ids]


def sample_image(image, u, v):
    h, w = image.shape
    x = np.floor(u).astype(int); y = np.floor(v).astype(int)
    wx, wy = u-x, v-y
    return ((1-wy)*((1-wx)*image[y, x % w]+wx*image[y, (x+1) % w])+
            wy*((1-wx)*image[np.minimum(y+1, h-1), x % w]+wx*image[np.minimum(y+1, h-1), (x+1) % w]))


def geometry_edges(points):
    w, h = 512, 256
    ids, u, v, _ = visible(points, np.zeros(len(points), dtype=int), w, h, (False, False, 0.))
    depth = np.zeros((h, w), dtype=np.float32)
    indexes = np.full((h, w), -1, dtype=int)
    y, x = v.astype(int), u.astype(int)
    depth[y, x] = np.linalg.norm(points[ids], axis=1); indexes[y, x] = ids
    distance, nearest = distance_transform_edt(depth == 0, return_indices=True)
    filled = depth[tuple(nearest)]
    delta_x = np.abs(np.roll(filled, 1, axis=1)-np.roll(filled, -1, axis=1))
    delta_y = np.abs(np.roll(filled, 1, axis=0)-np.roll(filled, -1, axis=0))
    mask = (distance < 1.5) & ((delta_x+delta_y) > np.maximum(1.5, .15*filled))
    mask[:int(h*.25)] = False; mask[int(h*.65):] = False
    edge_ids = np.unique(indexes[tuple(nearest[:, mask])])
    edge_ids = edge_ids[edge_ids >= 0]
    return points[edge_ids]


def metrics(frame, transform, orientation):
    camera = (frame['body']-transform[:3, 3]) @ transform[:3, :3]
    ids, u, v, bins = visible(camera, frame['bins'], frame['w'], frame['h'], orientation)
    value = nid(sample_image(frame['gray'], u, v), bins)
    edge_camera = (frame['edges']-transform[:3, 3]) @ transform[:3, :3]
    eu, ev, _ = project(edge_camera, frame['w'], frame['h'], orientation)
    distance = sample_image(frame['edge_dt'], eu, ev)*360/frame['w']
    # A chamfer-to-image-edge proxy, not true reprojection/pose error.
    edge_proxy = float(np.mean(np.minimum(distance, 4.))) if len(distance) else None
    baseline = frame['body']
    cos = np.sum(baseline*camera, axis=1)/(np.linalg.norm(baseline, axis=1)*np.linalg.norm(camera, axis=1))
    angular_shift = np.rad2deg(np.arccos(np.clip(cos, -1., 1.)))
    return {'nid': value, 'edgeChamferProxyDeg': edge_proxy, 'visiblePoints': len(ids),
            'rayShiftMedianDeg': float(np.median(angular_shift)), 'rayShiftP95Deg': float(np.percentile(angular_shift, 95))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vmms', type=Path, default=DEFAULT_VMMS)
    parser.add_argument('--frames', type=Path, default=DEFAULT_FRAMES)
    parser.add_argument('--extrinsics', type=Path, default=Path.home()/'Desktop'/'extrinsics_per_pair_6dof.csv')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'local-samples'/'extrinsics-validation')
    parser.add_argument('--cache', type=Path, help='Optional shared derived map cache')
    parser.add_argument('--stream', default='jianshazui_pano_1')
    parser.add_argument('--count', type=int, default=20)
    parser.add_argument('--max-points', type=int, default=30000)
    parser.add_argument('--image-width', type=int, default=2048)
    parser.add_argument('--yaw-step', type=int, default=4)
    args = parser.parse_args()
    if args.count < 4 or args.image_width % 2 or not 256 <= args.image_width <= 8192 or not 1 <= args.yaw_step <= 30 or args.max_points < 1024:
        raise ValueError('Require >=4 frames, >=1024 points, even width 256..8192, yaw step 1..30')
    args.output.mkdir(parents=True, exist_ok=True)
    with args.extrinsics.open(encoding='utf-8-sig', newline='') as f: rows = list(csv.DictReader(f))
    if len(rows) != 1: raise ValueError('This probe expects exactly one CSV parameter row')
    candidates = hypotheses(rows[0])
    points, sources = load_map(args.vmms, args.cache or args.output/'cache')
    tree = cKDTree(points[:, :2])
    with args.frames.open(encoding='utf-8-sig', newline='') as f:
        poses = [r for r in csv.DictReader(f) if r['stream_id'] == args.stream]
    positions = np.asarray([[float(r[k]) for k in ('local_x', 'local_y', 'local_z')] for r in poses])
    counts = tree.query_ball_point(positions[:, :2], 40., return_length=True)
    eligible = np.flatnonzero(counts >= 5000)
    if len(eligible) < 4: raise ValueError('Fewer than four trajectory frames have local map coverage')
    selected = eligible[np.unique(np.linspace(0, len(eligible)-1, min(args.count, len(eligible))).astype(int))]
    frames = []
    rng = np.random.default_rng(20261105)
    for n, index in enumerate(selected):
        row = poses[index]; path = args.vmms.parent/row['source_image_relpath']
        image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None: raise ValueError(f'Cannot decode image {row["frame_id"]}')
        image = cv2.resize(image, (args.image_width, args.image_width//2), interpolation=cv2.INTER_AREA)
        gray = cv2.equalizeHist(image)
        ids = tree.query_ball_point(positions[index, :2], 40.)
        local = np.asarray(points[ids]).copy()
        local = local[(local[:, 2]-positions[index, 2] > -10) & (local[:, 2]-positions[index, 2] < 55)]
        if len(local) > args.max_points: local = local[rng.choice(len(local), args.max_points, replace=False)]
        rotation = np.asarray(world_from_flu(*(float(row[k]) for k in ('roll_rad', 'pitch_rad', 'heading_rad'))))
        body = (local[:, :3]-positions[index]) @ rotation
        _, inverse, frequencies = np.unique(local[:, 3], return_inverse=True, return_counts=True)
        cdf = (np.cumsum(frequencies)-frequencies/2)/len(local)
        bins = np.clip((cdf[inverse]*16).astype(int), 0, 15)
        rgb_edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 70, 140)
        tiled_dt = distance_transform_edt(np.tile(rgb_edges == 0, (1, 3)))
        edge_dt = tiled_dt[:, args.image_width:2*args.image_width]
        frame = {'id': row['frame_id'], 'body': body, 'bins': bins, 'gray': gray,
                 'w': args.image_width, 'h': args.image_width//2, 'edge_dt': edge_dt,
                 'edges': geometry_edges(body), 'split': 'selection' if n % 2 == 0 else 'holdout'}
        frames.append(frame)
        print(f'Prepared frame {row["frame_id"]}: {len(body)} map points / {len(frame["edges"])} edge points', flush=True)
    if len(frames) < 4: raise ValueError('Insufficient covered frames')
    curves = []
    for frame in frames:
        ids, u, v, bins = visible(frame['body'], frame['bins'], frame['w'], frame['h'], (False, False, 0.))
        variants = []
        for mirror, flip in ((False, False), (True, False), (False, True), (True, True)):
            values = []
            vv = frame['h']-1-v if flip else v
            for shift in range(0, 360, args.yaw_step):
                uu = (((frame['w']-u) if mirror else u)+shift/360*frame['w']) % frame['w']
                values.append(nid(sample_image(frame['gray'], uu, vv), bins))
            variants.append(values)
        curves.append(variants)
        print(f'Scanned ERP orientation: {frame["id"]}', flush=True)
    curves = np.asarray(curves)
    selection = [i for i, f in enumerate(frames) if f['split'] == 'selection']
    holdout = [i for i, f in enumerate(frames) if f['split'] == 'holdout']
    selection_cost = curves[selection].mean(axis=0)
    orientation_variants = [(False, False), (True, False), (False, True), (True, True)]
    variant, shift_index = np.unravel_index(np.argmin(selection_cost), selection_cost.shape)
    orientation = (*orientation_variants[variant], int(shift_index*args.yaw_step))
    records = []
    for f in frames:
        for context, align in (('as_is', (False, False, 0.)), ('selection_aligned', orientation)):
            for c in candidates:
                records.append({'frameId': f['id'], 'split': f['split'], 'context': context,
                                'hypothesis': c['id'], **metrics(f, c['matrix'], align)})
        print(f'Compared 48 CSV hypotheses + identity: {f["id"]}', flush=True)
    summary = []
    for context in ('as_is', 'selection_aligned'):
        for c in candidates:
            subset = [r for r in records if r['context'] == context and r['hypothesis'] == c['id'] and r['split'] == 'holdout']
            baseline = [r for r in records if r['context'] == context and r['hypothesis'] == 'identity' and r['split'] == 'holdout']
            delta = np.asarray([a['nid']-b['nid'] for a, b in zip(subset, baseline)])
            bootstrap = np.mean(rng.choice(delta, (2000, len(delta)), replace=True), axis=1)
            edge_values = [r['edgeChamferProxyDeg'] for r in subset if r['edgeChamferProxyDeg'] is not None]
            summary.append({'context': context, 'hypothesis': c['id'], 'holdoutMeanNid': float(np.mean([r['nid'] for r in subset])),
                            'meanNidDeltaVsIdentity': float(delta.mean()), 'pairedBootstrap95Pct': np.percentile(bootstrap, [2.5, 97.5]).tolist(),
                            'framesBetterThanIdentity': int(np.sum(delta < 0)), 'holdoutCount': len(subset),
                            'edgeProxyMeanDeg': float(np.mean(edge_values)) if edge_values else None,
                            'rayShiftP95MeanDeg': float(np.mean([r['rayShiftP95Deg'] for r in subset]))})
    summary.sort(key=lambda r: (r['context'], r['holdoutMeanNid']))
    report = {'schemaVersion': 'extrinsics-hypothesis-test/1.0', 'conclusion': 'unverified-no-independent-reference',
              'applyRecommended': False, 'metricWarning': 'NID, chamfer and stability are proxies, not rotation accuracy or a 4-degree certificate.',
              'frameAssumption': 'Selected basis places the CSV transform in the INS body frame; the actual LiDAR-to-INS transform is unknown. Results cannot establish CSV provenance.',
              'csvSha256': hashlib.sha256(args.extrinsics.read_bytes()).hexdigest(), 'csvRowCount': len(rows),
              'stream': args.stream, 'mapSources': sources, 'validMapPoints': len(points),
              'framesTested': [{'id': f['id'], 'split': f['split'], 'samplePoints': len(f['body'])} for f in frames],
              'imageWidth': args.image_width, 'hypotheses': [{**{k: v for k, v in c.items() if k != 'matrix'}, 'cameraToBodyCandidate': c['matrix'].reshape(-1).tolist()} for c in candidates],
              'selectionOrientationProxy': {'mirrorU': orientation[0], 'flipV': orientation[1], 'longitudeShiftDeg': orientation[2]},
              'orientationPerFrameBest': [{'id': f['id'], 'variant': int(np.unravel_index(np.argmin(curves[i]), curves[i].shape)[0]),
                                          'longitudeShiftDeg': int(np.unravel_index(np.argmin(curves[i]), curves[i].shape)[1]*args.yaw_step)} for i, f in enumerate(frames)],
              'summary': summary, 'perFrameMetrics': records}
    (args.output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    with (args.output/'hypothesis_summary.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        fields = [k for k in summary[0] if k != 'pairedBootstrap95Pct']+['bootstrapLow', 'bootstrapHigh']
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader()
        for row in summary:
            writer.writerow({**{k: v for k, v in row.items() if k != 'pairedBootstrap95Pct'},
                             'bootstrapLow': row['pairedBootstrap95Pct'][0], 'bootstrapHigh': row['pairedBootstrap95Pct'][1]})
    np.savez(args.output/'orientation_curves.npz', curves=curves, yaw=np.arange(0, 360, args.yaw_step))
    print('Selected nuisance orientation (not calibrated):', orientation, flush=True)
    for row in [r for r in summary if r['context'] == 'selection_aligned'][:6]: print(row, flush=True)
    print(f'Report written to {args.output}', flush=True)


if __name__ == '__main__':
    main()
