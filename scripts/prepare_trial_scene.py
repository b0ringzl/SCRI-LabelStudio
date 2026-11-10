"""Extract one RGB map scene and an original-resolution panorama sequence.

Reads sources only; outputs private trial assets under local-samples by default.
Requires numpy and opencv-python (or opencv-python-headless).
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import shutil
import zipfile
from pathlib import Path
import cv2
import numpy as np

from prepare_vmms_sample import DEFAULT_FRAMES, DEFAULT_VMMS, world_from_flu
from prepare_vmms_sequence import camera_to_local

DTYPE = np.dtype([('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('rgb', '<u4')])


def extract(cloud, origin, rotation, radius, cap, voxel_size=0):
    with cloud.open('rb') as f:
        header = {}
        while True:
            line = f.readline()
            if not line: raise ValueError('Incomplete PCD header')
            key, _, value = line.decode('ascii').strip().partition(' '); header[key] = value
            if key == 'DATA': offset = f.tell(); break
    if (header['DATA'] != 'binary' or header['FIELDS'] != 'x y z rgb'
            or header.get('SIZE') != '4 4 4 4' or header.get('COUNT') != '1 1 1 1'
            or header.get('TYPE') not in ('F F F U', 'F F F F')):
        raise ValueError('Scene extractor requires binary XYZ + packed uint32 RGB')
    count = int(header['POINTS'])
    if cloud.stat().st_size-offset != count*DTYPE.itemsize:
        raise ValueError('PCD point count and file length do not match')
    source = np.memmap(cloud, mode='r', dtype=DTYPE, offset=offset, shape=(count,))
    rng = np.random.default_rng(20261105)
    reservoir = np.empty(0, dtype=DTYPE); seen = 0
    voxel_parts = []
    for start in range(0, count, 1_000_000):
        chunk = source[start:start+1_000_000]
        dx, dy, dz = chunk['x']-origin[0], chunk['y']-origin[1], chunk['z']-origin[2]
        mask = np.isfinite(dx) & np.isfinite(dy) & np.isfinite(dz) & (dx*dx+dy*dy <= radius*radius) & (dz >= -8) & (dz <= 45)
        incoming = np.asarray(chunk[mask]); n = len(incoming)
        if n and voxel_size:
            xyz = np.column_stack([incoming[k] for k in ('x', 'y', 'z')]).astype(float)-origin
            quantized = np.floor(xyz/voxel_size).astype(np.int64)+4096
            if np.any(quantized < 0) or np.any(quantized >= 8192):
                raise ValueError('Voxel size too small for scene extent')
            keys = (quantized[:, 0]*8192+quantized[:, 1])*8192+quantized[:, 2]
            unique, first = np.unique(keys, return_index=True)
            voxel_parts.append((unique, np.flatnonzero(mask)[first]+start))
            seen += n
            continue
        if n:
            total = min(cap, seen+n)
            take_new = int(rng.hypergeometric(n, seen, total))
            take_old = total-take_new
            old = reservoir if take_old == len(reservoir) else reservoir[rng.choice(len(reservoir), take_old, replace=False)]
            new = incoming if take_new == n else incoming[rng.choice(n, take_new, replace=False)]
            reservoir = np.concatenate([old, new]); seen += n
        if start % 10_000_000 == 0: print(f'Scanned {min(start+1_000_000, count):,}/{count:,}; eligible {seen:,}', flush=True)
    if voxel_size and voxel_parts:
        keys = np.concatenate([part[0] for part in voxel_parts])
        indices = np.concatenate([part[1] for part in voxel_parts])
        unique, first = np.unique(keys, return_index=True)
        print(f'Spatial voxels: {len(unique):,}; eligible source points: {seen:,}', flush=True)
        if len(first) > cap: first = first[np.sort(rng.choice(len(first), cap, replace=False))]
        reservoir = np.asarray(source[indices[first]])
    if not len(reservoir): raise ValueError('No map points inside the selected scene')
    xyz = np.column_stack([reservoir[k] for k in ('x', 'y', 'z')]).astype(float)
    flu = (xyz-origin) @ rotation
    result = np.empty(len(reservoir), dtype=DTYPE)
    result['x'], result['y'], result['z'], result['rgb'] = -flu[:, 1], flu[:, 2], -flu[:, 0], reservoir['rgb']
    return result, seen, count


def preview(images, out):
    w, h = 600, 340
    yy, xx = np.mgrid[:h, :w]; fx = w/2
    vx, vy = (xx+.5-w/2)/fx, (h/2-yy-.5)/fx
    v = .5-np.arctan2(vy, np.hypot(vx, 1.))/np.pi
    strips = []
    for file in (images[0], images[len(images)//2], images[-1]):
        pano = cv2.imdecode(np.fromfile(file, dtype=np.uint8), cv2.IMREAD_COLOR)
        views = []
        for shift in (0., .5):
            u = (.5+np.arctan2(vx, 1.)/(2*np.pi)+shift) % 1.
            image = cv2.remap(pano, (u*pano.shape[1]).astype(np.float32), (v*pano.shape[0]).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            cv2.rectangle(image, (0, 0), (w, 27), (20, 20, 20), -1)
            cv2.putText(image, file.stem+(' / ERP center' if shift == 0 else ' / opposite'), (10, 19), cv2.FONT_HERSHEY_SIMPLEX, .5, (255, 255, 255), 1)
            views.append(image)
        strips.append(np.vstack(views))
    out.write_bytes(cv2.imencode('.jpg', np.hstack(strips), [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vmms', type=Path, default=DEFAULT_VMMS)
    parser.add_argument('--frames', type=Path, default=DEFAULT_FRAMES)
    parser.add_argument('--cloud', type=Path)
    parser.add_argument('--stream', default='jianshazui_pano_1')
    parser.add_argument('--base-frame', default='001298')
    parser.add_argument('--radius', type=float, default=45.)
    parser.add_argument('--max-points', type=int, default=750000)
    parser.add_argument('--voxel-size', type=float, default=0, help='Optional spatial deduplication in meters; recommended 0.035 for dense trials')
    parser.add_argument('--panorama-yaw-offset', type=float, default=0, help='Explicit coarse panorama zero-azimuth hypothesis in degrees; not calibrated extrinsics')
    parser.add_argument('--offsets', nargs='+', type=int, default=list(range(-20, 21, 4)))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'local-samples'/'trial-jsz-001298')
    parser.add_argument('--zip-output', type=Path, default=Path(__file__).resolve().parents[1]/'release')
    args = parser.parse_args()
    if args.output.exists(): raise FileExistsError('Choose a new output folder to preserve existing trial data')
    if args.radius <= 0 or args.max_points < 1000 or args.voxel_size < 0 or not np.isfinite(args.panorama_yaw_offset): raise ValueError('Invalid scene radius, point cap, voxel size or yaw')
    cloud = args.cloud or args.vmms/'pointcloud'/'mapping'/'pointcloud_5.pcd'
    with args.frames.open(encoding='utf-8-sig') as f: rows = {r['frame_id']: r for r in csv.DictReader(f) if r['stream_id'] == args.stream}
    base = rows[args.base_frame]
    selected = [rows[f'{int(args.base_frame)+k:06d}'] for k in sorted(set(args.offsets))]
    sources = [args.vmms.parent/r['source_image_relpath'] for r in selected]
    for p in sources:
        if not p.is_file(): raise FileNotFoundError(p)
    origin = np.asarray([float(base[k]) for k in ('local_x', 'local_y', 'local_z')])
    rotation = np.asarray(world_from_flu(*(float(base[k]) for k in ('roll_rad', 'pitch_rad', 'heading_rad'))))
    points, eligible, source_count = extract(cloud, origin, rotation, args.radius, args.max_points, args.voxel_size)
    args.output.mkdir(parents=True); (args.output/'panoramas').mkdir()
    with (args.output/'scene-cloud.pcd').open('wb') as f:
        f.write((f'VERSION 0.7\nFIELDS x y z rgb\nSIZE 4 4 4 4\nTYPE F F F U\nCOUNT 1 1 1 1\nWIDTH {len(points)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS {len(points)}\nDATA binary\n').encode('ascii'))
        f.write(points.tobytes())
    frames = []; images = []
    for row, source in zip(selected, sources):
        target = args.output/'panoramas'/f'frame_{row["frame_id"]}.jpg'
        shutil.copyfile(source, target); images.append(target)
        frames.append({'image': target.name, 'utcSeconds': float(row['utc_seconds']),
                       'cameraToCloud': camera_to_local(base, row), 'sourceFrameId': row['frame_id']})
    manifest = {'schemaVersion': 'registration/1.0', 'source': 'TREE interpolated INS; platform approximation, unverified camera extrinsics',
                'baseFrameId': args.base_frame, 'frames': frames}
    if args.panorama_yaw_offset:
        (args.output/'registration-ins-only.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        angle = np.deg2rad(args.panorama_yaw_offset); c, s = np.cos(angle), np.sin(angle)
        correction = np.array([[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]])
        for frame in frames:
            frame['cameraToCloud'] = (np.asarray(frame['cameraToCloud']).reshape(4,4) @ correction).ravel().tolist()
        manifest['source'] += f'; explicit coarse yaw hypothesis {args.panorama_yaw_offset} deg, needs tie-point verification'
    (args.output/'registration.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    positions = np.asarray([[float(r[k]) for k in ('local_x', 'local_y', 'local_z')] for r in selected])
    metadata = {'datasetId': f'JSZ-{args.base_frame}-trial', 'sceneName': '尖沙咀街景试用' if args.stream.startswith('jianshazui') else args.stream,
                'streamId': args.stream, 'baseFrame': args.base_frame,
                'sourceCloud': cloud.name, 'sourceCloudPointCount': source_count, 'eligiblePointCount': eligible,
                'sampledPointCount': len(points), 'radiusMeters': args.radius, 'imageCount': len(frames),
                'voxelSizeMeters': args.voxel_size, 'sampling': 'spatial voxel representatives' if args.voxel_size else 'uniform reservoir',
                'panoramaYawOffsetDeg': args.panorama_yaw_offset,
                'panoramaYawOffsetStatus': 'explicit coarse hypothesis; not independently calibrated',
                'panoramaProcessing': 'Original JPG files copied without resizing or recompression',
                'durationSeconds': frames[-1]['utcSeconds']-frames[0]['utcSeconds'],
                'sampledTrajectoryLengthMeters': float(np.linalg.norm(np.diff(positions, axis=0), axis=1).sum()),
                'coordinateSystem': '+X right, +Y up, -Z forward, base INS-local, meters',
                'registrationStatus': f'INS + explicit coarse yaw hypothesis {args.panorama_yaw_offset} deg; CSV not applied; needs verification' if args.panorama_yaw_offset else 'INS coarse pose only; CSV extrinsics not applied; panorama zero azimuth unverified',
                'rgbStatus': 'RGB from source PCD; original colorization calibration is not independently verified',
                'sourceImages': [r['source_image_relpath'] for r in selected]}
    (args.output/'source-metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    preview(images, args.output/'scene-preview.jpg')
    for platform in ('Windows', 'macOS'):
        text = f'''# 尖沙咀连续场景试用 · {platform}

本包是实际数据，含 {len(points):,} 个原始 RGB 点的局部抽样和 {len(frames)} 张原分辨率全景，行进距离约 {metadata['sampledTrajectoryLengthMeters']:.1f} m。

1. 解压本数据包。先运行现有 Atlas Studio 的 {'Start-Atlas-Windows.bat' if platform == 'Windows' else 'Start-Atlas-macOS.command'}，进入“数据源”。
2. 点云选择本目录的 scene-cloud.pcd。
3. 全景多选 panoramas 目录的全部 JPG，位姿选择 registration.json。
4. 填写“尖沙咀街景试用 · 11帧”，点击“创建并进入标注工作台”。可切换连续全景，使用投影核验、同名点、3D框及多帧目标框。

位姿是 INS 粗配准，未应用尚未确认的外参 CSV，不代表已达到4°精度。RGB是原始点云已有颜色，不构成独立配准真值。浏览器文件导入的任务刷新后需重新选文件；标注结果请保存并导出。

两平台的数据格式、图像和位姿相同，区别是启动操作说明。原始数据没有被修改，本包不上传GitHub。
'''
        (args.output/f'README-{platform}.md').write_text(text, encoding='utf-8')
    hashes = {str(p.relative_to(args.output)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in args.output.rglob('*') if p.is_file() and not p.name.startswith('README-')}
    (args.output/'checksums.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    args.zip_output.mkdir(parents=True, exist_ok=True)
    for platform in ('Windows', 'macOS'):
        name = f'SCRI-Scene-JSZ{args.base_frame}-Data-{platform}'
        path = args.zip_output/f'{name}.zip'
        with zipfile.ZipFile(path, 'w') as z:
            for p in args.output.rglob('*'):
                if not p.is_file() or (p.name.startswith('README-') and p.name != f'README-{platform}.md'): continue
                relative = p.relative_to(args.output).as_posix()
                if p.name.startswith('README-'): relative = 'README.md'
                z.write(p, f'{name}/{relative}', compress_type=zipfile.ZIP_STORED if p.suffix == '.jpg' else zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(path) as z:
            if z.testzip() is not None: raise ValueError('Corrupt trial data archive')
        print(path, flush=True)
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == '__main__': main()
