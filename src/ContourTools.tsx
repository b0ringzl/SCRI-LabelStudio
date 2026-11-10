interface Props {extent:'surface'|'object';onExtent:(value:'surface'|'object')=>void;target:boolean;rectangle:boolean;onRectangle:(value:boolean)=>void;draft:number;vertices:number;selectedVertex:number|null;canUndo:boolean;canRedo:boolean;onUndo:()=>void;onRedo:()=>void;onFinish:()=>void;onCancel:()=>void;onDeleteVertex:()=>void;onInsert:()=>void;onRedraw:()=>void;onDeleteContour:()=>void}
export default function ContourTools(p:Props){return <div className="contour-tools" role="group" aria-label="轮廓编辑">
  {p.target&&<select aria-label="目标轮廓方式" value={p.rectangle?'rectangle':'polygon'} onChange={e=>p.onRectangle(e.target.value==='rectangle')}><option value="polygon">多边形轮廓</option><option value="rectangle">两点矩形</option></select>}
  {p.target&&<select aria-label="圈选范围" value={p.extent} onChange={e=>p.onExtent(e.target.value as 'surface'|'object')}><option value="object">完整物体（含侧面）</option><option value="surface">单个表面（不恢复厚度）</option></select>}
  <span>{p.draft?`绘制中 · ${p.draft} 点`:`当前轮廓 · ${p.vertices} 点`}{p.selectedVertex!==null?` · 顶点 ${p.selectedVertex+1}`:''}</span>
  <button disabled={!p.canUndo} onClick={p.onUndo} title="Ctrl/Cmd+Z">撤销</button><button disabled={!p.canRedo} onClick={p.onRedo} title="Ctrl/Cmd+Shift+Z">重做</button>
  {p.draft>0&&<><button disabled={p.draft<3} onClick={p.onFinish}>完成轮廓</button><button onClick={p.onCancel}>取消绘制</button></>}
  <button disabled={p.selectedVertex===null} onClick={p.onDeleteVertex}>删除顶点</button><button disabled={p.selectedVertex===null||p.draft>0||p.vertices<3} onClick={p.onInsert}>在其后加点</button>
  {!p.draft&&p.vertices>0&&<><button onClick={p.onRedraw}>重绘当前轮廓</button><button onClick={p.onDeleteContour}>删除当前轮廓</button></>}
  <small>拖动顶点修正 · Enter 完成 · Backspace 删除顶点</small>
</div>;}
