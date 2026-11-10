import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, FileJson, Link2, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Annotation, PanoramaFrame, RegistrationEvidence, TiePoint, UV, Vec3 } from './types';
import type { AutoRegistrationCandidate } from './automaticRegistration';
import { candidateSummary } from './automaticRegistration';
import type { DepthRegistrationResult } from './depthRegistration';
import './registrationWorkflow.css';

interface Props {
  frames: PanoramaFrame[]; frameIndex: number; tiePoints: TiePoint[];
  pendingTiePoint: Vec3 | null; pendingBoxCorner: UV | null; selected: Annotation | null;
  quality: string; evidence?: RegistrationEvidence; hasPose: boolean;
  sceneOptions?: Array<{key:string;name:string}>; sceneKey?: string; sceneLoading?: boolean; coverageLabel?: string;
  onSceneChange: (key: string) => void;
  step: number; onStep: (step: number) => void; layout: 'split' | 'overlay'; onLayout: (value: 'split' | 'overlay') => void;
  linked: boolean; onLinked: () => void; onLabel: () => void; labeling: boolean; parameters: ReactNode;
  onFrameChange: (index: number) => void; onSolve: () => void; onAutoYaw: () => void;
  autoYawReady: boolean; autoYawRunning: boolean;
  automaticStatus: { configured: boolean; reason?: string; label?: string } | null;
  automaticMethod:'nid'|'da2';onAutomaticMethod:(method:'nid'|'da2')=>void;
  depthResult?:DepthRegistrationResult;
  automaticRunning: boolean; automaticProgress: string; automaticCandidate?: AutoRegistrationCandidate;
  automaticCandidateCount: number; automaticPreview: boolean;
  onAutomaticRun: (all: boolean) => void; onAutomaticCancel: () => void; onAutomaticAccept: (all: boolean) => void;
  onAutomaticReject: () => void; onAutomaticPreview: () => void;
  onLocate: () => void; onImportPose: (file: File) => void; onRemoveTie: (id: string) => void;
  onClearTies: () => void; onReview: () => void;
}

export default function RegistrationWorkflow(p: Props) {
  const current = p.frames[p.frameIndex];
  const pairs = p.tiePoints.filter((pair) => pair.frameId === current.id);
  const source = p.evidence ? { 'ins-approximate': 'INS 粗位姿', imported: '已导入初值', manual: '人工调整', 'tie-points': '同名点已求解', 'color-yaw': '颜色朝向候选', 'auto-nid': 'NID 候选已应用', 'auto-depth':'DA² 候选已应用' }[p.evidence.source] ?? '历史位姿（待核验）' : p.hasPose ? '已载入初值' : '需要初始位姿';
  const importPose = <label className="compact-import"><FileJson size={14} />导入位姿<input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) p.onImportPose(file); event.target.value = ''; }} /></label>;
  return <div className="registration-workflow compact-registration">
    <div className="registration-toolbar">
      <div className="registration-steps" role="group" aria-label="配准步骤">{['粗配准', '同名点精调', '投影核验'].map((name, i) => <button key={name} className={!p.labeling && p.step === i ? 'active' : ''} onClick={() => p.onStep(i)}><b>{i+1}</b>{name}</button>)}</div>
      <div className="registration-view-switch" role="group" aria-label="视图布局"><button className={p.layout === 'split' ? 'active' : ''} onClick={() => p.onLayout('split')}>点云 / 全景分屏</button><button className={p.layout === 'overlay' ? 'active' : ''} onClick={() => p.onLayout('overlay')}>投影叠加</button></div>
      <button className={'observation-link '+(p.linked ? 'active' : '')} aria-pressed={p.linked} disabled={!p.hasPose} onClick={p.onLinked}><Link2 size={14} />{!p.hasPose ? '缺少位姿' : p.linked ? '视角同步' : '自由观察'}</button>
      <details className="registration-more"><summary><SlidersHorizontal size={14} />更多设置</summary><div className="registration-more-panel">
        <h3>配准与显示设置</h3><p>观察视角独立于标定位姿；拖动视图不会修改外参。</p>
        {importPose}{p.parameters}
        <h4>自动精配准</h4><p>{p.automaticStatus?.configured ? p.automaticStatus.label : p.automaticStatus?.reason ?? '正在检查独立 Python 环境'}</p>
        <div className="registration-flow-actions"><button disabled={!p.hasPose || !p.automaticStatus?.configured || p.automaticRunning} onClick={() => p.onAutomaticRun(false)}>自动配准当前帧</button><button disabled={!p.hasPose || !p.automaticStatus?.configured || p.automaticRunning} onClick={() => p.onAutomaticRun(true)}>批量配准全部帧</button><button disabled={!p.autoYawReady || p.autoYawRunning} onClick={p.onAutoYaw}>{p.autoYawRunning ? '估计中…' : '彩色 yaw 候选'}</button></div>
        {p.automaticRunning && <p>{p.automaticProgress}<button onClick={p.onAutomaticCancel}>取消</button></p>}
        {p.automaticCandidate && <p>{candidateSummary(p.automaticCandidate)} · 待独立核验</p>}{p.automaticCandidate && <div className="registration-flow-actions"><button onClick={p.onAutomaticPreview}>{p.automaticPreview ? '查看原位姿' : '预览候选'}</button><button onClick={() => p.onAutomaticAccept(false)}>应用当前候选</button><button onClick={p.onAutomaticReject}>舍弃候选</button></div>}
        {p.automaticCandidateCount > 1 && <button onClick={() => p.onAutomaticAccept(true)}>应用全部 {p.automaticCandidateCount} 帧候选</button>}
        <h4>当前帧同名点 · {pairs.length} 对</h4><div className="registration-tie-list">{pairs.map((pair, i) => <span key={pair.id}>#{i+1}<button aria-label={'删除第 '+(i+1)+' 对同名点'} onClick={() => p.onRemoveTie(pair.id)}><Trash2 size={13} /></button></span>)}</div><button disabled={!pairs.length} onClick={p.onClearTies}>清空当前帧同名点</button>
        {p.quality && <p role="status">{p.quality}</p>}
      </div></details>
    </div>
    <div className="registration-action-row">
      <span className={'pose-state '+(p.hasPose ? '' : 'needs-pose')}>{source}</span>
      {!p.labeling && p.step===0 && <select aria-label="自动配准方法" value={p.automaticMethod} disabled={p.automaticRunning} onChange={e=>p.onAutomaticMethod(e.target.value as 'nid'|'da2')}><option value="da2">DA² · 全景深度辅助</option><option value="nid">NID · 无需模型权重</option></select>}
      {!p.labeling && p.step === 0 && <><span className="step-instruction">{p.hasPose ? '已应用随数据导入的初始位姿，先检查方向，再选同名点。' : '导入 INS / 外参初值后，再开始同名点精调。'}</span>{importPose}<button disabled={!p.hasPose || !p.automaticStatus?.configured || p.automaticRunning} className="reg-primary" onClick={() => p.onAutomaticRun(false)}>{p.automaticRunning ? "正在配准…" : "自动精配准"}</button><button onClick={() => p.onStep(1)}>下一步：同名点</button></>}
      {!p.labeling && p.step === 1 && <><span className="step-instruction">{p.pendingTiePoint ? '左侧已选点 → 在右侧点击同一地物' : '点击左侧角点，再点右侧对应位置；建议 6–10 对，分散选取'}</span><strong className="pair-count">{pairs.length} 对</strong>{pairs.length > 0 && <button onClick={() => p.onRemoveTie(pairs[pairs.length-1].id)}>撤销上一对</button>}<button disabled={pairs.length < 4} className="reg-primary" onClick={p.onSolve}><Crosshair size={14} />求解精配准</button></>}
      {!p.labeling && p.step === 2 && <><span className="step-instruction">检查静态建筑边缘；{p.evidence?.medianErrorDeg !== undefined ? '同名点角残差中位 '+p.evidence.medianErrorDeg.toFixed(2)+'°' : '配准效果待核验'}。</span><button className="reg-primary" onClick={p.onLabel}>进入标注</button></>}
      {p.labeling && <><span className="step-instruction">{p.pendingBoxCorner ? '请点击目标框的第二个对角' : '当前对象已框定 '+(p.selected?.observations?.length ?? 0)+' 帧'}</span><button disabled={(p.selected?.observations?.length ?? 0) < 2} onClick={p.onLocate}>多帧定位</button>{p.selected?.triangulation && <button onClick={p.onReview}>确认 3D 结果</button>}</>}
    </div>
    {p.automaticRunning && <div className="registration-action-row" role="status"><span>正在优化 {p.automaticProgress}</span><button onClick={p.onAutomaticCancel}>取消配准</button></div>}
    {p.automaticCandidate && <div className="registration-action-row"><span>候选 · {candidateSummary(p.automaticCandidate)} · 待独立投影核验</span><button onClick={p.onAutomaticPreview}>{p.automaticPreview ? '查看原位姿' : '预览候选'}</button><button className="reg-primary" onClick={() => p.onAutomaticAccept(false)}>应用当前候选</button><button onClick={p.onAutomaticReject}>舍弃候选</button></div>}
    {!p.automaticStatus?.configured && !p.automaticRunning && <p className="depth-status">{p.automaticStatus?.reason??'正在检查所选配准环境…'}</p>}
    {p.depthResult && <details className="depth-result" key={p.depthResult.frameId}><summary>查看 DA² 深度 · {p.depthResult.status==='candidate'?'已生成位姿候选':'位姿未采用'} · {p.depthResult.inference.device.toUpperCase()} · 推理 {p.depthResult.inference.inferenceSeconds.toFixed(2)} s</summary><div className="depth-result-body"><img src={p.depthResult.depthPreviewDataUrl} alt="DA2 预测的全景相对深度，蓝色近、红色远；不是米制测量"/><div><strong>AI 预测的相对深度</strong><p>蓝色近、红色远。{p.depthResult.depthWidth} × {p.depthResult.depthHeight}；深度尺度需结合点云估计。</p><p>{p.depthResult.reason}</p>{p.depthResult.metrics.scaleAfter>0 && <p>拟合比例 {p.depthResult.metrics.scaleBefore.toFixed(2)} → {p.depthResult.metrics.scaleAfter.toFixed(2)}；修正 {p.depthResult.metrics.rotationChangeDeg.toFixed(2)}° / {p.depthResult.metrics.positionChangeM.toFixed(2)} m。修正量不是误差。</p>}<p>展开“投影叠加”，切换原位姿与候选检查建筑边缘；模型深度和内部残差均不代表独立标定真值。</p></div></div></details>}
    <div className="registration-frame-nav">{(p.sceneOptions?.length ?? 0) > 1 && <select aria-label="验证场景" value={p.sceneKey} disabled={p.sceneLoading} onChange={(event) => p.onSceneChange(event.target.value)}>{p.sceneOptions!.map((scene) => <option key={scene.key} value={scene.key}>{scene.name}</option>)}</select>}<button aria-label="上一帧" disabled={p.frameIndex === 0} onClick={() => p.onFrameChange(p.frameIndex-1)}><ChevronLeft size={16} /></button><select aria-label="当前全景帧" value={p.frameIndex} onChange={(event) => p.onFrameChange(Number(event.target.value))}>{p.frames.map((frame, i) => <option key={frame.id} value={i}>{i+1} / {p.frames.length} · {frame.name}</option>)}</select><button aria-label="下一帧" disabled={p.frameIndex === p.frames.length-1} onClick={() => p.onFrameChange(p.frameIndex+1)}><ChevronRight size={16} /></button><span>{current.utcSeconds?.toFixed(3)}{current.utcSeconds !== undefined ? ' s · ' : ''}{p.linked ? '相机位置与朝向随帧同步' : '自由观察'}{p.coverageLabel ? ' · '+p.coverageLabel : ''}</span></div>
  </div>;
}
