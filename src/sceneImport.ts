import { parseCalibrationDocument } from './registrationIO';
import type { PairTask, PanoramaFrame, Registration, RegistrationEvidence } from './types';

export interface LocalSceneManifest {
  schemaVersion: string; id: string; name: string; location: string;
  pointCloudName: string; pointCloudUrl: string; frames: Array<{name:string;url:string}>;
  registration: unknown; baseFrameName: string; createdAt: string;
  registrationSource?: 'imported' | 'ins-approximate';
  coverage?: { summary?: string; fullMapCoverage?: boolean };
  scenes?: Array<{key:string;name:string}>; sceneKey?: string;
  pointDisplayRanges?: Array<{start:number;count:number;spacing:number}>;
}

export function frameHasPose(frame: PanoramaFrame, saved?: Registration, isDemo?: boolean): boolean {
  return Boolean(frame.initialRegistration || saved || isDemo);
}

export function prepareLocalScene(data: LocalSceneManifest) {
  if (data.schemaVersion!=='local-scene/1.0' || !data.id || !data.frames?.length) throw new Error('本机场景清单无效');
  const imported=parseCalibrationDocument(data.registration,data.frames.map((f)=>f.name));
  const frames: PanoramaFrame[]=data.frames.map((frame,i)=>({id:`${data.id}-F${i}`,name:frame.name,url:frame.url,
    utcSeconds:imported.frames[frame.name]?.utcSeconds,initialRegistration:imported.frames[frame.name]?.registration}));
  const source=data.registrationSource==='ins-approximate' ? 'ins-approximate' : 'imported';
  const coverageLabel=data.coverage?.summary ?? (data.coverage?.fullMapCoverage ? '全地图降采样 · 无空间裁剪' : '覆盖范围未提供');
  const task: PairTask={id:data.id,name:data.name,location:data.location,pointCloudName:data.pointCloudName,
    pointCloudUrl:data.pointCloudUrl,panoramaName:frames[0].name,panoramaUrl:frames[0].url,frames,
    initialPoseSource:source,coverageLabel,pointDisplayRanges:data.pointDisplayRanges,createdAt:data.createdAt};
  const registrations: Record<string,Registration>={}; const evidence: Record<string,RegistrationEvidence>={};
  for (const frame of frames) if(frame.initialRegistration) {registrations[frame.id]=frame.initialRegistration;evidence[frame.id]={source,updatedAt:''};}
  return {task,frames,registrations,evidence,baseIndex:Math.max(0,frames.findIndex((f)=>f.name===data.baseFrameName)),warning:imported.warning};
}
