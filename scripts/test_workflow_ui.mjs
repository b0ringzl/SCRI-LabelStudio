import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory=await mkdtemp(join(tmpdir(),'scri-workflow-'));
try {
  const out=join(directory,'ui.cjs');
  await build({stdin:{contents:`
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {WorkflowSidebar,workflowPage} from './src/WorkflowShell';
    import FrameNavigator from './src/FrameNavigator';
    import TrainingWorkspace from './src/TrainingWorkspace';
    import PanoramaView from './src/PanoramaView';
    import {ViewSync} from './src/viewSync';
    export {workflowPage};
    export const sidebar = (page)=>renderToStaticMarkup(<WorkflowSidebar page={page} onNavigate={()=>{}}/>);
    export const frameBar = ()=>renderToStaticMarkup(<FrameNavigator frames={[{id:'f',name:'one.jpg',url:'local'}]} index={0} onFrame={()=>{}} linked={false} hasPose={false} onLinked={()=>{}} selected={null} pending={false} onLocate={()=>{}} onReview={()=>{}}/>);
    export const training = ()=>renderToStaticMarkup(<TrainingWorkspace session={null} models={[]} onAnnotate={()=>{}} onExportPair={()=>{}} onMessage={()=>{}}/>);
    export const panorama = (canEdit)=>renderToStaticMarkup(<PanoramaView imageUrl="fixture.png" cloudGeometry={null}
      annotations={[]} classes={[]} selectedId={null} registration={{position:[0,0,0],rotation:[0,0,0]}}
      tool="navigate" canEdit={canEdit} draftVertices={[]} selectedVertex={null} showProjection={false}
      viewSync={new ViewSync()} linked={false} tiePoints={[]} onImageReady={()=>{}} onPick={()=>{}}
      onFinishPolygon={()=>{}} onVertexSelect={()=>{}} onVerticesChange={()=>{}} onSelect={()=>{}}/>);
  `,resolveDir:resolve('.'),loader:'tsx'},jsx:'automatic',bundle:true,platform:'node',format:'cjs',outfile:out,logLevel:'silent'});
  const {default:ui}=await import(pathToFileURL(out));
  const sidebar=ui.sidebar('registration');
  const nav=sidebar.slice(sidebar.indexOf('<nav'),sidebar.indexOf('</nav>'));
  assert.equal((nav.match(/<button/g)??[]).length,4,'only four primary workflow destinations');
  for(const duplicate of ['道路设施复核','任务列表','数据源','预标注接口'])assert(!nav.includes(duplicate));
  assert.equal(ui.workflowPage('review'),'workspace','image review must belong to Annotation');
  assert.equal(ui.workflowPage('ontology'),'settings');assert.equal(ui.workflowPage('models'),'settings');
  const frameBar=ui.frameBar();
  for(const operation of ['配准步骤','同名点','导入位姿','求解精配准'])assert(!frameBar.includes(operation),'annotation frame bar must not duplicate calibration');
  assert.match(frameBar,/缺少位姿/);assert.match(frameBar,/disabled/);
  assert.match(ui.panorama(true),/全景轮廓顶点编辑/,'annotation view exposes the editor');
  assert(!ui.panorama(false).includes('全景轮廓顶点编辑'),'registration view must not expose annotation handles');
  const training=ui.training();assert.match(training,/训练服务未连接/);
  assert.match(training,/disabled=""[^>]*>.*?导出训练清单/s,'unreviewed samples must not enable training-data export');
  console.log('Four-stage navigation, settings grouping, annotation/calibration separation and training gates passed');
}finally{
  const target=resolve(directory);assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target,{recursive:true,force:true});
}
