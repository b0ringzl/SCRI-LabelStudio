import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { Crosshair, Minus, Plus, Redo2, RotateCw, Undo2 } from 'lucide-react';
import { intensityLimits } from './cloudDisplay';
import { clamp, registrationQuaternion } from './geometry';
import { angleAt, footprintCorners, footprintOf, indexGround, MARKING_TYPES, MIN_SIDE, normalizeYaw, offset, placeFootprint, resizeFootprint, rotate } from './roadMarking';
import type { Footprint, XZ } from './roadMarking';
import type { Annotation, Registration, RoadMarkingBox, RoadMarkingType } from './types';
import './roadMarking.css';

interface Props {
  geometry: BufferGeometry;
  registration: Registration;
  hasPose: boolean;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (box: RoadMarkingBox) => void;
  onEdit: (id: string, box: RoadMarkingBox) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

type Drag = { kind: 'draw' | 'pan'; start: XZ; center: XZ; pixels: XZ }
  | { kind:'move' | 'rotate' | 'resize'; start: XZ; box: Footprint; id: string; type: RoadMarkingType; corner: number };

export default function RoadMarkingView({geometry, registration, hasPose, annotations, selectedId, onSelect, onCreate, onEdit, undo, redo, canUndo, canRedo}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size,setSize] = useState<XZ>([0,0]);
  const [scale,setScale] = useState(17);
  const camera = useMemo(() => {
    if(!hasPose) {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
      const xz:XZ = [center.x,center.z];
      return {here:xz,yaw:0,center:xz};
    }
    const ahead = new Vector3(0,0,-1).applyQuaternion(registrationQuaternion(registration));
    const here: XZ = [registration.position[0],registration.position[2]];
    return {here, yaw:angleAt([0,0],[ahead.x,ahead.z]), center:offset(here,[ahead.x*8,ahead.z*8])};
  }, [geometry,hasPose,registration]);
  const [center,setCenter] = useState<XZ>(camera.center);
  const [type,setType] = useState<RoadMarkingType>('diamond');
  const [draft,setDraft] = useState<{box:Footprint; id?:string} | null>(null);
  const [message,setMessage] = useState('');
  const ground = useMemo(() => indexGround(geometry),[geometry]);
  const intensity = geometry.getAttribute('intensity');
  const [low,high] = useMemo(() => {
    if (!intensity) return [0,1];
    const values:number[]=[];
    let seen=0;
    ground.forEachIn(offset(camera.center,[-26,-26]),offset(camera.center,[26,26]),index=>{
      if (seen++%8===0) {
        const value=intensity.getX(index);
        if (Number.isFinite(value)) values.push(value);
      }
    });
    values.sort((a,b)=>a-b);
    const low=values[Math.floor((values.length-1)*.05)], high=values[Math.floor((values.length-1)*.96)];
    return high>low && values.length>64 ? [low,high] : intensityLimits(intensity);
  },[ground,intensity,camera]);
  const chosen = annotations.find(a=>a.id===selectedId && a.visible && a.roadMarking);
  const toScreen = ([x,z]:XZ):XZ => [(x-center[0])*scale+size[0]/2,(z-center[1])*scale+size[1]/2];
  const toWorld = ([x,y]:XZ):XZ => [(x-size[0]/2)/scale+center[0],(y-size[1]/2)/scale+center[1]];
  const reset = () => {setCenter(camera.center);setScale(17);setMessage('');};

  useLayoutEffect(() => {
    const element = host.current!;
    const observer = new ResizeObserver(() => setSize([element.clientWidth,element.clientHeight]));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el=host.current!;
    const wheel = (event:WheelEvent) => {
      if (event.target !== el && !(event.target as Element).closest('.road-marking-drawing')) return;
      event.preventDefault();
      if(drag.current) return;
      const bounds=el.getBoundingClientRect();
      const local:XZ=[event.clientX-bounds.left,event.clientY-bounds.top];
      const anchor=toWorld(local);
      const next=clamp(scale*Math.exp(-event.deltaY*.0017),3,180);
      setCenter([anchor[0]-(local[0]-size[0]/2)/next,anchor[1]-(local[1]-size[1]/2)/next]);
      setScale(next);
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return () => el.removeEventListener('wheel',wheel);
  });

  useEffect(() => {
    const [width,height]=size;
    const context=canvas.current?.getContext('2d');
    if (!context || !width || !height) return;
    const raster=context.createImageData(width,height);
    const {data}=raster;
    for (let i=0;i<data.length;i+=4) {
      data[i]=19;data[i+1]=26;data[i+2]=35;data[i+3]=255;
    }
    const position=geometry.getAttribute('position');
    const rgb=geometry.userData.generatedColors ? undefined : geometry.getAttribute('sourceColor') ?? geometry.getAttribute('color');
    const x0=center[0]-width/(2*scale), z0=center[1]-height/(2*scale);
    const radius=clamp(Math.round(scale*.06),1,3);
    ground.forEachIn([x0,z0],[x0+width/scale,z0+height/scale],index=>{
      const x=Math.round((position.getX(index)-x0)*scale), y=Math.round((position.getZ(index)-z0)*scale);
      const value=intensity ? (intensity.getX(index)-low)/(high-low)
        : rgb ? Math.sqrt(Math.max(0,.21*rgb.getX(index)+.72*rgb.getY(index)+.07*rgb.getZ(index))) : .44;
      const brightness=39+216*clamp(Number.isFinite(value)?value:0,0,1)**1.08;
      for(let yy=Math.max(0,y-radius);yy<Math.min(height,y+radius+1);yy++){
        for(let xx=Math.max(0,x-radius);xx<Math.min(width,x+radius+1);xx++){
          const i=(yy*width+xx)*4;
          if(data[i]<brightness) {data[i]=brightness;data[i+1]=brightness;data[i+2]=Math.min(255,brightness+5);}
        }
      }
    });
    context.putImageData(raster,0,0);
  }, [center,scale,size,geometry,ground,intensity,low,high]);

  const localPoint=(event:PointerEvent<SVGSVGElement>):XZ=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return [event.clientX-bounds.left,event.clientY-bounds.top];
  };

  function start(event:PointerEvent<SVGSVGElement>) {
    if (![0,1,2].includes(event.button) || drag.current) return;
    const pixels=localPoint(event), world=toWorld(pixels);
    const target=(event.target as Element).closest<SVGGElement>('[data-road-box]');
    const annotation=annotations.find(a=>a.id===target?.dataset.roadBox && a.visible);
    const box=annotation?.roadMarking;
    const action=(event.target as Element).getAttribute('data-drag');
    if(event.button!==0 || (event.shiftKey && action!=='rotate')) drag.current={kind:'pan',start:world,center,pixels};
    else if(annotation && box) {
      if(annotation.id!==selectedId) onSelect(annotation.id);
      drag.current={kind:action==='rotate'?'rotate':action==='resize'?'resize':'move',start:world,box:footprintOf(box),id:annotation.id,type:box.type,corner:Number((event.target as Element).getAttribute('data-corner'))};
    } else drag.current={kind:'draw',start:world,center,pixels};
    setMessage('');
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function shapeAt(active: Drag, cursor: XZ, snap: boolean): Footprint | undefined {
    const dx=cursor[0]-active.start[0], dz=cursor[1]-active.start[1];
    if(active.kind==='pan') return;
    if(active.kind==='draw') {
      return {center:[active.start[0]+dx/2,active.start[1]+dz/2],size:[Math.abs(dx),Math.abs(dz)],yaw:0};
    }
    if(!('box' in active)) return;
    const box=active.box;
    if(active.kind==='move') return {...box,center:offset(box.center,[dx,dz])};
    if(active.kind==='resize') return resizeFootprint(box,active.corner,cursor);
    if(Math.hypot(cursor[0]-box.center[0],cursor[1]-box.center[1])*scale<4) return box;
    const yaw=box.yaw+angleAt(box.center,cursor)-angleAt(box.center,active.start);
    return {...box,yaw:normalizeYaw(snap ? Math.round(yaw/15)*15 : yaw)};
  }

  function move(event:PointerEvent<SVGSVGElement>) {
    const active=drag.current;
    if(!active) return;
    const point=localPoint(event);
    if(active.kind==='pan') {
      setCenter([active.center[0]-(point[0]-active.pixels[0])/scale,active.center[1]-(point[1]-active.pixels[1])/scale]);
      return;
    }
    const box=shapeAt(active,toWorld(point),event.shiftKey);
    if(box) setDraft({box,id:'id' in active?active.id:undefined});
  }

  function cancel() {drag.current=null;setDraft(null);}

  function finish(event:PointerEvent<SVGSVGElement>) {
    const active=drag.current;
    cancel();
    if(!active || active.kind==='pan') return;
    const cursor=toWorld(localPoint(event));
    if(Math.hypot(cursor[0]-active.start[0],cursor[1]-active.start[1])*scale<3) return;
    const box=shapeAt(active,cursor,event.shiftKey);
    if(!box || box.size.some(side=>side<MIN_SIDE)) return;
    const placed=placeFootprint(box,'type' in active?active.type:type,ground);
    if(!placed) {setMessage('框中心附近没有地面点，请移到有点云的路面。');return;}
    if('id' in active) onEdit(active.id,placed); else onCreate(placed);
  }

  const polygon=(box:Footprint)=>footprintCorners(box).map(p=>toScreen(p).join(',')).join(' ');
  const activeBox=draft?.id ? draft.box : chosen?.roadMarking && footprintOf(chosen.roadMarking);
  const cameraPoint=toScreen(camera.here);
  const drawBox=(id:string, box:Footprint, markingType:RoadMarkingType, selected:boolean)=>{
    const corners=footprintCorners(box).map(toScreen);
    const top=toScreen(offset(box.center,rotate([0,-box.size[1]/2],box.yaw)));
    const handle=toScreen(offset(box.center,rotate([0,-box.size[1]/2-25/scale],box.yaw)));
    return <g key={id} data-road-box={id} className={selected?'road-box selected':'road-box'}>
      <polygon points={polygon(box)} aria-label={MARKING_TYPES[markingType]+' '+id}/>
      {selected && <><line x1={top[0]} y1={top[1]} x2={handle[0]} y2={handle[1]}/>
        <circle cx={handle[0]} cy={handle[1]} r={8} data-drag="rotate" aria-label="旋转手柄"/>
        {corners.map(([x,y],index)=><rect key={index} x={x-4} y={y-4} width={8} height={8} data-drag="resize" data-corner={index} aria-label={`缩放角点 ${index+1}`}/>)}
      </>}
      <text x={corners[0][0]+7} y={corners[0][1]-7}>{MARKING_TYPES[markingType]}</text>
    </g>;
  };

  return <div ref={host} className="road-marking-view" role="region" aria-label="路面标识俯视点云">
    <canvas ref={canvas} width={size[0]} height={size[1]} aria-hidden="true"/>
    <svg className="road-marking-drawing" aria-label="拖动框选路面标识" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onContextMenu={e=>e.preventDefault()}>
      {hasPose && <path className="road-camera" aria-hidden="true" d="M 0 -9 L 6 6 L 0 3 L -6 6 Z" transform={`translate(${cameraPoint.join(' ')}) rotate(${camera.yaw})`}/>}
      {annotations.flatMap(a=>a.visible&&a.roadMarking ? [drawBox(a.id,draft?.id===a.id?draft.box:footprintOf(a.roadMarking),a.roadMarking.type,a.id===selectedId)] : [])}
      {draft && !draft.id && <polygon className="road-box-draft" points={polygon(draft.box)}/>}
    </svg>
    <div className="road-marking-controls">
      <select aria-label={chosen?'修改所选路面标识类型':'新框标识类型'} value={chosen?.roadMarking?.type ?? type} onChange={e=>{
        const value=e.target.value as RoadMarkingType;
        setType(value);
        if(chosen?.roadMarking) onEdit(chosen.id,{...chosen.roadMarking,type:value});
      }}>{Object.entries(MARKING_TYPES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
      {chosen && <button onClick={()=>onSelect(null)}>新建框</button>}
      <button aria-label={hasPose?'定位当前帧前方':'定位点云中心'} title={hasPose?'定位当前帧前方':'定位点云中心'} onClick={reset}><Crosshair size={16}/></button>
      <button aria-label="缩小俯视图" onClick={()=>setScale(v=>clamp(v/1.3,3,180))}><Minus size={15}/></button>
      <button aria-label="放大俯视图" onClick={()=>setScale(v=>clamp(v*1.3,3,180))}><Plus size={15}/></button>
      <button aria-label="撤销路面框编辑" disabled={!canUndo} onClick={undo}><Undo2 size={16}/></button>
      <button aria-label="重做路面框编辑" disabled={!canRedo} onClick={redo}><Redo2 size={16}/></button>
    </div>
    <div className="road-marking-meta"><span>{intensity?'强度俯视':'地面俯视'} · 右键拖动平移</span>
      {activeBox && <span><RotateCw size={13}/>{activeBox.size[0].toFixed(2)} × {activeBox.size[1].toFixed(2)} m · {activeBox.yaw.toFixed(1)}°</span>}
      {!activeBox && <span className="road-scale" style={{width:scale*(scale<8?10:scale<30?5:1)}}>{scale<8?10:scale<30?5:1} m</span>}
    </div>
    {message && <div className="road-marking-message" role="status">{message}</div>}
  </div>;
}
