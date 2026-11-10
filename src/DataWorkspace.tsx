import { useState } from 'react';
import { ArrowRight, Box, Database, FileJson, FileUp, Image, Plus } from 'lucide-react';
import type { PairTask } from './types';

interface Props {
  tasks:PairTask[];activeId:string;scenes:Array<{key:string;name:string}>;sceneKey:string;
  onTask:(task:PairTask)=>void;onScene:(key:string)=>void;loading:boolean;
  kind:'paired'|'image';onKind:(kind:'paired'|'image')=>void;
  cloud:File|null;images:File[];calibration:File|null;name:string;
  onCloud:(file:File|null)=>void;onImages:(files:File[])=>void;onCalibration:(file:File|null)=>void;onName:(name:string)=>void;onImport:()=>void;
  importOpen:boolean;onImportOpen:(open:boolean)=>void;
}

export default function DataWorkspace(p:Props) {
  const {importOpen,onImportOpen:setImportOpen}=p;
  const [route,setRoute]=useState<'browser'|'native'>('browser');
  const tooLarge=Boolean(p.cloud&&p.cloud.size>150*1024*1024);
  return <>
    <div className="workflow-page-heading"><div><span>01 / DATA</span><h1>数据管理</h1><p>在这里导入和选择数据，再进入配准与标注。</p></div><button className="button button-primary" onClick={()=>setImportOpen(!importOpen)}><Plus size={16}/>{importOpen?'收起导入':'导入数据'}</button></div>
    <div className="data-kind-tabs" role="group" aria-label="数据类型"><button className={p.kind==='paired'?'active':''} onClick={()=>p.onKind('paired')}><Box size={16}/>点云 + 全景</button><button className={p.kind==='image'?'active':''} onClick={()=>p.onKind('image')}><Image size={16}/>普通图片 + YOLO</button></div>
    {p.kind==='paired'&&<>
      {importOpen&&<section className="import-panel" aria-label="双源数据导入"><div className="import-route" role="group" aria-label="导入方式"><button className={route==='browser'?'active':''} onClick={()=>setRoute('browser')}>浏览器导入</button><button className={route==='native'?'active':''} onClick={()=>setRoute('native')}>本机大点云导入</button></div>
        {route==='browser'?<><p className="import-description">选择一份点云、连续全景和可选位姿。点云直读上限为 150 MiB；大文件请使用本机导入。</p><label className="field-label">数据名称<input value={p.name} onChange={e=>p.onName(e.target.value)} placeholder="例如：校园 · 东门采集序列"/></label>
          <div className="data-upload-grid"><label className="data-upload"><Box size={24}/><strong>{p.cloud?.name??'选择点云'}</strong><small>PCD / PLY · ≤150 MiB</small><input aria-label="点云文件" type="file" accept=".pcd,.ply" onChange={e=>p.onCloud(e.target.files?.[0]??null)}/></label><label className="data-upload"><Image size={24}/><strong>{p.images.length?`${p.images.length} 张全景`:'选择连续全景'}</strong><small>JPG / PNG · 2:1 · 可多选</small><input aria-label="全景影像" type="file" multiple accept=".jpg,.jpeg,.png" onChange={e=>p.onImages(Array.from(e.target.files??[]))}/></label></div>
          <label className="data-pose-upload"><FileJson size={18}/><span>{p.calibration?.name??'可选：逐帧位姿 / 硬件外参 JSON'}</span><input aria-label="配准位姿 JSON" type="file" accept=".json" onChange={e=>p.onCalibration(e.target.files?.[0]??null)}/></label>
          {tooLarge&&<p className="inline-notice" role="alert">所选点云超过浏览器直读上限。<button onClick={()=>setRoute('native')}>查看本机大点云导入</button></p>}
          <div className="import-panel-foot"><small>原始文件保持只读。缺少位姿时，可在下一步导入或手动配准。</small><button className="button button-primary" disabled={!p.cloud||!p.images.length||tooLarge} onClick={p.onImport}><FileUp size={16}/>导入并配准</button></div>
        </>:<div className="native-import"><h3>GB 级源点云，先在本机处理</h3><p>运行交付目录里的导入启动器，读取原始点云与位姿，保留全图范围并生成浏览器可用的显示点云。原始文件不会被缩小或覆盖。</p><div className="native-platforms"><section><strong>Windows</strong><code>Import-Scene-Windows.bat "数据文件夹"</code></section><section><strong>macOS</strong><code>sh ./Import-Scene-macOS.command "数据文件夹"</code></section></div><p>当前自动导入支持 DenseMap.pcd、CameraPoseInSlam.csv 和同目录全景。需要 Python 3.10+、Node.js 20+。</p><details><summary>显示精度与支持范围</summary><p>默认约 180 万显示点，可通过 --point-budget 4500000 或 8000000 提高细节。空间采样保持地图范围；原始点索引与显示点索引不等同。当前尚未实现海量原始点的按需分块流式加载。</p></details></div>}
      </section>}
      <section className="dataset-section"><div className="dataset-section-head"><h2>{p.scenes.length?'本机场景':'已导入数据'}</h2><span>{p.scenes.length||p.tasks.length} 组双源数据</span></div>
        <div className="dataset-grid">{p.scenes.length?p.scenes.map(scene=><button key={scene.key} className={'dataset-card '+(scene.key===p.sceneKey?'selected':'')} disabled={p.loading} onClick={()=>p.onScene(scene.key)}><span className="dataset-icon"><Database size={20}/></span><strong>{scene.name}</strong><small>点云 + 连续全景 · 自带逐帧位姿</small><span className="dataset-open">{scene.key===p.sceneKey?'当前数据':'打开并配准'}<ArrowRight size={15}/></span></button>):p.tasks.map(task=><button key={task.id} className={'dataset-card '+(task.id===p.activeId?'selected':'')} onClick={()=>p.onTask(task)}><span className="dataset-icon"><Box size={20}/></span><strong>{task.name}</strong><small>{task.frames?.length??1} 张全景 · {task.pointCloudName}</small><span className="dataset-open">打开并配准<ArrowRight size={15}/></span></button>)}</div>
        {p.scenes.length>0&&p.tasks.filter(t=>!t.id.startsWith('local-scene-')&&!t.isDemo).map(task=><button key={task.id} className="extra-dataset" onClick={()=>p.onTask(task)}>{task.name}<ArrowRight size={15}/></button>)}
      </section>
    </>}
  </>;
}
