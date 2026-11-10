"""Prepare any DenseMap + CameraPoseInSlam dataset using its own poses.

No geographic crop and no scene-specific yaw is applied. The explicit coordinate
profile defaults to the Z-up/FLU convention of these SLAM exports.
"""
import argparse
import csv
import hashlib
import json
import shutil
from pathlib import Path
import numpy as np
from pointcloud_io import open_binary, xyz, voxel_indices, write_pcd

WORLD_ZUP = np.array([[1,0,0],[0,0,1],[0,-1,0]],dtype=float)
CAMERA_FLU = np.array([[0,0,-1],[-1,0,0],[0,1,0]],dtype=float)


def image_key(value):
    stem=Path(str(value).strip()).stem
    return str(int(stem)) if stem.isdigit() else stem.casefold()


def read_poses(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        first=f.readline(); f.seek(0)
        rows=csv.DictReader(f,delimiter='\t' if '\t' in first else ',')
        if not rows.fieldnames or not all(f'T{r}{c}' in rows.fieldnames for r in range(3) for c in range(4)):
            raise ValueError('Expected Image id + T00..T23 pose table')
        out={}
        for row in rows:
            key=image_key(row.get('Image id',''))
            if not key or key in out: raise ValueError('Empty or duplicate pose image id')
            matrix=np.eye(4); matrix[:3,:]=np.array([[float(row[f'T{r}{c}']) for c in range(4)] for r in range(3)])
            r=matrix[:3,:3]
            if not np.isfinite(matrix).all() or np.max(np.abs(r.T@r-np.eye(3)))>.002 or abs(np.linalg.det(r)-1)>.002:
                raise ValueError(f'Invalid rigid pose: {key}')
            out[key]=matrix
        if not out: raise ValueError('Pose table is empty')
        return out


def convert_pose(matrix, world_axes='z-up', camera_axes='flu', direction='camera-to-world', origin=None):
    matrix=np.asarray(matrix,dtype=float)
    if direction=='world-to-camera': matrix=np.linalg.inv(matrix)
    w=WORLD_ZUP if world_axes=='z-up' else np.eye(3)
    c=CAMERA_FLU if camera_axes=='flu' else np.diag([1,-1,-1]) if camera_axes=='opencv' else np.eye(3)
    result=np.eye(4); result[:3,:3]=w@matrix[:3,:3]@c
    result[:3,3]=w@(matrix[:3,3]-(np.zeros(3) if origin is None else origin))
    return result


def prepare(dataset, output, max_frames=0, point_budget=1800000, world_axes='z-up', camera_axes='flu', direction='camera-to-world'):
    dataset=Path(dataset).resolve(); output=Path(output)
    if output.exists(): raise FileExistsError('Output exists; choose a new output to preserve annotations and source assets')
    pose_files=list(dataset.rglob('CameraPoseInSlam.csv'))
    if len(pose_files)!=1: raise ValueError('Dataset needs exactly one CameraPoseInSlam.csv; separate datasets into folders')
    pose_file=pose_files[0]; poses=read_poses(pose_file)
    cloud=dataset/'DenseMap.pcd'
    source,h=open_binary(cloud)
    images={}
    for p in pose_file.parent.iterdir():
        if p.suffix.lower() not in ('.jpg','.jpeg','.png'): continue
        key=image_key(p.name)
        if key in images: raise ValueError('Ambiguous duplicate image identifiers')
        images[key]=p
    matched=sorted(set(images)&set(poses),key=lambda k: (0,int(k)) if k.isdigit() else (1,k))
    if not matched: raise ValueError('No images match pose identifiers')
    if set(images)-set(poses): raise ValueError(f'{len(set(images)-set(poses))} images have no pose; refusing to silently discard them')
    selected=matched
    if max_frames and len(matched)>max_frames:
        center=len(matched)//2; start=max(0,min(len(matched)-max_frames,center-max_frames//2))
        selected=matched[start:start+max_frames]
    if len(selected)>1000: raise ValueError('Local scene service supports at most 1000 frames; split the sequence or use --max-frames')
    # Validate every matched image, even when a smaller trial sequence is copied.
    import cv2
    for key in matched:
        image=cv2.imdecode(np.fromfile(images[key],dtype=np.uint8),cv2.IMREAD_REDUCED_COLOR_8)
        if image is None or abs(image.shape[1]/image.shape[0]-2)>.02: raise ValueError(f'Image is not a 2:1 panorama: {images[key].name}')
    origin=(np.linalg.inv(poses[selected[len(selected)//2]]) if direction=='world-to-camera' else poses[selected[len(selected)//2]])[:3,3]
    w=WORLD_ZUP if world_axes=='z-up' else np.eye(3)
    points=xyz(source).astype(np.float32); valid=np.isfinite(points).all(1); source_indices=np.flatnonzero(valid); points=points[valid]
    if not len(points): raise ValueError('Point cloud contains no finite XYZ points')
    keep,voxel=voxel_indices(points,.12,point_budget)
    # Keep true extrema as well, so no map boundary is silently clipped.
    keep=np.unique(np.r_[keep,np.argmin(points,axis=0),np.argmax(points,axis=0)])
    selected_source=source_indices[keep]
    prepared=(points[keep].astype(float)-origin)@w.T
    field='rgb' if 'rgb' in source.dtype.names else 'intensity'
    if field=='rgb':
        if source.dtype['rgb'].itemsize != 4: raise ValueError('Packed RGB requires a 4-byte source field')
        values=np.asarray(source['rgb'][selected_source]).view('<u4')
    else: values=source['intensity'][selected_source] if 'intensity' in source.dtype.names else np.zeros(len(keep),dtype=np.float32)
    output.mkdir(parents=True); (output/'panoramas').mkdir()
    write_pcd(output/'scene-cloud.pcd',prepared,values,field)
    frames=[]
    time_file=pose_file.parent/'genericImagePositions.csv'; times={}
    if time_file.exists():
        with time_file.open(encoding='utf-8-sig') as f:
            rows=csv.DictReader(f,delimiter='\t')
            for row in rows:
                if row.get('Timestamp'): times[image_key(row['Filename'])]=float(row['Timestamp'])
    for key in selected:
        path=images[key]; shutil.copyfile(path,output/'panoramas'/path.name)
        entry={'image':path.name,'cameraToCloud':convert_pose(poses[key],world_axes,camera_axes,direction,origin).ravel().tolist()}
        if key in times: entry['utcSeconds']=times[key]
        frames.append(entry)
    registration={'schemaVersion':'registration/1.0','source':'Imported source SLAM poses; explicit coordinate profile; zero yaw not assumed from another scene','frames':frames}
    metadata={'sceneName':dataset.name,'datasetId':dataset.name,'registrationSource':'imported',
        'registrationSummary':'源 SLAM 位姿初值 · 坐标约定待投影核验','baseFrameName':images[selected[len(selected)//2]].name,
        'pointFormat':'XYZRGB' if field=='rgb' else 'XYZI','sourceCloud':cloud.name,'sourcePointCount':h['count'],
        'sampledPointCount':len(prepared),'imageCount':len(frames),'sourceImageCount':len(images),'matchedPoseCount':len(matched),
        'unmatchedImages':sorted(set(images)-set(poses)),'posesWithoutImages':sorted(set(poses)-set(images)),
        'fullMapCoverage':True,'spatialCrop':None,'voxelSizeMeters':voxel,'sourceBounds':[points.min(0).tolist(),points.max(0).tolist()],
        'sampleBounds':[points[keep].min(0).tolist(),points[keep].max(0).tolist()],
        'pcdPaddingBytes':h.get('paddingBytes',0),'coordinateProfile':{'worldAxes':world_axes,'cameraAxes':camera_axes,'matrixDirection':direction},
        'registrationStatus':'source-pose initialization, not independently verified extrinsic accuracy; no hardcoded scene yaw'}
    (output/'registration.json').write_text(json.dumps(registration,indent=2),encoding='utf-8')
    (output/'source-metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    checks={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
    (output/'checksums.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
    print(json.dumps({'dataset':dataset.name,'points':len(prepared),'sourcePoints':h['count'],'matchedPoses':len(matched),'trialFrames':len(frames),'voxel':voxel}),flush=True)
    return metadata


def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('dataset',type=Path); p.add_argument('--output',type=Path,required=True)
    p.add_argument('--max-frames',type=int,default=0); p.add_argument('--point-budget',type=int,default=1800000)
    p.add_argument('--world-axes',choices=['z-up','y-up'],default='z-up'); p.add_argument('--camera-axes',choices=['flu','opencv','viewer'],default='flu')
    p.add_argument('--matrix-direction',choices=['camera-to-world','world-to-camera'],default='camera-to-world')
    a=p.parse_args()
    if a.point_budget<1000 or a.max_frames<0: p.error('Invalid point/frame budget')
    prepare(a.dataset,a.output,a.max_frames,a.point_budget,a.world_axes,a.camera_axes,a.matrix_direction)


if __name__=='__main__': main()
