import { Sparkles } from 'lucide-react';
import type { Annotation, ClassDefinition } from './types';
import type { ModelProfile } from './modelRegistry';
import './pairModel.css';

interface Props {
  models: ModelProfile[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
  ready: boolean;
  candidates: Annotation[];
  pointCandidateCount: number;
  modelVersion: string;
  classes: ClassDefinition[];
  onFocus: (candidate: Annotation) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptPoints: () => void;
  onRejectPoints: () => void;
}

export default function PairModelBar(props: Props) {
  const pairedModels = props.models.filter((model) => model.modality === 'paired3d');
  return <div className="pair-model-panel"><div className="pair-model-toolbar"><Sparkles size={16} /><strong>联合预标注</strong>
    <select aria-label="点云全景辅助模型" value={props.selectedModelId} onChange={(event) => props.onSelectModel(event.target.value)}>
      <option value="">选择点云／全景模型</option>{pairedModels.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
    </select><button onClick={props.onRun} disabled={!props.selectedModelId || !props.ready || props.running || props.candidates.length > 0 || props.pointCandidateCount > 0}>{props.running ? '运行中…' : '运行当前配对任务'}</button>
    {props.running && <button onClick={props.onCancel}>取消</button>}
    <button className="pair-model-settings" onClick={props.onOpenSettings}>管理模型</button><small>点击运行后才上传当前配对文件；切换任务或模型会丢弃候选</small>
  </div>{(props.candidates.length > 0 || props.pointCandidateCount > 0) && <div className="pair-model-candidates"><div className="pair-model-candidate-head"><strong>待审核候选 · {props.modelVersion}</strong><span>紫色虚线为 3D 框；紫色标记为全景和逐点候选</span></div>
    <div className="pair-model-list">{props.candidates.map((item) => <div className="pair-model-candidate" key={item.id}><span>{props.classes.find((entry) => entry.id === item.classId)?.name ?? item.classId} · {item.name}{item.confidence === undefined ? '' : ` · ${Math.round(item.confidence * 100)}%`}</span><button onClick={() => props.onFocus(item)}>定位</button><button onClick={() => props.onAccept(item.id)}>接受</button><button onClick={() => props.onReject(item.id)}>忽略</button></div>)}</div>
    {props.candidates.length > 0 && <div className="pair-model-batch"><button onClick={props.onAcceptAll}>接受全部对象</button><button onClick={props.onRejectAll}>忽略全部对象</button></div>}
    {props.pointCandidateCount > 0 && <div className="pair-model-points"><span>{props.pointCandidateCount.toLocaleString()} 个逐点类别候选</span><button onClick={props.onAcceptPoints}>只填充未标注点</button><button onClick={props.onRejectPoints}>忽略</button></div>}
  </div>}</div>;
}
