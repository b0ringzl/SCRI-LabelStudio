import * as THREE from 'three';
import { directionToPanorama, panoramaToDirection, registrationQuaternion } from './geometry';
import type { Annotation, Registration, TargetObservation, UV, Vec3 } from './types';

export function observationVertices(observation: TargetObservation): UV[] {
  if(observation.vertices)return observation.vertices;
  const [a,b,c,d]=observation.bounds;
  return [[a,b],[c,b],[c,d],[a,d]];
}

export function insidePolygon(point: UV, polygon: UV[]): boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [x,y]=point,[a,b]=polygon[j],[c,d]=polygon[i];
    const cross=(x-a)*(d-b)-(y-b)*(c-a);
    if(Math.abs(cross)<1e-10&&x>=Math.min(a,c)-1e-10&&x<=Math.max(a,c)+1e-10&&y>=Math.min(b,d)-1e-10&&y<=Math.max(b,d)+1e-10)return true;
    if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
  }
  return inside;
}

export function contourPlane(vertices: UV[]) {
  if(vertices.length<3||vertices.length>256||vertices.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))||p[0]<0||p[0]>1||p[1]<0||p[1]>1))throw new Error('轮廓需要 3–256 个有效顶点');
  const directions=vertices.map(panoramaToDirection);
  const normal=directions.reduce((s,v)=>s.add(v),new THREE.Vector3()).normalize();
  const x=new THREE.Vector3(0,1,0).cross(normal);
  if(x.lengthSq()<1e-8)x.set(1,0,0).cross(normal);
  x.normalize();const y=normal.clone().cross(x).normalize();
  const polygon:UV[]=directions.map(d=>{const z=d.dot(normal);if(z<.1)throw new Error('轮廓跨度过大，请拆分目标');return[d.dot(x)/z,d.dot(y)/z];});
  const cross=(a:UV,b:UV,c:UV)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let twiceArea=0;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7)throw new Error('相邻顶点重合，请移动或删除重复点');
    twiceArea+=a[0]*b[1]-b[0]*a[1];
    for(let j=i+2;j<polygon.length;j++) {
      if(i===0&&j===polygon.length-1)continue;
      const c=polygon[j],d=polygon[(j+1)%polygon.length];
      if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&
        Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&
        Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))throw new Error('轮廓边相交，请调整顶点顺序');
    }
  }
  if(Math.abs(twiceArea)<1e-9)throw new Error('轮廓面积过小');
  const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  return {normal,x,y,polygon,minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
}

export function makeObservation(frameId:string,vertices:UV[],extent:'surface'|'object'='surface'):TargetObservation {
  const plane=contourPlane(vertices);
  let u=vertices.map(p=>{let d=p[0]-vertices[0][0];if(d>.5)d--;if(d<-.5)d++;return vertices[0][0]+d;});
  const wrap=(v:number)=>((v%1)+1)%1;
  return {frameId,extent,vertices:vertices.map(p=>[...p]),center:directionToPanorama(plane.normal),
    bounds:[wrap(Math.min(...u)),Math.min(...vertices.map(p=>p[1])),wrap(Math.max(...u)),Math.max(...vertices.map(p=>p[1]))]};
}

export function replaceObservation(annotation:Annotation,frameId:string,vertices:UV[]):Annotation {
  const previous=annotation.observations?.find(o=>o.frameId===frameId);
  return {...annotation,observations:[...(annotation.observations??[]).filter(o=>o.frameId!==frameId),makeObservation(frameId,vertices,previous?.extent??'surface')],
    ...(annotation.triangulation?{pointCloud:undefined,triangulation:undefined}:{})};
}

export function fitSilhouetteTarget(observations:TargetObservation[],poses:Record<string,Registration>,cloud:THREE.BufferGeometry|null|undefined) {
  const extent=observations[0]?.extent??'surface';
  if(observations.some(o=>(o.extent??'surface')!==extent))throw new Error('轮廓范围不一致：请逐帧统一为“完整物体”或“单个表面”，并检查完整外轮廓是否包含侧面');
  const position=cloud?.getAttribute('position');
  if(!position)throw new Error('轮廓定位需要加载点云');
  const masks=observations.map(o=>{
    const plane=contourPlane(observationVertices(o)),q=registrationQuaternion(poses[o.frameId]);
    return {...plane,normal:plane.normal.applyQuaternion(q),x:plane.x.applyQuaternion(q),y:plane.y.applyQuaternion(q),origin:poses[o.frameId].position,
      depths:new Float32Array(64*64).fill(Infinity)};
  });
  function project(mask:typeof masks[number],px:number,py:number,pz:number) {
    const dx=px-mask.origin[0],dy=py-mask.origin[1],dz=pz-mask.origin[2];
    const z=dx*mask.normal.x+dy*mask.normal.y+dz*mask.normal.z;if(z<=.1)return null;
    const x=(dx*mask.x.x+dy*mask.x.y+dz*mask.x.z)/z,y=(dx*mask.y.x+dy*mask.y.y+dz*mask.y.z)/z;
    if(x<mask.minX||x>mask.maxX||y<mask.minY||y>mask.maxY||!insidePolygon([x,y],mask.polygon))return null;
    return {z,column:Math.min(63,Math.floor(64*(x-mask.minX)/(mask.maxX-mask.minX))),row:Math.min(63,Math.floor(64*(y-mask.minY)/(mask.maxY-mask.minY)))};
  }
  // First visible depth per angular cell suppresses returns behind the silhouette.
  for(let i=0;i<position.count;i++)for(const mask of masks){const p=project(mask,position.getX(i),position.getY(i),position.getZ(i));if(p){const key=p.row*64+p.column;mask.depths[key]=Math.min(mask.depths[key],p.z);}}
  const candidates:number[]=[];
  for(let i=0;i<position.count;i++) {
    const px=position.getX(i),py=position.getY(i),pz=position.getZ(i);
    let inEveryMask=true,visibleCount=0;
    for(const mask of masks){const p=project(mask,px,py,pz);if(!p){inEveryMask=false;break;}let depth=Infinity;
      for(let y=Math.max(0,p.row-1);y<=Math.min(63,p.row+1);y++)for(let x=Math.max(0,p.column-1);x<=Math.min(63,p.column+1);x++)depth=Math.min(depth,mask.depths[y*64+x]);
      if(p.z<=depth+.4)visibleCount++;
    }
    // Object surfaces can be hidden in one frame and visible in another.
    // Never union the image masks themselves: all silhouettes still constrain the object.
    if(inEveryMask && (extent==='object'?visibleCount>0:visibleCount===masks.length))candidates.push(i);
  }
  if(candidates.length<12)throw new Error('轮廓交集内可见点不足 12 个，请检查配准、轮廓或增加清晰观测');
  // Largest connected voxel component; never fit unrelated disconnected returns together.
  const cells=new Map<string,number[]>(),cell=.35;
  for(const i of candidates){const key=[position.getX(i),position.getY(i),position.getZ(i)].map(v=>Math.floor(v/cell)).join(',');const list=cells.get(key);if(list)list.push(i);else cells.set(key,[i]);}
  let best:number[]=[];
  while(cells.size){const key=cells.keys().next().value!;const queue=[key],queued=new Set([key]),component:number[]=[];
    for(let n=0;n<queue.length;n++){const k=queue[n],items=cells.get(k);if(!items)continue;cells.delete(k);for(const item of items)component.push(item);const [a,b,c]=k.split(',').map(Number);
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const next=`${a+x},${b+y},${c+z}`;if(cells.has(next)&&!queued.has(next)){queued.add(next);queue.push(next);}}}
    if(component.length>best.length)best=component;
  }
  if(best.length<12)throw new Error('点云分布过于零散，无法拟合可靠候选');
  const samples:Vec3[]=best.map(i=>[position.getX(i),position.getY(i),position.getZ(i)]);
  const mx=samples.reduce((s,p)=>s+p[0],0)/samples.length,mz=samples.reduce((s,p)=>s+p[2],0)/samples.length;
  let xx=0,xz=0,zz=0;for(const p of samples){xx+=(p[0]-mx)**2;xz+=(p[0]-mx)*(p[2]-mz);zz+=(p[2]-mz)**2;}
  const yaw=extent==='object'?minimumAreaYaw(samples):-.5*Math.atan2(2*xz,xx-zz),c=Math.cos(yaw),s=Math.sin(yaw);
  const local=samples.map(([x,y,z])=>[c*(x-mx)-s*(z-mz),y,s*(x-mx)+c*(z-mz)]);
  const quantile=(column:number,f:number)=>{const a=local.map(p=>p[column]).sort((a,b)=>a-b);return a[Math.round((a.length-1)*f)];};
  const low=[0,1,2].map(i=>quantile(i,.01)),high=[0,1,2].map(i=>quantile(i,.99)),center=low.map((v,i)=>(v+high[i])/2);
  return {cuboid:{kind:'cuboid' as const,center:[mx+c*center[0]+s*center[2],center[1],mz-s*center[0]+c*center[2]] as Vec3,
    size:low.map((v,i)=>Math.max(.12,high[i]-v+.08)) as Vec3,yaw:THREE.MathUtils.radToDeg(yaw)},supportPointCount:best.length,extent};
}

/** A facade + side form an L-shaped sample, whose PCA axis is not the wall's axis. */
function minimumAreaYaw(samples:Vec3[]) {
  const sorted=samples.map(p=>[p[0],p[2]] as UV).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const points=sorted.filter((p,i)=>!i || p[0]!==sorted[i-1][0] || p[1]!==sorted[i-1][1]);
  if(points.length<2)throw new Error('水平点分布不足以确定体积方向');
  const cross=(a:UV,b:UV,c:UV)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(list:UV[])=>{const result:UV[]=[];for(const p of list){while(result.length>=2&&cross(result.at(-2)!,result.at(-1)!,p)<=0)result.pop();result.push(p);}return result;};
  const lower=half(points),upper=half([...points].reverse());lower.pop();upper.pop();const hull=[...lower,...upper];
  let bestArea=Infinity,bestYaw=0;
  // Bound the orientation search for noisy, round objects; no scene-specific axis is assumed.
  const stride=Math.max(1,Math.ceil(hull.length/256));
  for(let i=0;i<hull.length;i+=stride){const a=hull[i],b=hull[(i+1)%hull.length],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
    const c=Math.cos(angle),s=Math.sin(angle);let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const [x,z] of hull){const u=c*x+s*z,v=-s*x+c*z;minX=Math.min(minX,u);maxX=Math.max(maxX,u);minZ=Math.min(minZ,v);maxZ=Math.max(maxZ,v);}
    const width=maxX-minX,depth=maxZ-minZ,area=width*depth;
    if(area<bestArea-1e-9){bestArea=area;bestYaw=-angle+(width<depth?Math.PI/2:0);}
  }
  while(bestYaw>Math.PI/2)bestYaw-=Math.PI;while(bestYaw<=-Math.PI/2)bestYaw+=Math.PI;
  return bestYaw;
}
