"""Combine an existing detailed scene with every available DS map chunk.

The detailed cloud is retained; the global layer has no radius/height cut.
This supplies coverage, not invented geometry or full-resolution raw scans.
"""
import argparse
import csv
import hashlib
import json
import shutil
from pathlib import Path
import numpy as np
from pointcloud_io import load_ascii, open_binary, xyz, voxel_indices, write_pcd
from prepare_vmms_sample import world_from_flu


def display_ranges(local_count, global_points, detail_spacing, overview_spacing):
    near=np.hypot(global_points[:,0],global_points[:,2])<=150
    edges=np.r_[0,np.flatnonzero(near[1:]!=near[:-1])+1,len(near)]
    ranges=[{'start':0,'count':local_count,'spacing':detail_spacing}]
    for a,b in zip(edges[:-1],edges[1:]):
        if b>a: ranges.append({'start':int(local_count+a),'count':int(b-a),'spacing':.14 if near[a] else overview_spacing})
    return ranges


def complete(scene, mapping, frame_table, output, overview_budget=800000):
    scene=Path(scene); output=Path(output)
    if output.exists(): raise FileExistsError('Choose a new output directory')
    meta=json.loads((scene/'source-metadata.json').read_text(encoding='utf-8'))
    with Path(frame_table).open(encoding='utf-8-sig') as f:
        row=next(r for r in csv.DictReader(f) if r['stream_id']==meta['streamId'] and r['frame_id']==meta['baseFrame'])
    origin=np.array([float(row[k]) for k in ('local_x','local_y','local_z')])
    rotation=np.array(world_from_flu(*[float(row[k]) for k in ('roll_rad','pitch_rad','heading_rad')]))
    parts=[]; sources=[]
    for path in sorted(Path(mapping).glob('pointcloud_DS_*.pcd')):
        data,h=load_ascii(path); parts.append(data); sources.append({'file':path.name,'points':len(data)})
    if not parts: raise ValueError('No map chunks found')
    overview=np.concatenate(parts); keep,voxel=voxel_indices(overview[:,:3],.4,overview_budget)
    distance=np.linalg.norm(overview[:,:2]-origin[:2],axis=1)
    keep=np.unique(np.r_[keep,np.flatnonzero(distance<=150)])
    world=overview[keep,:3].astype(float); flu=(world-origin)@rotation
    global_points=np.column_stack([-flu[:,1],flu[:,2],-flu[:,0]])
    near=np.hypot(global_points[:,0],global_points[:,2])<=150
    order=np.r_[np.flatnonzero(near),np.flatnonzero(~near)]
    global_points=global_points[order]; keep=keep[order]
    detail,h=open_binary(scene/'scene-cloud.pcd'); local=xyz(detail)
    value=overview[keep,3]; lo,hi=np.quantile(value,[.02,.98]); gray=np.clip(65+140*(value-lo)/max(1,hi-lo),45,220).astype(np.uint32)
    gray_rgb=(gray<<16)|(gray<<8)|gray
    rgb=np.asarray(detail['rgb']).view('<u4')
    merged=np.concatenate([local,global_points]); colors=np.concatenate([rgb,gray_rgb])
    output.mkdir(parents=True)
    write_pcd(output/'scene-cloud.pcd',merged,colors,'rgb')
    shutil.copytree(scene/'panoramas',output/'panoramas')
    for name in ('registration.json','registration-ins-only.json'):
        if (scene/name).exists(): shutil.copyfile(scene/name,output/name)
    meta.update({'sceneName':'尖沙咀 · 全局概览与局部细节','registrationSource':'ins-approximate',
        'sampledPointCount':len(merged),'pointFormat':'XYZRGB','fullMapCoverage':True,
        'coverage':{'summary':f'全局概览：{len(sources)} 分块 + 55m 彩色细节（降采样）','fullMapCoverage':True,
          'overviewSpatialCrop':None,'detailRadiusMeters':meta['radiusMeters'],'overviewPointCount':len(global_points),
          'detailPointCount':len(local),'overviewVoxelMeters':voxel,'allMapSources':sources,
          'sourceBounds':[overview[:,:3].min(0).tolist(),overview[:,:3].max(0).tolist()],
          'overviewBounds':[world.min(0).tolist(),world.max(0).tolist()]},
        'pointDisplayRanges':display_ranges(len(local),global_points,meta.get('voxelSizeMeters',.02),voxel),
        'colorProvenance':'Original local RGB; global overview rendered as grayscale intensity (not RGB truth)'})
    (output/'source-metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    hashes={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
    (output/'checksums.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
    print(json.dumps({'points':len(merged),'detail':len(local),'overview':len(global_points),'sourceFiles':len(sources),'overviewVoxel':voxel}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--scene',type=Path,required=True);p.add_argument('--mapping',type=Path,required=True)
    p.add_argument('--frames',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    complete(a.scene,a.mapping,a.frames,a.output)
