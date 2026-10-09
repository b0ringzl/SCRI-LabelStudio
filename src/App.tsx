import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import {
  Activity, AlignHorizontalJustifyCenter, ArrowDownToLine, ArrowLeft, ArrowRight,
  Box, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Crosshair, Database, Eye, EyeOff, FileJson, FileUp, Focus, Image,
  Layers3, Link2, MapPin, Maximize2, MoreHorizontal, MousePointer2, PanelRightClose,
  Plus, Radar, RotateCcw, Save, ScanLine, Search, Shapes, Sparkles,
  Tag, Target, Trash2, WandSparkles, Paintbrush, X,
} from 'lucide-react';
import { demoTask, syntheticDemoTask, initialAnnotations, initialClasses, initialRegistration } from './demo';
import ImageReview from './ImageReview';
import ModelSettings from './ModelSettings';
import PairModelBar from './PairModelBar';
import { validatePairPrediction } from './modelApi';
import { loadModelProfiles, loadModelSelection } from './modelRegistry';
import type { ModelModality, ModelProfile } from './modelRegistry';
import { createHttpPrelabelProvider, uploadPrelabelAsset } from './prelabel';
import { nearestPointOnRay, panoramaToWorldDirection, pointToPanorama } from './geometry';
import PanoramaView from './PanoramaView';
import PointCloudView from './PointCloudView';
import type { Annotation, ClassDefinition, Cuboid, Page, PairTask, Registration, ToolMode, UV, Vec3 } from './types';

const NAV: { page: Page; label: string; icon: typeof Database; group?: string }[] = [
  { page: 'review', label: '道路设施复核', icon: Image, group: '当前任务' },
  { page: 'workspace', label: '标注工作台', icon: ScanLine, group: '工作空间' },
  { page: 'tasks', label: '任务列表', icon: Layers3 },
  { page: 'sources', label: '数据源', icon: Database },
  { page: 'ontology', label: '标签体系', icon: Shapes, group: '项目配置' },
  { page: 'registration', label: '配准校验', icon: Crosshair },
  { page: 'models', label: '预标注接口', icon: Sparkles },
];

const TOOLS: { mode: ToolMode; label: string; icon: typeof MousePointer2; hint: string }[] = [
  { mode: 'navigate', label: '浏览', icon: MousePointer2, hint: '拖拽旋转视角' },
  { mode: 'cuboid', label: '3D 框', icon: Box, hint: '单击放置默认框；拖拽选区自动拟合（浏览模式也可按 Ctrl 拖拽）' },
  { mode: 'cloud-paint', label: '点云涂抹', icon: Paintbrush, hint: '先选类别，再在点云上拖动涂抹；Shift 框选，Alt 擦除' },
  { mode: 'pano-point', label: '全景点', icon: MapPin, hint: '在全景上点击创建点' },
  { mode: 'pano-polygon', label: '全景多边形', icon: Shapes, hint: '依次点击顶点，双击结束' },
];

function loadSaved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

function generateId(annotations: Annotation[]) {
  let n = annotations.length + 1;
  while (annotations.some((item) => item.id === `OBJ-${String(n).padStart(3, '0')}`)) n++;
  return `OBJ-${String(n).padStart(3, '0')}`;
}

function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatNumber(value: number) { return Number.isFinite(value) ? value.toFixed(2) : '—'; }

export default function App() {
  const [page, setPage] = useState<Page>('review');
  const [tasks, setTasks] = useState<PairTask[]>([demoTask]);
  const [activeTaskId, setActiveTaskId] = useState(demoTask.id);
  const task = tasks.find((item) => item.id === activeTaskId) ?? demoTask;
  const isRealDemo = task.id === demoTask.id;
  const [classes, setClasses] = useState<ClassDefinition[]>(() => loadSaved('atlas-classes', initialClasses));
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadSaved(`atlas-labels-${demoTask.id}`, initialAnnotations));
  const [semanticLabels, setSemanticLabels] = useState<Record<string, string>>(() => loadSaved(`atlas-points-${demoTask.id}`, {}));
  const [paintHistory, setPaintHistory] = useState<Array<Array<{ index: string; previous?: string }>>>([]);
  const [registration, setRegistration] = useState<Registration>(() => loadSaved(`atlas-reg-${demoTask.id}`, initialRegistration));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('building');
  const [tool, setTool] = useState<ToolMode>('navigate');
  const [draftVertices, setDraftVertices] = useState<UV[]>([]);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showProjection, setShowProjection] = useState(false);
  const [focusSelected, setFocusSelected] = useState(false);
  const [focus, setFocus] = useState<{ uv: UV; serial: number } | null>(null);
  const [toast, setToast] = useState('');
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>(loadModelProfiles);
  const [selectedModels, setSelectedModels] = useState<Record<ModelModality, string>>(loadModelSelection);
  const [pairCandidates, setPairCandidates] = useState<Annotation[]>([]);
  const [pairPointCandidates, setPairPointCandidates] = useState<Array<{ pointIndex: number; classId: string }>>([]);
  const [pairModelVersion, setPairModelVersion] = useState('');
  const [pairRunning, setPairRunning] = useState(false);
  const pairAbort = useRef<AbortController | null>(null);
  const [cloudFile, setCloudFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [calibrationFile, setCalibrationFile] = useState<File | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [sideOpen, setSideOpen] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'objects' | 'attributes'>('objects');
  const selected = annotations.find((item) => item.id === selectedId) ?? null;
  const pairPreviewPointLabels = useMemo(() => Object.fromEntries(pairPointCandidates.map((item) =>
    [String(item.pointIndex), item.classId])), [pairPointCandidates]);
  const selectedPairModel = modelProfiles.find((item) => item.id === selectedModels.paired3d && item.modality === 'paired3d');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetch(demoTask.pointCloudUrl!, { method: 'HEAD' }), fetch(demoTask.panoramaUrl, { method: 'HEAD' })])
      .then(([cloud, panorama]) => {
        if (live && (!cloud.ok || !panorama.ok)) {
          setTasks((previous) => previous[0]?.id === demoTask.id ? [syntheticDemoTask, ...previous.slice(1)] : previous);
          setActiveTaskId((previous) => previous === demoTask.id ? syntheticDemoTask.id : previous);
          setAnnotations(loadSaved(`atlas-labels-${syntheticDemoTask.id}`, []));
          setSemanticLabels(loadSaved(`atlas-points-${syntheticDemoTask.id}`, {}));
          setRegistration(loadSaved(`atlas-reg-${syntheticDemoTask.id}`, initialRegistration));
        }
      })
      .catch(() => {
        if (live) setLoadError('无法检查内置样本，请刷新页面或导入自己的数据');
      });
    return () => { live = false; };
  }, []);

  const flash = (message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 3400);
  };

  useEffect(() => {
    let live = true;
    setGeometry(null);
    setLoadError('');
    if (!task.pointCloudUrl) return;
    const extension = task.pointCloudName.toLowerCase().split('.').pop();
    const load = extension === 'ply'
      ? new PLYLoader().loadAsync(task.pointCloudUrl)
      : new PCDLoader().loadAsync(task.pointCloudUrl).then((points) => points.geometry);
    load.then((result) => {
      if (live) setGeometry(result);
      else result.dispose();
    }).catch((error: unknown) => { if (live) setLoadError(error instanceof Error ? error.message : '点云加载失败'); });
    return () => { live = false; };
  }, [task.id, task.pointCloudUrl, task.pointCloudName]);

  useEffect(() => { localStorage.setItem('atlas-classes', JSON.stringify(classes)); }, [classes]);
  useEffect(() => { localStorage.setItem('atlas-model-profiles-v1', JSON.stringify(modelProfiles)); }, [modelProfiles]);
  useEffect(() => { localStorage.setItem('atlas-selected-models-v1', JSON.stringify(selectedModels)); }, [selectedModels]);
  useEffect(() => () => pairAbort.current?.abort(), []);
  useEffect(() => {
    pairAbort.current?.abort();
    pairAbort.current = null;
    setPairRunning(false);
    setPairCandidates([]);
    setPairPointCandidates([]);
    setPairModelVersion('');
  }, [task.id, selectedModels.paired3d, registration, classes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      const definition = classes.find((item) => item.shortcut === event.key);
      if (definition) setSelectedClassId(definition.id);
      if (event.key === 'Escape') {
        setDraftVertices([]);
        setSelectedId(null);
        setFocusSelected(false);
        return;
      }
      if (page !== 'workspace' && page !== 'registration') return;
      const selectedAnnotation = annotations.find((item) => item.id === selectedId);
      if (!selectedAnnotation) return;
      if (event.key === 'Delete') {
        setAnnotations((previous) => previous.filter((item) => item.id !== selectedId));
        setSelectedId(null);
        setFocusSelected(false);
        setDirty(true);
        return;
      }
      if (!selectedAnnotation.pointCloud) return;
      const box = selectedAnnotation.pointCloud;
      const distance = event.shiftKey ? 0.5 : 0.1;
      const center = [...box.center] as Vec3;
      let yaw = box.yaw ?? 0;
      switch (event.key.toLowerCase()) {
        case 'arrowleft': center[0] -= distance; break;
        case 'arrowright': center[0] += distance; break;
        case 'arrowup': center[2] -= distance; break;
        case 'arrowdown': center[2] += distance; break;
        case 'pageup': center[1] += distance; break;
        case 'pagedown': center[1] -= distance; break;
        case 'q': yaw -= event.shiftKey ? 15 : 5; break;
        case 'e': yaw += event.shiftKey ? 15 : 5; break;
        default: return;
      }
      event.preventDefault();
      setAnnotations((previous) => previous.map((item) => item.id === selectedId
        ? { ...item, pointCloud: { ...box, center, yaw } } : item));
      setDirty(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [classes, page, annotations, selectedId]);

  function mutateAnnotations(updater: (previous: Annotation[]) => Annotation[]) {
    setAnnotations(updater);
    setDirty(true);
  }

  function mutateRegistration(updater: (previous: Registration) => Registration) {
    setRegistration(updater);
    setDirty(true);
  }

  function save() {
    try {
      localStorage.setItem(`atlas-labels-${task.id}`, JSON.stringify(annotations));
      localStorage.setItem(`atlas-reg-${task.id}`, JSON.stringify(registration));
      localStorage.setItem(`atlas-points-${task.id}`, JSON.stringify(semanticLabels));
      setDirty(false);
      flash('3D 框、逐点类别与配准参数已保存到此浏览器');
    } catch {
      flash('浏览器存储空间不足；请先导出 JSON，减少逐点标注量后重试');
    }
  }

  async function runPairModel() {
    if (!selectedPairModel || !geometry || !task.pointCloudUrl || pairRunning) return;
    const controller = new AbortController();
    pairAbort.current = controller;
    setPairRunning(true);
    flash(`正在调用 ${selectedPairModel.name}…`);
    try {
      const [cloudResponse, panoramaResponse] = await Promise.all([
        fetch(task.pointCloudUrl, { signal: controller.signal }),
        fetch(task.panoramaUrl, { signal: controller.signal }),
      ]);
      if (!cloudResponse.ok || !panoramaResponse.ok) throw new Error('当前配对文件无法读取');
      const [cloudBlob, panoramaBlob] = await Promise.all([cloudResponse.blob(), panoramaResponse.blob()]);
      const cloudAssetId = await uploadPrelabelAsset(selectedPairModel.endpoint,
        new File([cloudBlob], task.pointCloudName), 'pointCloud', controller.signal);
      const panoramaAssetId = await uploadPrelabelAsset(selectedPairModel.endpoint,
        new File([panoramaBlob], task.panoramaName), 'panorama', controller.signal);
      const pointCount = geometry.getAttribute('position').count;
      const output = validatePairPrediction(await createHttpPrelabelProvider(selectedPairModel.endpoint).predict({
        schemaVersion: '0.2', taskId: task.id, pointCloudAssetId: cloudAssetId, panoramaAssetId,
        pointCount, coordinateSystem: task.isDemo || task.id === syntheticDemoTask.id
          ? 'camera-local: +X right, +Y up, -Z forward' : 'source point-cloud coordinates',
        registration, classes,
      }, controller.signal), classes.map((item) => item.id), pointCount);
      if (controller.signal.aborted) return;
      setPairCandidates(output.annotations.map((item) => ({ ...item, id: `candidate:${crypto.randomUUID()}`,
        name: item.name || classes.find((entry) => entry.id === item.classId)?.name || '候选对象',
        visible: true, origin: 'prediction', modelId: selectedPairModel.id, modelVersion: output.modelVersion })));
      setPairPointCandidates(output.semanticPointLabels ?? []);
      setPairModelVersion(output.modelVersion ?? selectedPairModel.name);
      flash(`收到 ${output.annotations.length} 个候选对象、${output.semanticPointLabels?.length ?? 0} 个逐点类别；请审核。`);
    } catch (error) {
      if (!controller.signal.aborted) flash(`模型运行失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      if (pairAbort.current === controller) { pairAbort.current = null; setPairRunning(false); }
    }
  }

  function acceptPairCandidate(id: string) {
    const candidate = pairCandidates.find((item) => item.id === id);
    if (!candidate) return;
    mutateAnnotations((previous) => [...previous, { ...candidate, id: generateId(previous) }]);
    setPairCandidates((previous) => previous.filter((item) => item.id !== id));
  }

  function acceptAllPairCandidates() {
    if (!pairCandidates.length) return;
    mutateAnnotations((previous) => {
      const next = [...previous];
      for (const candidate of pairCandidates) next.push({ ...candidate, id: generateId(next) });
      return next;
    });
    setPairCandidates([]);
  }

  function acceptPairPoints() {
    if (!pairPointCandidates.length) return;
    let added = 0;
    const next = { ...semanticLabels };
    for (const item of pairPointCandidates) {
      if (next[item.pointIndex] === undefined) { next[item.pointIndex] = item.classId; added++; }
    }
    setSemanticLabels(next);
    setPairPointCandidates([]);
    setDirty(true);
    flash(`已接受 ${added} 个未人工标注的点；已有逐点标签保持原样`);
  }

  function selectTask(next: PairTask) {
    setActiveTaskId(next.id);
    setAnnotations(loadSaved(`atlas-labels-${next.id}`, []));
    setSemanticLabels(loadSaved(`atlas-points-${next.id}`, {}));
    setPaintHistory([]);
    setRegistration(loadSaved(`atlas-reg-${next.id}`, initialRegistration));
    setSelectedId(null);
    setFocusSelected(false);
    setTool('navigate');
    setDraftVertices([]);
    setDirty(false);
    setPage('workspace');
  }

  function updateAnnotation(id: string, update: Partial<Annotation>) {
    mutateAnnotations((previous) => previous.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  function paintPoints(indices: number[], erase: boolean) {
    const classId = erase ? undefined : selectedClassId;
    const changes = Array.from(new Set(indices)).map((index) => ({ index: String(index), previous: semanticLabels[index] }))
      .filter((change) => change.previous !== classId);
    if (!changes.length) return;
    const next = { ...semanticLabels };
    for (const change of changes) {
      if (classId) next[change.index] = classId;
      else delete next[change.index];
    }
    setSemanticLabels(next);
    setPaintHistory((previous) => [...previous.slice(-19), changes]);
    setDirty(true);
    flash(`${erase ? '擦除' : '标为“' + (classes.find((item) => item.id === classId)?.name ?? '类别') + '”'} ${changes.length.toLocaleString()} 个点`);
  }

  function undoPaint() {
    const changes = paintHistory.at(-1);
    if (!changes) return;
    const next = { ...semanticLabels };
    for (const change of changes) {
      if (change.previous) next[change.index] = change.previous;
      else delete next[change.index];
    }
    setSemanticLabels(next);
    setPaintHistory((previous) => previous.slice(0, -1));
    setDirty(true);
    flash('已撤销上一次点云涂抹');
  }

  function chooseTarget(): { existing: Annotation | null; id: string; classId: string } {
    const existing = annotations.find((item) => item.id === selectedId) ?? null;
    return { existing, id: existing?.id ?? generateId(annotations), classId: existing?.classId ?? selectedClassId };
  }

  function onPointCloudPick(box: Cuboid) {
    const target = chooseTarget();
    if (target.existing && !target.existing.pointCloud) {
      updateAnnotation(target.id, { pointCloud: box });
      flash(`${target.id} 已关联点云 3D 框`);
    } else {
      const id = target.existing ? generateId(annotations) : target.id;
      mutateAnnotations((previous) => [...previous, {
        id, classId: selectedClassId, name: `${classes.find((item) => item.id === selectedClassId)?.name ?? '对象'} ${previous.length + 1}`,
        origin: 'manual', visible: true, pointCloud: box,
      }]);
      setSelectedId(id);
      flash('已创建 3D 框；在点云右下方切换移动、尺寸、旋转并拖动手柄');
    }
    setFocus({ uv: pointToPanorama(box.center, registration), serial: Date.now() });
  }

  function onPointCloudSelect(id: string | null) {
    setSelectedId(id);
    if (!id) { setFocusSelected(false); return; }
    setSelectedTab('attributes');
    const box = annotations.find((item) => item.id === id)?.pointCloud;
    if (box) setFocus({ uv: pointToPanorama(box.center, registration), serial: Date.now() });
  }

  function addPanoramaShape(panorama: Annotation['panorama']) {
    if (!panorama) return;
    const target = chooseTarget();
    if (target.existing && !target.existing.panorama) {
      updateAnnotation(target.id, { panorama });
      flash(`${target.id} 已关联全景标注`);
    } else {
      const id = target.existing ? generateId(annotations) : target.id;
      mutateAnnotations((previous) => [...previous, {
        id, classId: selectedClassId, name: `${classes.find((item) => item.id === selectedClassId)?.name ?? '对象'} ${previous.length + 1}`,
        origin: 'manual', visible: true, panorama,
      }]);
      setSelectedId(id);
      flash('全景标注已创建；选择该对象后可在点云中关联 3D 框');
    }
  }

  function onPanoramaPick(uv: UV) {
    if (tool === 'pano-polygon') {
      setDraftVertices((previous) => [...previous, uv]);
      return;
    }
    addPanoramaShape({ kind: 'point', uv });
    if (geometry) {
      const suggestion = nearestPointOnRay(geometry, registration.position, panoramaToWorldDirection(uv, registration));
      if (suggestion) flash(`全景射线附近存在点云候选点 (${suggestion.map(formatNumber).join(', ')})`);
    }
  }

  function finishPolygon() {
    const vertices = draftVertices.filter((uv, index) => index === 0 ||
      Math.hypot(uv[0] - draftVertices[index - 1][0], uv[1] - draftVertices[index - 1][1]) > 0.002);
    if (vertices.length < 3) {
      setDraftVertices([]);
      flash('多边形至少需要 3 个顶点');
      return;
    }
    addPanoramaShape({ kind: 'polygon', vertices });
    setDraftVertices([]);
  }

  function exportData() {
    downloadJson(`${task.id}-annotations.json`, {
      schemaVersion: '0.2', task: { id: task.id, name: task.name, pointCloudName: task.pointCloudName, panoramaName: task.panoramaName },
      coordinateSystem: task.isDemo || task.id === syntheticDemoTask.id ? 'camera-local: +X right, +Y up, -Z forward' : 'source point-cloud coordinates',
      registration, classes, annotations,
      semanticPointLabels: Object.entries(semanticLabels).map(([pointIndex, classId]) => ({ pointIndex: Number(pointIndex), classId })),
    });
    flash('已导出 JSON 标注文件');
  }

  async function importPair() {
    if (!cloudFile || !imageFile) { flash('请选择点云和全景文件'); return; }
    if (cloudFile.size > 150 * 1024 * 1024) { flash('浏览器原型暂限 150 MB；请先裁剪或降采样点云'); return; }
    let importedRegistration = initialRegistration;
    if (calibrationFile) {
      try {
        const data = JSON.parse(await calibrationFile.text()) as Registration | { registration: Registration };
        const parsed = 'registration' in data ? data.registration : data;
        if (!Array.isArray(parsed.position) || !Array.isArray(parsed.rotation)) throw new Error('格式错误');
        importedRegistration = parsed;
      } catch { flash('配准 JSON 无法解析，请检查 position / rotation 字段'); return; }
    }
    const id = `PAIR-${Date.now().toString(36).toUpperCase()}`;
    const next: PairTask = {
      id, name: newTaskName.trim() || `${cloudFile.name} × ${imageFile.name}`,
      location: '本地导入 / 当前浏览器会话', pointCloudName: cloudFile.name, panoramaName: imageFile.name,
      pointCloudUrl: URL.createObjectURL(cloudFile), panoramaUrl: URL.createObjectURL(imageFile),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setTasks((previous) => [...previous, next]);
    setRegistration(importedRegistration);
    setAnnotations([]);
    setSemanticLabels({});
    setPaintHistory([]);
    setActiveTaskId(id);
    setSelectedId(null);
    setFocusSelected(false);
    setTool('navigate');
    setDirty(false);
    setPage('workspace');
    flash('点云与全景配对任务已导入；请在配准校验中核对位置和方向');
  }

  function addClass() {
    const name = newClassName.trim();
    if (!name) return;
    const color = ['#7e83e9', '#e39a60', '#49bfae', '#ce79a9'][classes.length % 4];
    const id = `class-${Date.now()}`;
    setClasses((previous) => [...previous, { id, name, color, shortcut: previous.length < 9 ? String(previous.length + 1) : '' }]);
    setSelectedClassId(id);
    setNewClassName('');
    flash(`已添加标签“${name}”`);
  }

  const filteredAnnotations = useMemo(() => annotations.filter((item) =>
    `${item.name} ${item.id} ${classes.find((definition) => definition.id === item.classId)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  ), [annotations, classes, search]);

  const inspector = (
    <aside className={`inspector ${sideOpen ? '' : 'is-collapsed'}`}>
      {sideOpen ? <>
        <div className="inspector-title"><div><strong>{page === 'registration' ? '配准校验' : '标注对象'}</strong><span>{page === 'registration' ? '同步采样 · INS 粗配准' : `${annotations.length} 个对象`}</span></div><button className="icon-button" onClick={() => setSideOpen(false)} title="收起面板"><PanelRightClose size={18} /></button></div>
        {page === 'registration' ? <RegistrationInspector registration={registration} onChange={mutateRegistration} onReset={() => { setRegistration(initialRegistration); setDirty(true); }} showProjection={showProjection} setShowProjection={setShowProjection} isDemo={isRealDemo} /> : <>
          <div className="inspector-tabs"><button className={selectedTab === 'objects' ? 'active' : ''} onClick={() => setSelectedTab('objects')}>对象列表</button><button className={selectedTab === 'attributes' ? 'active' : ''} onClick={() => setSelectedTab('attributes')}>属性详情</button></div>
          {selectedTab === 'objects' ? <>
            <div className="inspector-section"><div className="section-heading"><span>标注类别</span><span className="subtle">快捷键 1–9</span></div><div className="class-list">{classes.map((definition) => <button key={definition.id} className={`class-chip ${selectedClassId === definition.id ? 'selected' : ''}`} onClick={() => setSelectedClassId(definition.id)}><span className="class-dot" style={{ background: definition.color }} />{definition.name}<kbd>{definition.shortcut}</kbd></button>)}</div></div>
            <div className="object-section"><div className="section-heading"><span>对象列表</span><span className="subtle">{annotations.length} 个</span></div><div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索对象或 ID" /></div><div className="object-list">{filteredAnnotations.length ? filteredAnnotations.map((item) => <button key={item.id} className={`object-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setSelectedTab('attributes'); if (item.pointCloud) setFocus({ uv: pointToPanorama(item.pointCloud.center, registration), serial: Date.now() }); }}><span className="object-icon" style={{ color: classes.find((c) => c.id === item.classId)?.color }}><Box size={17} /></span><span className="object-copy"><strong>{item.name}</strong><small>{item.id} · {item.pointCloud ? '3D' : '—'} / {item.panorama ? '全景' : '—'}</small></span><ChevronRight size={15} /></button>) : <div className="empty-objects"><Focus size={26} /><strong>尚无标注对象</strong><span>选类别后在点云或全景视图中创建</span></div>}</div></div>
          </> : selected ? <div className="attributes-panel"><div className="selected-object-heading"><span className="class-dot" style={{ background: classes.find((c) => c.id === selected.classId)?.color }} /><div><strong>{selected.id}</strong><small>同一对象 ID 关联双视图</small></div></div><label className="field-label">对象名称<input value={selected.name} onChange={(event) => updateAnnotation(selected.id, { name: event.target.value })} /></label><label className="field-label">类别<select value={selected.classId} onChange={(event) => updateAnnotation(selected.id, { classId: event.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="modality-status"><div><span className={selected.pointCloud ? 'status-icon good' : 'status-icon'}>{selected.pointCloud ? <Check size={13} /> : <Plus size={13} />}</span><span>点云 3D 框</span><strong>{selected.pointCloud ? '已标注' : '待标注'}</strong></div><div><span className={selected.panorama ? 'status-icon good' : 'status-icon'}>{selected.panorama ? <Check size={13} /> : <Plus size={13} />}</span><span>全景影像</span><strong>{selected.panorama ? '已标注' : '待标注'}</strong></div></div>{selected.pointCloud && <div className="dimension-block"><div className="section-heading">3D 框中心 <span className="subtle">米</span></div><div className="triple-input">{selected.pointCloud.center.map((value, index) => <label key={index}>{['X', 'Y', 'Z'][index]}<input type="number" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => { const center = [...selected.pointCloud!.center] as Vec3; center[index] = Number(event.target.value); updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, center } }); }} /></label>)}</div><div className="section-heading">框尺寸 <span className="subtle">宽 / 高 / 深</span></div><div className="triple-input">{selected.pointCloud.size.map((value, index) => <label key={index}>{['W', 'H', 'D'][index]}<input type="number" min="0.1" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => { const size = [...selected.pointCloud!.size] as Vec3; size[index] = Math.max(0.1, Number(event.target.value)); updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, size } }); }} /></label>)}</div><label className="field-label">水平旋转 Yaw（°）<input type="number" step="5" value={selected.pointCloud.yaw ?? 0} onChange={(event) => updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, yaw: Number(event.target.value) } })} /></label><p className="box-edit-hint">方向键平移 · PageUp/Down 升降 · Q/E 旋转 · Delete 删除</p></div>}<p className="inspector-tip"><Link2 size={15} />选择这个对象，再到另一视图绘制，即可共享 {selected.id}。</p><div className="object-actions"><button onClick={() => updateAnnotation(selected.id, { visible: !selected.visible })}>{selected.visible ? <EyeOff size={15} /> : <Eye size={15} />}{selected.visible ? '隐藏' : '显示'}</button><button className="danger" onClick={() => { mutateAnnotations((previous) => previous.filter((item) => item.id !== selected.id)); setSelectedId(null); setSelectedTab('objects'); }}><Trash2 size={15} />删除</button></div></div> : <div className="empty-attributes"><Target size={30} /><strong>选择一个标注对象</strong><span>在此编辑名称、类别与 3D 框尺寸</span></div>}
        </>}
      </> : <button className="reopen-side" onClick={() => setSideOpen(true)} title="展开对象面板"><PanelRightClose size={20} /></button>}
    </aside>
  );

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><Layers3 size={19} strokeWidth={2.5} /></span><div><strong>Atlas Studio</strong><small>MULTIMODAL LABELING</small></div></div><div className="project-picker"><div className="project-icon"><MapPin size={17} /></div><div><small>当前项目</small><strong>城市空间要素标注</strong></div><ChevronDown size={14} /></div><nav className="side-nav">{NAV.map(({ page: navPage, label, icon: Icon, group }) => <div key={navPage}>{group && <div className="nav-group">{group}</div>}<button className={`nav-item ${page === navPage ? 'active' : ''}`} onClick={() => { setPage(navPage); if (navPage === 'registration') setSideOpen(true); }}><Icon size={18} /><span>{label}</span>{navPage === 'tasks' && <small>{tasks.length}</small>}</button></div>)}</nav><div className="sidebar-bottom"><div className="pipeline-card"><span className="pipeline-icon"><WandSparkles size={17} /></span><strong>AI 预标注</strong><p>可配置多个模型服务，并在对应工作台切换。</p><button onClick={() => setPage('models')}>配置接口 <ArrowRight size={14} /></button></div><button className="help-link" onClick={() => flash('当前为前端原型；操作说明见项目 README')}><CircleHelp size={17} />帮助与文档</button><div className="profile"><span>AT</span><div><strong>标注员</strong><small>本地工作空间</small></div><MoreHorizontal size={17} /></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="crumb"><span>城市空间要素标注</span><ChevronRight size={15} /><strong>{NAV.find((item) => item.page === page)?.label}</strong></div><div className="top-actions"><span className="prototype-pill"><span /> 原型环境</span><button className="top-icon" onClick={() => flash('当前无通知')} title="系统状态"><Activity size={18} /></button><span className="avatar">AT</span></div></header>
      {(page === 'workspace' || page === 'registration') ? <><div className="task-header"><div className="task-header-main"><button className="back-button" onClick={() => setPage('tasks')} title="返回任务列表"><ArrowLeft size={18} /></button><div><div className="eyebrow">ANNOTATION WORKSPACE <span> / {task.id}</span></div><h1>{task.name}</h1><div className="task-meta"><span><MapPin size={14} />{task.location}</span><span className="meta-divider" /><span><CheckCircle2 size={14} />双模态配对</span><span className="meta-divider" /><span>{annotations.length} 个标注对象</span></div></div></div><div className="task-header-actions"><button className="button button-light" onClick={exportData}><ArrowDownToLine size={16} />导出结果</button><button className="button button-primary" onClick={save}><Save size={16} />{dirty ? '保存更改' : '已保存'}</button></div></div>
        <div className="work-area"><main className="workspace"><div className="workspace-tools"><div className="tool-group">{TOOLS.map(({ mode, label, icon: Icon, hint }) => <button key={mode} className={`tool-button ${tool === mode ? 'active' : ''}`} title={hint} onClick={() => { if (draftVertices.length && mode !== 'pano-polygon') setDraftVertices([]); setTool(mode); if (mode === 'cloud-paint') setSelectedTab('objects'); }}><Icon size={17} />{label}</button>)}</div><div className="tool-trailing"><button className={`projection-button ${showProjection ? 'active' : ''}`} onClick={() => setShowProjection(!showProjection)} title="将点云投影到全景，校验配准"><Radar size={17} />投影核验</button><span className="tool-separator" /><button className="ai-button" onClick={() => setPage('models')}><Sparkles size={16} />AI 预标注 <span>可配置</span></button></div></div><div className="instruction-strip"><span className="instruction-symbol"><CircleHelp size={16} /></span><span>{TOOLS.find((item) => item.mode === tool)?.hint}。选择右侧已有对象后在另一视图绘制，可关联同一个对象 ID。</span>{draftVertices.length > 0 && <button onClick={finishPolygon}>完成多边形 ({draftVertices.length} 点)</button>}</div>
          <PairModelBar models={modelProfiles} selectedModelId={selectedPairModel?.id ?? ""} onSelectModel={(id) => setSelectedModels((previous) => ({ ...previous, paired3d: id }))} onOpenSettings={() => setPage("models")} onRun={() => void runPairModel()} onCancel={() => pairAbort.current?.abort()} running={pairRunning} ready={Boolean(geometry)} candidates={pairCandidates} pointCandidateCount={pairPointCandidates.length} modelVersion={pairModelVersion} classes={classes} onFocus={(candidate) => { if (candidate.panorama?.kind === "point") setFocus({ uv: candidate.panorama.uv, serial: Date.now() }); else if (candidate.panorama?.kind === "polygon") setFocus({ uv: candidate.panorama.vertices[0], serial: Date.now() }); else if (candidate.pointCloud) setFocus({ uv: pointToPanorama(candidate.pointCloud.center, registration), serial: Date.now() }); }} onAccept={acceptPairCandidate} onReject={(id) => setPairCandidates((previous) => previous.filter((item) => item.id !== id))} onAcceptAll={acceptAllPairCandidates} onRejectAll={() => setPairCandidates([])} onAcceptPoints={acceptPairPoints} onRejectPoints={() => setPairPointCandidates([])} /><div className="split-view"><section className="viewport-card"><div className="viewport-head"><div className="viewport-heading"><span className="view-icon cloud"><Box size={18} /></span><div><strong>三维点云</strong><small>POINT CLOUD · PCD</small></div></div><div className="viewport-head-right"><span className="view-count">{geometry?.getAttribute('position')?.count.toLocaleString() ?? '—'} 点</span><button className="icon-button" onClick={() => flash('3D 框：框选拟合后拖动移动、尺寸、旋转手柄；点云涂抹：选类后拖动，Shift 框选，Alt 擦除')} title="视图操作"><Maximize2 size={16} /></button></div></div><div className="viewport-body"><PointCloudView geometry={geometry} annotations={annotations} previewAnnotations={pairCandidates} classes={classes} semanticLabels={semanticLabels} previewSemanticLabels={pairPreviewPointLabels} selectedId={selectedId} registration={registration} tool={tool} focusSelected={focusSelected} onToggleFocus={() => setFocusSelected((value) => !value)} onCreate={onPointCloudPick} onUpdate={(id, box) => updateAnnotation(id, { pointCloud: box })} onPaint={paintPoints} onUndoPaint={undoPaint} canUndoPaint={paintHistory.length > 0} onSelect={onPointCloudSelect} onEmptySelection={() => flash("选区没有找到足够的点；请扩大范围或切换俯视视角")} />{!geometry && <div className="viewer-loading">{loadError ? `加载失败：${loadError}` : '正在加载点云…'}</div>}<div className="view-overlay top-left"><span className="live-dot" />{task.id === syntheticDemoTask.id ? '合成演示数据' : task.isDemo ? '真实样本 · 局部降采样' : '本地配对数据'}</div><div className="view-overlay bottom-left">左键旋转 · 滚轮缩放 · 右键平移</div><div className="axis-legend"><i className="axis-x" />X <i className="axis-y" />Y <i className="axis-z" />Z</div></div><div className="viewport-foot"><span><span className="tiny-color cloud" />{task.pointCloudName}</span><span>{geometry ? '已加载' : '加载中'}</span></div></section>
          <div className="pair-bridge"><span><Link2 size={17} /></span></div>
          <section className="viewport-card"><div className="viewport-head"><div className="viewport-heading"><span className="view-icon pano"><Image size={18} /></span><div><strong>全景影像</strong><small>PANORAMA · 360°</small></div></div><div className="viewport-head-right"><span className="view-count">等距柱状投影</span><button className="icon-button" onClick={() => setFocus({ uv: [0.5, 0.5], serial: Date.now() })} title="回到正前方"><Focus size={16} /></button></div></div><div className="viewport-body"><PanoramaView imageUrl={task.panoramaUrl} cloudGeometry={geometry} annotations={annotations} previewAnnotations={pairCandidates} classes={classes} selectedId={selectedId} registration={registration} tool={tool} draftVertices={draftVertices} showProjection={showProjection} focus={focus} onPick={onPanoramaPick} onFinishPolygon={finishPolygon} /><div className="view-overlay top-left"><span className="live-dot cyan" />{showProjection ? '点云投影叠加 · 核验中' : '球面交互视图'}</div><div className="view-overlay bottom-left">拖拽环视 · 滚轮调整视角</div><div className="compass">N <span>·</span> 360°</div></div><div className="viewport-foot"><span><span className="tiny-color pano" />{task.panoramaName}</span><span>已配对</span></div></section></div>
          <div className="registration-bar"><span className="registration-emblem"><Crosshair size={18} /></span><div><strong>{task.isDemo ? 'INS 位姿粗配准' : '手动位姿配准'}</strong><p>{task.isDemo ? '依据 TREE 项目逐帧轨迹与 Ladybug 球面公式建立初始对应；未包含相机杆臂和安装角外参。' : '根据导入的相机位姿进行 3D→全景投影；建议用可辨认地物核验并微调。'}</p></div><button onClick={() => { setPage('registration'); setSideOpen(true); setShowProjection(true); }}>校验与微调 <ArrowRight size={15} /></button></div></main>{inspector}</div></> : <div className="content-page">{page === 'review' && <ImageReview models={modelProfiles} selectedModelId={selectedModels.image2d} onSelectModel={(id) => setSelectedModels((previous) => ({ ...previous, image2d: id }))} onOpenSettings={() => setPage("models")} />}{page === 'tasks' && <><PageHeading eyebrow="DATA MANAGER" title="任务列表" description="每个任务是一组同步采样的点云与全景影像，标注结果以同一个对象 ID 在两种视图中关联。" action={<button className="button button-primary" onClick={() => setPage('sources')}><Plus size={16} />新建配对任务</button>} /><div className="summary-grid"><SummaryCard icon={Layers3} label="配对任务" value={String(tasks.length)} tone="purple" /><SummaryCard icon={Box} label="当前任务点云" value={geometry ? `${Math.round(geometry.getAttribute('position').count / 1000)}k` : '—'} tone="blue" /><SummaryCard icon={Tag} label="当前标注对象" value={String(annotations.length)} tone="green" /></div><div className="table-card"><div className="table-title"><strong>全部任务</strong><span>{tasks.length} 项</span></div><div className="task-table-header"><span>任务名称</span><span>数据组合</span><span>标注进度</span><span>操作</span></div>{tasks.map((item) => <div className="task-table-row" key={item.id}><div><span className="table-task-icon"><Layers3 size={18} /></span><span><strong>{item.name}</strong><small>{item.id} · {item.location}</small></span></div><div className="file-pair"><span><Box size={14} />PCD / PLY</span><span><Image size={14} />JPG / PNG</span></div><div><span className="status-tag">{item.id === task.id && annotations.length ? '标注中' : '待标注'}</span></div><button onClick={() => selectTask(item)}>打开工作台 <ArrowRight size={15} /></button></div>)}</div></>}
      {page === 'sources' && <><PageHeading eyebrow="DATA SOURCES" title="导入配对数据" description="选择同一采样站点的点云和全景文件。浏览器原型按任务配对，不会修改原始数据。" /><div className="source-layout"><div className="source-card"><div className="source-card-heading"><span className="step-number">01</span><div><strong>创建点云 / 全景任务</strong><p>支持 PCD、PLY 与 JPG、PNG 等距柱状全景图</p></div></div><label className="field-label">任务名称<input value={newTaskName} onChange={(event) => setNewTaskName(event.target.value)} placeholder="例如：尖沙咀街区 · 站点 002" /></label><div className="upload-pair"><label className={`upload-box ${cloudFile ? 'has-file' : ''}`}><input type="file" accept=".pcd,.ply" onChange={(event) => setCloudFile(event.target.files?.[0] ?? null)} /><Box size={25} /><strong>{cloudFile?.name ?? '选择点云文件'}</strong><span>PCD / PLY · 最大 150 MB</span></label><span className="upload-link"><Link2 size={17} /></span><label className={`upload-box ${imageFile ? 'has-file' : ''}`}><input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><Image size={25} /><strong>{imageFile?.name ?? '选择全景影像'}</strong><span>JPG / PNG · 2:1 等距柱状</span></label></div><label className="calibration-upload"><FileJson size={20} /><span><strong>{calibrationFile?.name ?? '可选：导入配准 JSON'}</strong><small>字段：position [x,y,z]、rotation [yaw,pitch,roll]（角度）</small></span><input type="file" accept=".json,application/json" onChange={(event) => setCalibrationFile(event.target.files?.[0] ?? null)} /><Plus size={17} /></label><button className="button button-primary create-task" onClick={importPair}><FileUp size={17} />创建并进入标注工作台</button></div><div className="source-help"><div className="source-help-icon"><Radar size={22} /></div><h3>配准数据如何工作？</h3><p>点云坐标与全景相机需要处于同一个坐标系。导入相机位姿后，工作台可以将 3D 点投影到球面全景进行核验。</p><div className="code-block">{'{\n  "position": [0, 0, 0],\n  "rotation": [0, 0, 0]\n}'}</div><p className="minor">未提供完整外参时，可以先导入粗位姿，然后在“配准校验”中逐项微调。</p></div></div></>}
      {page === 'ontology' && <><PageHeading eyebrow="ONTOLOGY" title="标签体系" description="建筑组件、标志和地物共享一套类别。所有标注对象都保留稳定 ID，便于关联点云与影像结果。" /><div className="ontology-card"><div className="table-title"><strong>当前类别</strong><span>{classes.length} 类</span></div>{classes.map((definition) => <div className="ontology-row" key={definition.id}><span className="class-dot large" style={{ background: definition.color }} /><div><strong>{definition.name}</strong><small>{definition.id}</small></div><span className="ontology-hotkey">快捷键 {definition.shortcut}</span><span className="enabled-pill">已启用</span></div>)}<div className="ontology-add"><input value={newClassName} onChange={(event) => setNewClassName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addClass(); }} placeholder="新增类别名称，例如：路灯" /><button className="button button-primary" onClick={addClass}><Plus size={16} />添加类别</button></div></div></>}
      {page === 'models' && <><PageHeading eyebrow="AI PRELABELING" title="模型服务管理" description="按数据类型配置多个模型，在标注页选择并运行。模型输出先进入待审核层。" /><ModelSettings profiles={modelProfiles} selected={selectedModels} onProfilesChange={setModelProfiles} onSelectionChange={setSelectedModels} /></>}
      </div>}
    </div>{toast && <div className="toast"><CheckCircle2 size={17} />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: typeof Database; label: string; value: string; tone: string }) {
  return <div className="summary-card"><span className={`summary-icon ${tone}`}><Icon size={20} /></span><span>{label}</span><strong>{value}</strong></div>;
}

function RegistrationInspector({ registration, onChange, onReset, showProjection, setShowProjection, isDemo }: { registration: Registration; onChange: (updater: (previous: Registration) => Registration) => void; onReset: () => void; showProjection: boolean; setShowProjection: (value: boolean) => void; isDemo: boolean }) {
  const adjust = (kind: 'position' | 'rotation', index: number, value: number) => onChange((previous) => {
    const next = [...previous[kind]] as Vec3;
    next[index] = value;
    return { ...previous, [kind]: next };
  });
  return <div className="registration-inspector"><div className="quality-card"><span><CheckCircle2 size={17} /></span><div><strong>{isDemo ? 'INS 位姿已载入' : '位姿参数已就绪'}</strong><p>{isDemo ? '当前为平台共轴近似。请开启投影核验并参照建筑边缘微调。' : '请核对相机位置与全景朝向。'}</p></div></div><div className="registration-toggle"><div><strong>点云投影叠加</strong><small>在全景中显示稀疏投影点</small></div><button className={`switch ${showProjection ? 'on' : ''}`} onClick={() => setShowProjection(!showProjection)} aria-label="切换点云投影叠加"><span /></button></div><div className="reg-section"><div className="section-heading"><span>相机位置</span><span className="subtle">点云坐标 · 米</span></div><div className="reg-inputs">{registration.position.map((value, index) => <label key={index}><span>{['X', 'Y', 'Z'][index]}</span><input type="number" step="0.05" value={value} onChange={(event) => adjust('position', index, Number(event.target.value))} /></label>)}</div></div><div className="reg-section"><div className="section-heading"><span>相机朝向</span><span className="subtle">角度</span></div><div className="reg-inputs">{registration.rotation.map((value, index) => <label key={index}><span>{['Yaw', 'Pitch', 'Roll'][index]}</span><input type="number" step="0.1" value={value} onChange={(event) => adjust('rotation', index, Number(event.target.value))} /></label>)}</div></div><button className="reset-registration" onClick={onReset}><RotateCcw size={15} />恢复初始位姿</button><div className="formula-card"><span><AlignHorizontalJustifyCenter size={17} />球面投影约定</span><code>u = 0.5 − atan2(left, forward) / 2π<br />v = 0.5 − asin(up / distance) / π</code><p>与 TREE 的 Ladybug 投影方向一致。示例点云已变换到相机局部坐标；零位姿为初始粗配准。</p></div></div>;
}
