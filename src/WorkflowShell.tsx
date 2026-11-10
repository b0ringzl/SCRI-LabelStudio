import { Box, Crosshair, Database, GraduationCap, Layers3, Settings2 } from 'lucide-react';
import type { Page } from './types';
import { version } from '../package.json';

export const WORKFLOW = [
  {page:'sources',label:'数据',description:'导入与管理',icon:Database},
  {page:'registration',label:'配准',description:'对齐点云与全景',icon:Crosshair},
  {page:'workspace',label:'标注',description:'人工标注与 AI 辅助',icon:Box},
  {page:'training',label:'训练',description:'核验成果与蒸馏',icon:GraduationCap},
] as const;

export function workflowPage(page: Page) {
  if(page==='tasks')return 'sources';
  if(page==='review')return 'workspace';
  if(page==='models'||page==='ontology')return 'settings';
  return page;
}

export function WorkflowSidebar({page,onNavigate}:{page:Page;onNavigate:(page:Page)=>void}) {
  const active=workflowPage(page);
  return <aside className="workflow-sidebar">
    <div className="workflow-brand"><span><Layers3 size={22}/></span><div><strong>SCRI Labeling</strong><small>多源空间数据标注</small></div></div>
    <div className="workflow-project"><small>当前项目</small><strong>城市空间要素标注</strong></div>
    <nav aria-label="主要流程">{WORKFLOW.map(({page:target,label,description,icon:Icon},i)=><button key={target} className={active===target?'active':''} aria-current={active===target?'page':undefined} onClick={()=>onNavigate(target)}><Icon size={19}/><span><strong>{label}</strong><small>{description}</small></span><b>0{i+1}</b></button>)}</nav>
    <div className="workflow-sidebar-foot"><button className={active==='settings'?'active':''} onClick={()=>onNavigate('models')}><Settings2 size={18}/><span>项目设置</span></button><small>本地工作区 · v{version}</small></div>
  </aside>;
}

export function AnnotationTabs({page,onNavigate}:{page:Page;onNavigate:(page:Page)=>void}) {
  return <div className="annotation-tabs" role="group" aria-label="标注数据类型"><button className={page==='workspace'?'active':''} onClick={()=>onNavigate('workspace')}>点云 + 全景</button><button className={page==='review'?'active':''} onClick={()=>onNavigate('review')}>普通图片</button></div>;
}
