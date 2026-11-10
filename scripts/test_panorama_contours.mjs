import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';

const directory=await mkdtemp(join(tmpdir(),'scri-contours-'));
try {
  async function module(name){const file=join(directory,name+'.mjs');await build({entryPoints:[resolve('src/'+name+'.ts')],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});return import(pathToFileURL(file).href);}
  const {makeObservation,observationVertices,contourPlane,insidePolygon,replaceObservation}=await module('panoramaContours');
  const {triangulateTarget}=await module('registrationMath');
  const {pointToPanorama}=await module('geometry');
  const {AnnotationHistory}=await module('annotationHistory');
  const polygon=[[.46,.42],[.53,.44],[.55,.6],[.47,.57]];
  const a=makeObservation('a',polygon);
  assert.deepEqual(a.vertices,polygon);polygon[0][0]=.45;
  assert.equal(a.vertices[0][0],.46,'observations own their vertices');
  const seam=makeObservation('seam',[[.98,.42],[.02,.44],[.025,.57],[.975,.58]]);
  assert(seam.center[0]<.03||seam.center[0]>.97,'center wraps at panorama seam');
  assert.equal(contourPlane(seam.vertices).polygon.length,4);
  assert.deepEqual(observationVertices({bounds:[.4,.3,.6,.7]}),[[.4,.3],[.6,.3],[.6,.7],[.4,.7]]);
  assert(insidePolygon([.5,.25],[[0,0],[1,0],[1,1],[.5,.5],[0,1]]));
  assert(!insidePolygon([.5,.8],[[0,0],[1,0],[1,1],[.5,.5],[0,1]]),'concave notch excluded');
  assert.throws(()=>makeObservation('a',[[.4,.4],[.6,.6],[.4,.6],[.6,.4]]),/相交/);
  assert.throws(()=>makeObservation('a',[[.4,.4],[.4,.4],[.6,.5]]),/重合/);
  assert.throws(()=>makeObservation('a',[[.4,.4],[.6,.5]]),/3–256/);
  const original={id:'target',observations:[a,seam],pointCloud:{center:[0,0,-10]},triangulation:{reviewed:true}};
  const edited=replaceObservation(original,'a',[[.45,.42],[.53,.44],[.55,.6],[.47,.57]]);
  assert.equal(edited.pointCloud,undefined);assert.equal(edited.triangulation,undefined);
  assert.deepEqual(edited.observations.find(o=>o.frameId==='seam'),seam,'editing one frame preserves others');
  assert.equal(original.triangulation.reviewed,true,'editing does not mutate history snapshots');

  // Slanted wall + background + nearby ground. Exact silhouette must exclude bbox-only clutter.
  const poses={a:{position:[-2,1.6,0],rotation:[0,0,0]},b:{position:[2,1.6,0],rotation:[0,0,0]}};
  const wall=(x,y)=>[x,y,-10+.4*x];
  const corners=[wall(-1.5,.5),wall(1.5,.5),wall(1.5,3.5),wall(-1.5,3.5)];
  const observations=Object.entries(poses).map(([id,pose])=>makeObservation(id,corners.map(p=>pointToPanorama(p,pose))));
  const points=[];
  for(let x=-1.5;x<=1.5+.001;x+=.06)for(let y=.5;y<=3.5+.001;y+=.06)points.push(...wall(x,y));
  const wallCount=points.length/3;
  for(let x=-6;x<=6;x+=.12)for(let y=0;y<=5;y+=.12)points.push(x,y,-18);
  for(let x=-5;x<=5;x+=.12)for(let z=-8;z>=-13;z-=.12)points.push(x,0,z);
  const cloud=new THREE.BufferGeometry();cloud.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const result=triangulateTarget(observations,poses,cloud);
  assert.equal(result.method,'silhouette');
  assert(result.supportPointCount>2000 && result.supportPointCount<=wallCount);
  assert(Math.abs(result.cuboid.center[2]+10)<.08,JSON.stringify(result.cuboid));
  assert(Math.abs(result.cuboid.center[1]-2)<.08);
  assert(result.cuboid.size[2]<.15,'background does not inflate wall thickness');
  assert(Math.abs(result.cuboid.yaw+THREE.MathUtils.radToDeg(Math.atan(.4)))<.2,'yaw follows the wall');
  // Per-frame poses and seam placement must not depend on this scene's heading.
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
  const rotated=[...points]; // construct a different cloud without altering the first result
  for(let i=0;i<rotated.length;i+=3){const p=new THREE.Vector3(...points.slice(i,i+3)).applyQuaternion(rotation);rotated[i]=p.x;rotated[i+1]=p.y;rotated[i+2]=p.z;}
  const poses2=Object.fromEntries(Object.entries(poses).map(([id,p])=>[id,{position:new THREE.Vector3(...p.position).applyQuaternion(rotation).toArray(),rotation:[0,0,0]}]));
  const obs2=Object.entries(poses2).map(([id,p])=>makeObservation(id,corners.map(c=>pointToPanorama(new THREE.Vector3(...c).applyQuaternion(rotation).toArray(),p))));
  const cloud2=new THREE.BufferGeometry();cloud2.setAttribute('position',new THREE.Float32BufferAttribute(rotated,3));
  const result2=triangulateTarget(obs2,poses2,cloud2);assert(Math.abs(result2.cuboid.center[2]-10)<.08,'seam silhouette also fits');
  assert.throws(()=>triangulateTarget(observations,poses,new THREE.BufferGeometry()),/加载点云/);
  cloud.dispose();cloud2.dispose();

  // A thick rotated wall: points on each side are hidden from the opposite view.
  // Complete silhouettes constrain the body; visibility is required in at least one view.
  const volumePoses={a:{position:[-4,1.5,0],rotation:[0,0,0]},b:{position:[4,1.5,0],rotation:[0,0,0]}};
  const yaw=25*Math.PI/180,rotation3=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const toWorld=(x,y,z)=>new THREE.Vector3(x,y,z).applyQuaternion(rotation3).add(new THREE.Vector3(0,1.5,-10)).toArray();
  const cubeCorners=[];for(const x of [-2,2])for(const y of [-1.5,1.5])for(const z of [-.9,.9])cubeCorners.push(toWorld(x,y,z));
  const outline=(pose)=>{
    const projected=cubeCorners.map(p=>({p,xy:[(p[0]-pose.position[0])/(pose.position[2]-p[2]),(p[1]-pose.position[1])/(pose.position[2]-p[2])]})).sort((a,b)=>a.xy[0]-b.xy[0]||a.xy[1]-b.xy[1]);
    const cross=(a,b,c)=>(b.xy[0]-a.xy[0])*(c.xy[1]-a.xy[1])-(b.xy[1]-a.xy[1])*(c.xy[0]-a.xy[0]);
    const half=(list)=>{const h=[];for(const p of list){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
    const lower=half(projected),upper=half([...projected].reverse());lower.pop();upper.pop();return [...lower,...upper].map(c=>pointToPanorama(c.p,pose));
  };
  const bodyObservations=Object.entries(volumePoses).map(([id,p])=>makeObservation(id,outline(p),'object'));
  const volumePoints=[];
  for(let y=-1.5;y<=1.5001;y+=.075){
    for(let x=-2;x<=2.0001;x+=.075)for(const z of [-.9,.9])volumePoints.push(...toWorld(x,y,z));
    for(let z=-.9;z<=.9001;z+=.075)for(const x of [-2,2])volumePoints.push(...toWorld(x,y,z));
  }
  for(let x=-8;x<=8;x+=.12)for(let y=-2;y<=6;y+=.12)volumePoints.push(x,y,-22);
  const volumeCloud=new THREE.BufferGeometry();volumeCloud.setAttribute('position',new THREE.Float32BufferAttribute(volumePoints,3));
  const body=triangulateTarget(bodyObservations,volumePoses,volumeCloud);
  const flattened=triangulateTarget(bodyObservations.map(o=>({...o,extent:'surface'})),volumePoses,volumeCloud);
  assert.equal(body.extent,'object');
  assert(Math.abs(body.cuboid.size[2]-1.88)<.22,`physical thickness is retained: ${JSON.stringify(body)}`);
  assert(Math.abs(body.cuboid.size[0]-4.08)<.22);
  assert(Math.abs(body.cuboid.yaw-25)<1,'L-shaped side samples must not skew the wall axes');
  assert(body.supportPointCount>flattened.supportPointCount,'side points seen in only one frame must survive');
  assert(Math.hypot(...body.cuboid.center.map((n,i)=>n-[0,1.5,-10][i]))<.18,'box stays on the wall, not the distant background');
  assert.throws(()=>triangulateTarget([bodyObservations[0],{...bodyObservations[1],extent:'surface'}],volumePoses,volumeCloud),/范围不一致/);
  const retained=replaceObservation({...original,observations:bodyObservations},'a',bodyObservations[0].vertices);
  assert.equal(retained.observations.find(o=>o.frameId==='a').extent,'object','moving a vertex retains coverage semantics');
  volumeCloud.dispose();

  const history=new AnnotationHistory();
  const first={annotations:[original],draft:[],frameIndex:0,selectedId:'target',vertex:0,tool:'target-box',rectangle:false,extent:'surface'};
  const second={...first,annotations:[edited],frameIndex:1};
  history.record(first);assert.deepEqual(history.undo(second),first,'one committed drag undoes in one step');
  assert.deepEqual(history.redo(first),second,'redo restores edited frame and invalidated candidate');
  history.undo(second);history.record({...first,draft:[[.5,.5]]});assert.equal(history.redoStack.length,0);
  for(let i=0;i<70;i++)history.record({...first,frameIndex:i});assert.equal(history.undoStack.length,60);
  history.clear();assert.equal(history.undoStack.length,0);assert.equal(history.redoStack.length,0);
  console.log('Contour validation, legacy rectangles, concavity, seam, multi-view visible-point fitting, derived-result invalidation and undo/redo passed');
} finally {const target=resolve(directory);assert(target.startsWith(resolve(tmpdir())+sep));await rm(target,{recursive:true,force:true});}
