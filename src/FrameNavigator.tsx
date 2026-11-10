import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import type { Annotation, PanoramaFrame } from './types';

interface Props {
  frames:PanoramaFrame[];index:number;onFrame:(index:number)=>void;
  linked:boolean;hasPose:boolean;onLinked:()=>void;
  selected:Annotation|null;pending:boolean;working?:boolean;onLocate:()=>void;onReview:()=>void;
}

export default function FrameNavigator(p:Props) {
  const count=p.selected?.observations?.length??0,bodyCount=p.selected?.observations?.filter(o=>o.extent==='object').length??0;
  const coverage=count?bodyCount===count?' · 完整物体轮廓':bodyCount===0?' · 单面轮廓':` · 完整轮廓 ${bodyCount}/${count} 帧（需统一）`:'';
  return <div className="annotation-frame-bar">
    <div><button aria-label="上一帧" disabled={p.index===0} onClick={()=>p.onFrame(p.index-1)}><ChevronLeft size={16}/></button><select aria-label="当前全景帧" value={p.index} onChange={e=>p.onFrame(Number(e.target.value))}>{p.frames.map((frame,i)=><option key={frame.id} value={i}>{i+1} / {p.frames.length} · {frame.name}</option>)}</select><button aria-label="下一帧" disabled={p.index===p.frames.length-1} onClick={()=>p.onFrame(p.index+1)}><ChevronRight size={16}/></button></div>
    <span>{p.pending?'正在绘制当前帧轮廓 · 完成后再切帧':p.selected?.observations?.length ? `当前对象 · ${p.selected.observations.length} 帧观测${coverage}`:'在相邻全景中框定同一对象，可进行多帧定位'}{p.selected?.triangulation?.method==='silhouette'&&` · ${p.selected.triangulation.supportPointCount?.toLocaleString()} 支持点 · ${p.selected.triangulation.extent==='object'?`体积候选 D≈${p.selected.pointCloud?.size[2].toFixed(2)??'—'} m`:'表面候选，未恢复完整厚度'}`}{p.selected?.triangulation&&` · ${p.selected.triangulation.stale?'配准已变，请重新定位':p.selected.triangulation.reviewed?'已核验':p.selected.triangulation.extent==='object'?'待核验（含厚度）':'待核验'}`}</span>
    <button disabled={p.pending||p.working||(p.selected?.observations?.length??0)<2} onClick={p.onLocate}>{p.working?'正在定位…':'多帧定位'}</button>{p.selected?.triangulation&&<button disabled={p.pending||p.working||p.selected.triangulation.stale} onClick={p.onReview}>确认 3D 结果</button>}
    <button aria-pressed={p.linked} disabled={!p.hasPose} onClick={p.onLinked}><Link2 size={14}/>{!p.hasPose?'缺少位姿':p.linked?'视角同步':'自由观察'}</button>
  </div>;
}
