"""Weight-free spherical image / point-cloud local registration.

Independent NumPy/SciPy implementation of normalized information distance,
not a wrapper of the Koide C++ executable. A coarse camera-to-cloud pose is
required. No survey files are rewritten, and candidates are never auto-applied.
"""
from __future__ import annotations
import argparse
import base64
import json
import sys
import time

import cv2
import numpy as np
from scipy.optimize import minimize
from scipy.spatial.transform import Rotation
from scipy.stats import rankdata

VERSION='spherical-nid/1.0'


def pose_matrix(pose):
    result=np.eye(4)
    result[:3,:3]=Rotation.from_euler('YXZ',pose['rotation'],degrees=True).as_matrix()
    result[:3,3]=pose['position']
    return result


def project(points, transform, width, height):
    local=(points-transform[:3,3])@transform[:3,:3]
    distance=np.linalg.norm(local,axis=1)
    u=(.5+np.arctan2(local[:,0],-local[:,2])/(2*np.pi))%1*width
    v=(.5-np.arcsin(np.clip(local[:,1]/np.maximum(distance,1e-9),-1,1))/np.pi)*height
    return u,v,distance


def visible_indices(points,transform,width,height):
    u,v,depth=project(points,transform,width,height)
    valid=np.isfinite(depth)&(depth>1)&(depth<90)&(v>height*.05)&(v<height*.95)
    ids=np.flatnonzero(valid)
    # Nearest surface per coarse spherical pixel. Never optimize points hidden
    # by the front surface as if they were observations of the image.
    pixel=np.floor(v[ids]).astype(int)*width+np.floor(u[ids]).astype(int)
    order=np.argsort(depth[ids],kind='stable')
    _,first=np.unique(pixel[order],return_index=True)
    return ids[order[first]]


def sample(image,u,v):
    h,w=image.shape
    x0=np.floor(u).astype(int)%w;y0=np.clip(np.floor(v).astype(int),0,h-1)
    ax=u-np.floor(u);ay=np.clip(v-y0,0,1)
    x1=(x0+1)%w;y1=np.minimum(y0+1,h-1)
    return (image[y0,x0]*(1-ax)*(1-ay)+image[y0,x1]*ax*(1-ay)+
            image[y1,x0]*(1-ax)*ay+image[y1,x1]*ax*ay)


def nid(a,b,bins=20):
    """Bilinear Parzen histogram avoids a discontinuous hard-bin objective."""
    x=np.clip(a,0,1)*(bins-1);y=np.clip(b,0,1)*(bins-1)
    ix=np.floor(x).astype(int);iy=np.floor(y).astype(int);dx=x-ix;dy=y-iy
    hist=np.zeros(bins*bins)
    for ox,wx in ((0,1-dx),(1,dx)):
        for oy,wy in ((0,1-dy),(1,dy)):
            key=np.minimum(ix+ox,bins-1)*bins+np.minimum(iy+oy,bins-1)
            hist+=np.bincount(key,weights=wx*wy,minlength=bins*bins)
    p=hist.reshape(bins,bins);p/=max(p.sum(),1)
    def entropy(values):
        q=values[values>1e-12]
        return -np.sum(q*np.log(q))
    joint=entropy(p)
    if joint<.1:return 1.
    return float(2-(entropy(p.sum(0))+entropy(p.sum(1)))/joint)


def solve(payload):
    started=time.monotonic()
    if payload.get('schemaVersion')!='registration/2.0':raise ValueError('Unsupported registration schema')
    points=np.asarray(payload['points'],dtype=float)
    values=np.asarray(payload['values'],dtype=float)
    if points.ndim!=2 or points.shape[1]!=3 or not 1000<=len(points)<=40000 or values.shape!=(len(points),):
        raise ValueError('Need 1000-40000 XYZ points and one real intensity/colour value per point')
    if not np.isfinite(points).all() or not np.isfinite(values).all():raise ValueError('Nonfinite input')
    prior=payload['prior'];initial=pose_matrix(prior)
    if not np.isfinite(initial).all():raise ValueError('Invalid prior pose')
    encoded=payload['imageDataUrl'].split(',',1)[1]
    data=np.frombuffer(base64.b64decode(encoded,validate=True),dtype=np.uint8)
    image=cv2.imdecode(data,cv2.IMREAD_GRAYSCALE)
    if image is None or not 1.9<=image.shape[1]/image.shape[0]<=2.1:raise ValueError('Need a 2:1 spherical panorama')
    image=cv2.resize(image,(1536,768),interpolation=cv2.INTER_AREA)
    image=cv2.equalizeHist(image).astype(float)/255
    if np.std(values)<1e-5 or np.std(image)<.015:raise ValueError('Insufficient image / point signal variation')
    values=(rankdata(values,method='average')-.5)/len(values)
    ids=visible_indices(points,initial,768,384)
    if len(ids)<1000:raise ValueError('Too few visible points; check initial pose or cloud coverage')
    # Deterministic interleaved holdout: an optimization diagnostic, not ground truth.
    train=ids[np.arange(len(ids))%4!=0];hold=ids[np.arange(len(ids))%4==0]
    if len(train)>10000:train=train[np.linspace(0,len(train)-1,10000).astype(int)]
    if len(hold)>3500:hold=hold[np.linspace(0,len(hold)-1,3500).astype(int)]
    def transform(x):
        result=initial.copy();result[:3,3]+=np.asarray(x[:3])*.4
        result[:3,:3]=initial[:3,:3]@Rotation.from_rotvec(np.deg2rad(np.asarray(x[3:])*2)).as_matrix()
        return result
    def score(x,indices,picture):
        u,v,_=project(points[indices],transform(x),picture.shape[1],picture.shape[0])
        return nid(sample(picture,u,v),values[indices])
    origin=np.zeros(6);before=score(origin,train,image);held_before=score(origin,hold,image)
    results=[];bounds=[(-2,2)]*3+[(-3,3)]*3
    for yaw in (0,-1.5,1.5):
        if time.monotonic()-started>95:break
        seed=np.array([0,0,0,0,yaw,0.],dtype=float)
        coarse=cv2.GaussianBlur(image,(0,0),1.6)
        fit=minimize(lambda x:score(x,train,coarse),seed,method='Powell',bounds=bounds,
                     options={'maxiter':7,'maxfev':750,'xtol':.015,'ftol':1e-5})
        fine=minimize(lambda x:score(x,train,image),fit.x,method='Powell',bounds=bounds,
                      options={'maxiter':4,'maxfev':450,'xtol':.004,'ftol':1e-6})
        results.append((score(fine.x,hold,image),score(fine.x,train,image),fine.x))
    results.sort(key=lambda item:item[0]);held_after,after,x=results[0]
    result=transform(x);rotation_change=float(Rotation.from_matrix(initial[:3,:3].T@result[:3,:3]).magnitude()*180/np.pi)
    position_change=float(np.linalg.norm(result[:3,3]-initial[:3,3]))
    gain=before-after;held_gain=held_before-held_after
    controls=[]
    for offset in (-30,-15,15,30):
        wrong=result.copy();wrong[:3,:3]=result[:3,:3]@Rotation.from_euler('y',offset,degrees=True).as_matrix()
        u,v,_=project(points[hold],wrong,image.shape[1],image.shape[0])
        controls.append(nid(sample(image,u,v),values[hold]))
    control_nid=float(np.median(controls));contrast=control_nid-held_after
    # Do not confuse a lower training cost with successful calibration.
    accepted=bool(gain>.001 and held_gain>.0005 and held_after<.985 and contrast>.003
                  and position_change<1.25 and rotation_change<8
                  and np.max(np.abs(x[:3]))<1.97 and np.max(np.abs(x[3:]))<2.97)
    reason=('候选通过优化质量检查，仍需独立投影核验' if accepted else
            '信号证据不足、改善不稳定或达到搜索边界，已保留原位姿；请核对初值或使用同名点')
    return {'schemaVersion':'registration/2.0','frameId':payload['frameId'],'status':'candidate' if accepted else 'rejected',
        'reason':reason,'registration':{'position':result[:3,3].tolist(),
        'rotation':Rotation.from_matrix(result[:3,:3]).as_euler('YXZ',degrees=True).tolist()},
        'algorithmVersion':VERSION,'signal':payload.get('signal','intensity'),
        'metrics':{'nidBefore':before,'nidAfter':after,'holdoutBefore':held_before,'holdoutAfter':held_after,
          'visiblePoints':len(ids),'rotationChangeDeg':rotation_change,'positionChangeM':position_change,
          'durationSeconds':time.monotonic()-started,'starts':len(results),'controlNid':control_nid,'contrast':contrast},
        'independentlyVerified':False}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    if args.check:
        print(json.dumps({'ready':True,'algorithmVersion':VERSION,'weightsRequired':False}));return
    payload=json.load(sys.stdin)
    print(json.dumps(solve(payload),allow_nan=False))


if __name__=='__main__':main()
