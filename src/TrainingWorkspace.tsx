import { ArrowDownToLine, ArrowRight, CheckCircle2, GraduationCap } from 'lucide-react';
import type { ReviewSession } from './ImageReview';
import type { ModelProfile } from './modelRegistry';
import { buildDistillationManifest } from './distillation';

interface Props {session:ReviewSession|null;models:ModelProfile[];onAnnotate:()=>void;onExportPair:()=>void;onMessage:(message:string)=>void}

export default function TrainingWorkspace(p:Props) {
  const reviewed=p.session?.items.filter(item=>item.reviewed)??[];
  const labels=reviewed.reduce((n,item)=>n+item.boxes.length,0);
  function exportManifest() {
    try {
      const manifest=buildDistillationManifest(p.session?.datasetId??'',p.session?.items??[],p.models);
      const url=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=manifest.datasetId+'-distillation-v1.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      p.onMessage(`已导出 ${manifest.samples.length} 张已确认图片的训练清单`);
    }catch(error){p.onMessage(error instanceof Error?error.message:'导出失败');}
  }
  return <><div className="workflow-page-heading"><div><span>04 / TRAINING</span><h1>训练与导出</h1><p>把经过人工核验的成果整理为训练数据，保留教师模型来源。</p></div><span className="service-state">训练服务未连接</span></div>
    <div className="training-stats"><div><small>已核验图片</small><strong>{reviewed.length}</strong></div><div><small>确认标签</small><strong>{labels}</strong></div><div><small>教师模型</small><strong>千问 / DeepSeek / HTTP</strong></div></div>
    <div className="training-flow"><span><CheckCircle2 size={18}/>人工核验</span><ArrowRight size={17}/><span><ArrowDownToLine size={18}/>生成训练清单</span><ArrowRight size={17}/><span><GraduationCap size={18}/>外部训练与评估</span></div>
    <div className="training-grid"><section className="workflow-card"><span className="workflow-card-kicker">2D 检测</span><h2>生成蒸馏训练清单</h2><p>仅包含已确认图片、标签和教师来源，也保留确认后的空图。原始影像需另行提供给训练服务。</p><button className="button button-primary" disabled={!reviewed.length} onClick={exportManifest}><ArrowDownToLine size={16}/>导出训练清单</button>{!reviewed.length&&<button className="text-action" onClick={p.onAnnotate}>先去核验图片<ArrowRight size={14}/></button>}</section><section className="workflow-card"><span className="workflow-card-kicker">点云 + 全景</span><h2>导出联合标注成果</h2><p>导出当前数据的对象框、逐点类别、逐帧位姿及多视角观测，供后续训练适配与复核。</p><button className="button button-light" onClick={p.onExportPair}><ArrowDownToLine size={16}/>导出联合标注</button></section></div>
    <p className="training-boundary">当前提供训练数据准备与服务接口，尚未执行模型训练。全景 2D 候选不能直接当作点云 3D 真值。</p>
  </>;
}
