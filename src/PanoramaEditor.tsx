import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { directionToPanorama, panoramaToDirection } from './geometry';
import type { UV } from './types';

interface Props {
  camera: () => THREE.PerspectiveCamera | undefined;
  vertices: UV[];
  draft: boolean;
  selected: number | null;
  onSelect: (index: number) => void;
  onCommit: (vertices: UV[], draft: boolean) => void;
}

/** Screen handles follow the same camera as the sphere; dragging never rotates it. */
export default function PanoramaEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props); live.current = props;
  const drag = useRef<{ index: number; vertices: UV[]; moved: boolean } | null>(null);
  const [points, setPoints] = useState<Array<{x:number;y:number;front:boolean;visible:boolean}>>([]);
  useEffect(() => {
    let frame = 0, signature = '';
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const camera = live.current.camera(), element = host.current;
      if (!camera || !element) return;
      camera.updateMatrixWorld();
      const vertices = drag.current?.vertices ?? live.current.vertices;
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const next = vertices.map(uv => {
        const direction = panoramaToDirection(uv), p = direction.clone().multiplyScalar(19).project(camera);
        return {x:(p.x+1)*element.clientWidth/2,y:(1-p.y)*element.clientHeight/2,front:direction.dot(forward)>0,
          visible:direction.dot(forward)>0 && Math.abs(p.x)<1.04 && Math.abs(p.y)<1.04};
      });
      const key = JSON.stringify(next);
      if (signature !== key) { signature = key; setPoints(next); }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { drag.current = null; }, [props.vertices]);

  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const active = drag.current, camera = props.camera(), element = host.current;
    if (!active || !camera || !element) return;
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const direction = new THREE.Vector3((event.clientX-rect.left)/rect.width*2-1,
      1-(event.clientY-rect.top)/rect.height*2,.5).unproject(camera).sub(camera.position).normalize();
    active.vertices[active.index] = directionToPanorama(direction); active.moved = true;
  }
  return <div ref={host} className="panorama-editor" aria-label="全景轮廓顶点编辑">
    {points.length>1 && <svg aria-hidden="true">
      {!props.draft && points.every(p=>p.front) && <polygon points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="rgba(255,211,125,.08)"/>}
      {points.map((p,i)=>{const next=points[(i+1)%points.length];return p.front && next.front && (!props.draft || i<points.length-1)
        ? <line key={i} x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="#ffd37d" strokeWidth="2"/>:null;})}
    </svg>}
    {points.map((point,index)=>point.visible && <button key={index} className={`contour-handle ${props.selected===index?'selected':''}`}
      aria-label={`轮廓顶点 ${index+1}`} aria-pressed={props.selected===index}
      data-u={(drag.current?.vertices ?? props.vertices)[index]?.[0]} data-v={(drag.current?.vertices ?? props.vertices)[index]?.[1]}
      title={`顶点 ${index+1}：拖动调整，Backspace 删除`} style={{left:point.x,top:point.y}}
      onPointerDown={event=>{event.preventDefault();event.stopPropagation();props.onSelect(index);
        drag.current={index,vertices:props.vertices.map(p=>[...p]),moved:false};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={move}
      onPointerUp={event=>{event.stopPropagation();const active=drag.current;drag.current=null;
        if(active?.moved)props.onCommit(active.vertices,props.draft);}}
      onPointerCancel={()=>{drag.current=null;}}
      onDoubleClick={event=>event.stopPropagation()}>{index+1}</button>)}
  </div>;
}
