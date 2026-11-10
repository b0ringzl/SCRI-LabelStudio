import * as THREE from 'three';
import { registrationQuaternion } from './geometry';
import { parsePose } from './registrationMath';
import { requestWithTimeout } from './prelabel';
import type { Registration, Vec3 } from './types';

export interface RegistrationMetrics {
  nidBefore:number;nidAfter:number;holdoutBefore:number;holdoutAfter:number;
  visiblePoints:number;rotationChangeDeg:number;positionChangeM:number;durationSeconds:number;starts:number;controlNid:number;contrast:number;
}
export interface NidRegistrationCandidate {
  method:'nid';
  registration:Registration;prior:Registration;algorithmVersion:string;signal:string;metrics:RegistrationMetrics;
}
export interface DepthRegistrationMetrics {
  depthBefore:number;depthAfter:number;holdoutBefore:number;holdoutAfter:number;
  holdoutP75Before:number;holdoutP75After:number;scaleBefore:number;scaleAfter:number;
  visiblePoints:number;holdoutPoints:number;rotationChangeDeg:number;positionChangeM:number;
  durationSeconds:number;starts:number;contrast:number;boundaryReached:number;
}
export interface DepthRegistrationCandidate {
  method:'da2';registration:Registration;prior:Registration;algorithmVersion:string;signal:string;
  metrics:DepthRegistrationMetrics;
}
export type AutoRegistrationCandidate = NidRegistrationCandidate | DepthRegistrationCandidate;
export function candidateSummary(candidate:AutoRegistrationCandidate) {
  return candidate.method==='da2'
    ? `DA² 留出区域深度残差 ${candidate.metrics.holdoutBefore.toFixed(3)} → ${candidate.metrics.holdoutAfter.toFixed(3)}`
    : `NID ${candidate.metrics.nidBefore.toFixed(4)} → ${candidate.metrics.nidAfter.toFixed(4)}`;
}
export function registrationInput(cloud:THREE.BufferGeometry,prior:Registration) {
  const xyz=cloud.getAttribute('position'),intensity=cloud.getAttribute('intensity');
  const color=cloud.userData.generatedColors?undefined:(cloud.getAttribute('sourceColor')??cloud.getAttribute('color'));
  if(!xyz||(!intensity&&!color))throw new Error('自动配准需要原始强度或真实 RGB；显示伪彩不能代替');
  const points:Vec3[]=[],values:number[]=[];
  const step=Math.max(1,Math.ceil(xyz.count/180000));
  for(let i=0;i<xyz.count;i+=step){
    const point:Vec3=[xyz.getX(i),xyz.getY(i),xyz.getZ(i)];
    const distance=Math.hypot(...point.map((v,j)=>v-prior.position[j]));
    const value=intensity?intensity.getX(i):.2126*color!.getX(i)+.7152*color!.getY(i)+.0722*color!.getZ(i);
    if(point.every(Number.isFinite)&&Number.isFinite(value)&&distance>1.5&&distance<75){points.push(point);values.push(value);}
  }
  if(points.length<1000)throw new Error('初始相机附近有效点不足 1000；请检查点云覆盖与粗位姿');
  const count=Math.min(28000,points.length);
  const indices=Array.from({length:count},(_,i)=>Math.floor(i*points.length/count));
  return {points:indices.map(i=>points[i]),values:indices.map(i=>values[i]),signal:intensity?'intensity':'rgb-luminance'};
}
export function validateCandidate(payload:Record<string,unknown>,prior:Registration):AutoRegistrationCandidate {
  if(payload.schemaVersion!=='registration/2.0'||payload.status!=='candidate')throw new Error(String(payload.reason??'自动配准未生成可靠候选，原位姿保留'));
  const registration=parsePose(payload.registration),metrics=payload.metrics as RegistrationMetrics;
  const keys: Array<keyof RegistrationMetrics> = ['nidBefore','nidAfter','holdoutBefore','holdoutAfter','visiblePoints','rotationChangeDeg','positionChangeM','durationSeconds','starts','controlNid','contrast'];
  if(!metrics||!keys.every(key=>typeof metrics[key]==='number'&&Number.isFinite(metrics[key]))||
    metrics.nidBefore-metrics.nidAfter<=.001||metrics.holdoutBefore-metrics.holdoutAfter<=.0005||
    metrics.holdoutAfter>=.985||metrics.contrast<=.003||metrics.visiblePoints<1000)
    throw new Error('候选质量指标不完整或没有改善');
  const angle=THREE.MathUtils.radToDeg(registrationQuaternion(prior).angleTo(registrationQuaternion(registration)));
  const distance=Math.hypot(...registration.position.map((v,i)=>v-prior.position[i]));
  if(angle>8||distance>1.25)throw new Error('候选修正超出局部精配准范围，原位姿保留');
  return {method:'nid',registration,prior:structuredClone(prior),algorithmVersion:String(payload.algorithmVersion),signal:String(payload.signal),metrics};
}
export async function runAutomaticRegistration(cloud:THREE.BufferGeometry,imageUrl:string,frameId:string,prior:Registration,signal?:AbortSignal) {
  const sampled=registrationInput(cloud,prior);
  const image=new Image();image.src=imageUrl;await image.decode();
  if(signal?.aborted)throw new DOMException('已取消','AbortError');
  if(image.width/image.height<1.9||image.width/image.height>2.1)throw new Error('需要 2:1 等距柱状全景');
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=768;
  const context=canvas.getContext('2d');if(!context)throw new Error('无法读取全景像素');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const response=await requestWithTimeout('/api/registration/automatic',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({schemaVersion:'registration/2.0',frameId,prior,...sampled,imageDataUrl:canvas.toDataURL('image/jpeg',.94)})},190000,signal);
  const payload=await response.json();if(!response.ok)throw new Error(payload.error??'自动配准失败');
  if(payload.frameId!==frameId)throw new Error('候选帧不匹配');
  return validateCandidate(payload,prior);
}
