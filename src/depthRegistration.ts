import * as THREE from 'three';
import { registrationQuaternion } from './geometry';
import { parsePose } from './registrationMath';
import { requestWithTimeout } from './prelabel';
import type { Registration, Vec3 } from './types';
import type { DepthRegistrationCandidate, DepthRegistrationMetrics } from './automaticRegistration';

export interface DepthBackendStatus {
  configured:boolean;label?:string;reason?:string;device?:string;
}
export interface DepthRegistrationResult {
  schemaVersion:'registration-depth/1.0';frameId:string;status:'candidate'|'rejected';reason:string;
  registration:Registration;algorithmVersion:string;signal:string;
  depthPreviewDataUrl:string;depthWidth:number;depthHeight:number;depthIsMetric:false;
  metrics:DepthRegistrationMetrics;cacheHit:boolean;durationSeconds:number;
  inference:{device:string;inferenceSeconds:number;peakGpuGiB:number};
}
export function depthInput(cloud:THREE.BufferGeometry,prior:Registration) {
  const xyz=cloud.getAttribute('position');
  if(!xyz)throw new Error('深度配准需要 XYZ 点云');
  const points:Vec3[]=[];
  const step=Math.max(1,Math.ceil(xyz.count/180000));
  for(let i=0;i<xyz.count;i+=step){
    const point:Vec3=[xyz.getX(i),xyz.getY(i),xyz.getZ(i)];
    const distance=Math.hypot(...point.map((v,j)=>v-prior.position[j]));
    if(point.every(Number.isFinite)&&distance>1.5&&distance<75)points.push(point);
  }
  if(points.length<1000)throw new Error('相机附近有效点不足 1000，请检查粗位姿和点云覆盖');
  const count=Math.min(28000,points.length);
  return {points:Array.from({length:count},(_,i)=>points[Math.floor(i*points.length/count)])};
}
export function validateDepthCandidate(payload:DepthRegistrationResult,prior:Registration):DepthRegistrationCandidate {
  if(payload.schemaVersion!=='registration-depth/1.0'||payload.status!=='candidate')throw new Error(payload.reason||'深度候选未通过几何检查');
  const registration=parsePose(payload.registration),m=payload.metrics;
  const keys:Array<keyof DepthRegistrationMetrics>=['depthBefore','depthAfter','holdoutBefore','holdoutAfter',
    'holdoutP75Before','holdoutP75After','scaleBefore','scaleAfter','visiblePoints','holdoutPoints',
    'rotationChangeDeg','positionChangeM','durationSeconds','starts','contrast','boundaryReached'];
  if(!m||!keys.every(k=>typeof m[k]==='number'&&Number.isFinite(m[k]))||
    m.depthBefore-m.depthAfter<=Math.max(.003,m.depthBefore*.025)||
    m.holdoutBefore-m.holdoutAfter<=Math.max(.002,m.holdoutBefore*.02)||
    m.holdoutP75After>m.holdoutP75Before||m.holdoutAfter>=.22||m.contrast<=.006||
    m.visiblePoints<1500||m.holdoutPoints<250||m.boundaryReached!==0||m.scaleBefore<=0||m.scaleAfter<=0||
    Math.abs(Math.log(m.scaleAfter/m.scaleBefore))>.21)
    throw new Error('深度候选指标不完整或几何证据不足，原位姿保留');
  const angle=THREE.MathUtils.radToDeg(registrationQuaternion(prior).angleTo(registrationQuaternion(registration)));
  const distance=Math.hypot(...registration.position.map((v,i)=>v-prior.position[i]));
  if(angle>=6||distance>=.85)throw new Error('深度候选超出局部修正范围，原位姿保留');
  return {method:'da2',registration,prior:structuredClone(prior),algorithmVersion:payload.algorithmVersion,
    signal:payload.signal,metrics:m};
}
export async function runDepthRegistration(cloud:THREE.BufferGeometry,imageUrl:string,frameId:string,prior:Registration,signal?:AbortSignal) {
  const sampled=depthInput(cloud,prior);
  const image=new Image();image.src=imageUrl;await image.decode();
  if(signal?.aborted)throw new DOMException('已取消','AbortError');
  if(image.width/image.height<1.9||image.width/image.height>2.1)throw new Error('需要 2:1 等距柱状全景');
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=768;
  const context=canvas.getContext('2d');if(!context)throw new Error('无法读取全景像素');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const response=await requestWithTimeout('/api/registration/depth',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({schemaVersion:'registration-depth/1.0',frameId,prior,...sampled,
      imageDataUrl:canvas.toDataURL('image/jpeg',.94)})},310000,signal);
  const result=await response.json() as DepthRegistrationResult & {error?:string};
  if(!response.ok)throw new Error(result.error??'DA2 推理失败');
  if(result.frameId!==frameId||result.schemaVersion!=='registration-depth/1.0'||
    !['candidate','rejected'].includes(result.status)||result.depthIsMetric!==false||
    typeof result.depthPreviewDataUrl!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result.depthPreviewDataUrl))
    throw new Error('DA2 返回了无效或帧号不匹配的深度结果');
  return result;
}
