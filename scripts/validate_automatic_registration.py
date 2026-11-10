"""Read-only local survey validation. Results stay in ignored local-samples.

Usage: .venv-registration Python scripts/validate_automatic_registration.py
These diagnostics have no independent pose truth and cannot certify accuracy.
"""
import base64
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from scipy.spatial.transform import Rotation
from pointcloud_io import open_binary, xyz
from registration_worker import solve

ROOT=Path(__file__).resolve().parents[1]


def main():
    root=ROOT/'local-samples/generalization-suite'
    output=ROOT/'local-samples/automatic-registration-validation';output.mkdir(exist_ok=True)
    report=[]
    for scene in json.loads((root/'scene-catalog.json').read_text(encoding='utf-8'))['scenes']:
        folder=root/scene['directory'];cloud=folder/'scene-cloud.pcd'
        original=hashlib.sha256(cloud.read_bytes()).hexdigest()
        data,_=open_binary(cloud);stride=max(1,int(np.ceil(len(data)/180000)))
        data=data[::stride];points=xyz(data)
        if 'intensity' in data.dtype.names:
            values=data['intensity'].astype(float);signal='intensity'
        else:
            rgb=data['rgb'];rgb=rgb.view('<u4') if rgb.dtype.kind=='f' else rgb.astype('<u4')
            values=((rgb>>16)&255)*.2126+((rgb>>8)&255)*.7152+(rgb&255)*.0722;signal='rgb-luminance'
        frames=json.loads((folder/'registration.json').read_text(encoding='utf-8'))['frames']
        for index in sorted(set((0,len(frames)//2,len(frames)-1))):
            frame=frames[index];matrix=np.asarray(frame['cameraToCloud']).reshape(4,4)
            prior={'position':matrix[:3,3].tolist(),'rotation':Rotation.from_matrix(matrix[:3,:3]).as_euler('YXZ',degrees=True).tolist()}
            distance=np.linalg.norm(points-matrix[:3,3],axis=1)
            ids=np.flatnonzero(np.isfinite(points).all(1)&np.isfinite(values)&(distance>1.5)&(distance<75))
            if len(ids)>28000:ids=ids[np.floor(np.arange(28000)*len(ids)/28000).astype(int)]
            image=cv2.imdecode(np.frombuffer((folder/'panoramas'/frame['image']).read_bytes(),dtype=np.uint8),cv2.IMREAD_COLOR)
            image=cv2.resize(image,(1536,768),interpolation=cv2.INTER_AREA)
            payload={'schemaVersion':'registration/2.0','frameId':frame['image'],'prior':prior,'signal':signal,
                'points':points[ids].tolist(),'values':values[ids].tolist(),
                'imageDataUrl':'data:image/jpeg;base64,'+base64.b64encode(cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,94])[1]).decode()}
            try:result=solve(payload)
            except Exception as error:result={'status':'error','reason':str(error)}
            result['scene']=scene['key'];result['sourceUnchanged']=hashlib.sha256(cloud.read_bytes()).hexdigest()==original
            report.append(result)
            (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(scene['key'],frame['image'],result['status'],result.get('metrics',result.get('reason')),flush=True)
    print('No independent ground truth. NID improvement is not measured angular accuracy.',flush=True)


if __name__=='__main__':main()
