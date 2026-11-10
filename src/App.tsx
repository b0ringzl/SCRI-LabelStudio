import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import {
  AlignHorizontalJustifyCenter, ArrowDownToLine, ArrowLeft,
  Box, Check, CheckCircle2, ChevronRight, CircleHelp,
  Crosshair, Eye, EyeOff, Focus, Image,
  Link2, MapPin, Maximize2, MousePointer2, PanelRightClose,
  Plus, RotateCcw, Save, Search, Shapes,
  Target, Trash2, Paintbrush, X,
} from 'lucide-react';
import { demoTask, syntheticDemoTask, initialAnnotations, initialClasses, initialRegistration } from './demo';
import ImageReview from './ImageReview';
import type { ReviewSession } from './ImageReview';
import { AnnotationTabs, WorkflowSidebar, workflowPage } from './WorkflowShell';
import DataWorkspace from './DataWorkspace';
import TrainingWorkspace from './TrainingWorkspace';
import FrameNavigator from './FrameNavigator';
import './workflow.css';
import ModelSettings from './ModelSettings';
import PairModelBar from './PairModelBar';
import { runVisionLlm, validatePairPrediction } from './modelApi';
import { loadModelProfiles, loadModelSelection } from './modelRegistry';
import type { ModelModality, ModelProfile } from './modelRegistry';
import { createHttpPrelabelProvider, uploadPrelabelAsset } from './prelabel';
import { directionToPanorama, panoramaToDirection, nearestPointOnRay, panoramaToWorldDirection, pointToPanorama, registrationQuaternion } from './geometry';
import { ViewSync } from './viewSync';
import { frameHasPose, prepareLocalScene } from './sceneImport';
import type { LocalSceneManifest } from './sceneImport';
import { parseCalibrationDocument } from './registrationIO';
import { estimatePanoramaYaw, hasUsableRgb } from './autoYaw';
import { runAutomaticRegistration } from './automaticRegistration';
import type { AutoRegistrationCandidate } from './automaticRegistration';
import { runDepthRegistration, validateDepthCandidate } from './depthRegistration';
import type { DepthRegistrationResult } from './depthRegistration';
import { solveTiePoints, triangulateTarget } from './registrationMath';
import { contourPlane, makeObservation, observationVertices, replaceObservation } from './panoramaContours';
import { AnnotationHistory } from './annotationHistory';
import type { EditSnapshot } from './annotationHistory';
import ContourTools from './ContourTools';
import RegistrationWorkflow from './RegistrationWorkflow';
import PanoramaView from './PanoramaView';
import PointCloudView from './PointCloudView';
import type { Annotation, ClassDefinition, Cuboid, Page, PairTask, Registration, RegistrationEvidence, TiePoint, ToolMode, UV, Vec3 } from './types';

const TOOLS: { mode: ToolMode; label: string; icon: typeof MousePointer2; hint: string }[] = [
  { mode: 'navigate', label: '浏览', icon: MousePointer2, hint: '拖拽旋转视角' },
  { mode: 'cuboid', label: '3D 框', icon: Box, hint: '单击放置默认框；拖拽选区自动拟合（浏览模式也可按 Ctrl 拖拽）' },
  { mode: 'cloud-paint', label: '点云涂抹', icon: Paintbrush, hint: '先选类别，再在点云上拖动涂抹；Shift 框选，Alt 擦除' },
  { mode: 'pano-point', label: '全景点', icon: MapPin, hint: '在全景上点击创建点' },
  { mode: 'pano-polygon', label: '全景多边形', icon: Shapes, hint: '沿轮廓依次点选，Enter 或“完成轮廓”结束；拖动编号顶点可修正' },
  { mode: 'tie-point', label: '同名点', icon: Crosshair, hint: '先在左侧点云点一个地物，再在右侧当前全景点同一位置；至少四对可自动求解位姿' },
  { mode: 'target-box', label: '多帧目标框', icon: Target, hint: '沿目标轮廓逐点圈选，Enter 完成；换相邻帧，保持选中同一对象继续圈选' },
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
  const [page, setPage] = useState<Page>('sources');
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dataKind, setDataKind] = useState<'paired' | 'image'>('paired');
  const [annotationMode, setAnnotationMode] = useState<'paired' | 'image'>('paired');
  const [tasks, setTasks] = useState<PairTask[]>([demoTask]);
  const [activeTaskId, setActiveTaskId] = useState(demoTask.id);
  const task = tasks.find((item) => item.id === activeTaskId) ?? demoTask;
  const isRealDemo = task.id === demoTask.id;
  const [classes, setClasses] = useState<ClassDefinition[]>(() => loadSaved('atlas-classes', initialClasses));
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadSaved(`atlas-labels-${demoTask.id}`, initialAnnotations));
  const [semanticLabels, setSemanticLabels] = useState<Record<string, string>>(() => loadSaved(`atlas-points-${demoTask.id}`, {}));
  const [paintHistory, setPaintHistory] = useState<Array<Array<{ index: string; previous?: string }>>>([]);
  const [registration, setRegistration] = useState<Registration>(() => loadSaved(`atlas-reg-${demoTask.id}`, initialRegistration));
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameRegistrations, setFrameRegistrations] = useState<Record<string, Registration>>(() =>
    loadSaved(`atlas-frame-reg-${demoTask.id}`, { [demoTask.id]: initialRegistration }));
  const poseStateRef=useRef(frameRegistrations);poseStateRef.current=frameRegistrations;
  const [frameEvidence, setFrameEvidence] = useState<Record<string, RegistrationEvidence>>(() =>
    loadSaved(`atlas-frame-evidence-${demoTask.id}`, {}));
  const [tiePoints, setTiePoints] = useState<TiePoint[]>(() => loadSaved(`atlas-ties-${demoTask.id}`, []));
  const [pendingTiePoint, setPendingTiePoint] = useState<Vec3 | null>(null);
  const [registrationQuality, setRegistrationQuality] = useState('');
  const [autoYawRunning, setAutoYawRunning] = useState(false);
  const [autoRegistrationRunning, setAutoRegistrationRunning] = useState(false);
  const [autoRegistrationMethod, setAutoRegistrationMethod] = useState<'nid'|'da2'>('da2');
  const [depthResults, setDepthResults] = useState<Record<string, DepthRegistrationResult>>({});
  const [autoRegistrationProgress, setAutoRegistrationProgress] = useState('');
  const [autoRegistrationStatus, setAutoRegistrationStatus] = useState<{ configured: boolean; reason?: string; label?: string } | null>(null);
  const [autoRegistrationCandidates, setAutoRegistrationCandidates] = useState<Record<string, AutoRegistrationCandidate>>({});
  const [previewAutoRegistration, setPreviewAutoRegistration] = useState(false);
  const autoRegistrationAbort = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('building');
  const [tool, setTool] = useState<ToolMode>('navigate');
  const [draftVertices, setDraftVertices] = useState<UV[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [targetRectangle, setTargetRectangle] = useState(false);
  const [targetExtent,setTargetExtent]=useState<'surface'|'object'>('object');
  const [locatingTarget,setLocatingTarget] = useState(false);
  const history = useRef(new AnnotationHistory());
  const annotationsRef = useRef(annotations); annotationsRef.current = annotations;
  const [, refreshHistory] = useState(0);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showProjection, setShowProjection] = useState(false);
  const viewSync = useMemo(() => new ViewSync(), []);
  const [viewLayout, setViewLayout] = useState<'split' | 'overlay'>('split');
  const [expandedCloud, setExpandedCloud] = useState(false);
  const [viewLinked, setViewLinked] = useState(true);
  const [registrationStep, setRegistrationStep] = useState(0);
  const [readyPanoramaUrl, setReadyPanoramaUrl] = useState('');
  const [panoramaError, setPanoramaError] = useState('');
  const [sceneOptions, setSceneOptions] = useState<Array<{key:string;name:string}>>([]);
  const [sceneKey, setSceneKey] = useState('');
  const [sceneLoading, setSceneLoading] = useState(false);
  const sceneAbort = useRef<AbortController | null>(null);
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
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [calibrationFile, setCalibrationFile] = useState<File | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [sideOpen, setSideOpen] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'objects' | 'attributes'>('objects');
  const selected = annotations.find((item) => item.id === selectedId) ?? null;
  const frames = task.frames?.length ? task.frames : [{ id: task.id, name: task.panoramaName, url: task.panoramaUrl }];
  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)];
  const currentFrameId = currentFrame.id;
  const isInsApproximate = isRealDemo || frameEvidence[currentFrameId]?.source === 'ins-approximate';
  const initialPoseSource = task.initialPoseSource ?? (isRealDemo ? 'ins-approximate' : 'imported');
  const hasFramePose = frameHasPose(currentFrame, frameRegistrations[currentFrameId], task.isDemo);
  const activePanoramaUrl = currentFrame.url;
  const activePanoramaName = currentFrame.name;
  const currentTies = useMemo(() => tiePoints.filter((pair) => pair.frameId === currentFrameId), [tiePoints, currentFrameId]);
  const displayedRegistration = previewAutoRegistration && autoRegistrationCandidates[currentFrameId]
    ? autoRegistrationCandidates[currentFrameId].registration : registration;
  const displayAnnotations = useMemo(() => annotations.map((item) => {
    if (!item.observations?.length) return item.panoramaFrameId && item.panoramaFrameId !== currentFrameId
      ? { ...item, panorama: undefined } : item;
    const observation = item.observations.find((entry) => entry.frameId === currentFrameId);
    if (!observation) return { ...item, panorama: undefined };
    return { ...item, panorama: { kind: 'polygon' as const, vertices: observationVertices(observation) } };
  }), [annotations, currentFrameId]);
  const selectedShape = displayAnnotations.find(item=>item.id===selectedId)?.panorama;
  const currentVertices = selectedShape?.kind==='polygon' ? selectedShape.vertices : [];
  const pairPreviewPointLabels = useMemo(() => Object.fromEntries(pairPointCandidates.map((item) =>
    [String(item.pointIndex), item.classId])), [pairPointCandidates]);
  const selectedPairModel = modelProfiles.find((item) => item.id === selectedModels.paired3d && item.modality === 'paired3d');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    viewSync.set(registrationQuaternion(registration), 72);
    setViewLinked(true); setViewLayout('split'); setRegistrationStep(0); setExpandedCloud(false);
  }, [activeTaskId, viewSync]);

  function chooseRegistrationStep(step: number) {
    setPage('registration'); setRegistrationStep(step); setViewLinked(true);
    setViewLayout(step === 2 ? 'overlay' : 'split'); setShowProjection(step === 2);
    setTool(step === 1 ? 'tie-point' : 'navigate'); setPendingTiePoint(null);
  }

  function chooseLayout(layout: 'split' | 'overlay') {
    setExpandedCloud(false);
    setViewLayout(layout); setShowProjection(layout === 'overlay');
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('localScene') === '1') return;
    let live = true;
    Promise.all([fetch(demoTask.pointCloudUrl!, { method: 'HEAD' }), fetch(demoTask.panoramaUrl, { method: 'HEAD' })])
      .then(([cloud, panorama]) => {
        if (live && (!cloud.ok || !panorama.ok)) {
          setTasks((previous) => previous[0]?.id === demoTask.id ? [syntheticDemoTask, ...previous.slice(1)] : previous);
          setActiveTaskId((previous) => previous === demoTask.id ? syntheticDemoTask.id : previous);
          setAnnotations(loadSaved(`atlas-labels-${syntheticDemoTask.id}`, []));
          setSemanticLabels(loadSaved(`atlas-points-${syntheticDemoTask.id}`, {}));
          setRegistration(loadSaved(`atlas-reg-${syntheticDemoTask.id}`, initialRegistration));
          setFrameRegistrations(loadSaved(`atlas-frame-reg-${syntheticDemoTask.id}`, { [syntheticDemoTask.id]: initialRegistration }));
          setFrameEvidence(loadSaved(`atlas-frame-evidence-${syntheticDemoTask.id}`, {}));
          setTiePoints(loadSaved(`atlas-ties-${syntheticDemoTask.id}`, []));
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

  async function loadLocalScene(key?: string, openRegistration = true) {
    autoRegistrationAbort.current?.abort();
    sceneAbort.current?.abort();
    const controller = new AbortController(); sceneAbort.current = controller;
    setSceneLoading(true);
    try {
      const response = await fetch('/api/local-scene/manifest'+(key ? '?scene='+encodeURIComponent(key) : ''),{signal:controller.signal});
      if (!response.ok) throw new Error('本机场景未配置，请用 --scene-dir 指定场景或场景集');
      const data = await response.json() as LocalSceneManifest;
      const prepared = prepareLocalScene(data);
      if (controller.signal.aborted) return;
      const next=prepared.task;
      setTasks((previous)=>[...previous.filter((item)=>item.id!==next.id),next]);
      selectTask(next);
      const stored=loadSaved<Record<string,Registration>>('atlas-frame-reg-'+next.id,{});
      setFrameRegistrations({...prepared.registrations,...stored});
      setFrameEvidence({...prepared.evidence,...loadSaved<Record<string,RegistrationEvidence>>('atlas-frame-evidence-'+next.id,{})});
      setFrameIndex(prepared.baseIndex);
      setRegistration(stored[prepared.frames[prepared.baseIndex].id] ?? prepared.frames[prepared.baseIndex].initialRegistration ?? initialRegistration);
      setSceneOptions(data.scenes ?? []); setSceneKey(data.sceneKey ?? '');
      setRegistrationQuality(prepared.warning ?? data.location+'；请用投影和同名点核验实际配准。');
      setPage(openRegistration ? 'registration' : 'sources');
      const url=new URL(window.location.href); url.searchParams.set('localScene','1');
      if (data.sceneKey) url.searchParams.set('scene',data.sceneKey); else url.searchParams.delete('scene');
      window.history.replaceState(null,'',url);
      flash('已载入 '+prepared.frames.length+' 张全景与对应点云，使用本场景自己的位姿');
    } catch(error) {
      if(!controller.signal.aborted) { setPage('sources'); flash(error instanceof Error ? error.message : '场景加载失败'); }
    } finally { if (!controller.signal.aborted) setSceneLoading(false); }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('localScene') !== '1') return;
    void loadLocalScene(new URLSearchParams(window.location.search).get('scene') ?? undefined, false);
    return () => sceneAbort.current?.abort();
  }, []);

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
  useEffect(() => {
    let live=true;
    setAutoRegistrationStatus(null);
    fetch(autoRegistrationMethod==='da2'?'/api/registration/depth':'/api/registration/automatic')
      .then((response) => response.ok ? response.json() : null)
      .then((status) => { if(live)setAutoRegistrationStatus(status); })
      .catch(() => { if(live)setAutoRegistrationStatus({ configured: false, reason: '请使用本项目启动脚本运行自动配准服务' }); });
    return () => { live=false; autoRegistrationAbort.current?.abort(); };
  }, [autoRegistrationMethod]);
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
      if (page !== 'workspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      if((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault();undoEdit(event.shiftKey || event.key.toLowerCase()==='y');return;
      }
      if(event.altKey || event.ctrlKey || event.metaKey)return;
      if(event.key==='Enter' && draftVertices.length){event.preventDefault();finishPolygon();return;}
      if(['Backspace','Delete'].includes(event.key) && (selectedVertex!==null || draftVertices.length)) {
        event.preventDefault();deleteVertex();return;
      }
      const definition = classes.find((item) => item.shortcut === event.key);
      if (definition) setSelectedClassId(definition.id);
      if (event.key === 'Escape') {
        if(draftVertices.length){cancelDraft();return;}
        setSelectedVertex(null);setTargetExtent('object');
        setSelectedId(null);
        setFocusSelected(false);
        return;
      }
      const selectedAnnotation = annotations.find((item) => item.id === selectedId);
      if (!selectedAnnotation) return;
      if (event.key === 'Delete') {
        mutateAnnotations((previous) => previous.filter((item) => item.id !== selectedId));
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
      mutateAnnotations((previous) => previous.map((item) => item.id === selectedId
        ? { ...item, pointCloud: { ...box, center, yaw },
          triangulation: item.triangulation ? { ...item.triangulation, reviewed: false } : undefined } : item));
      setDirty(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function snapshot(): EditSnapshot {
    return { annotations:annotationsRef.current, draft:draftVertices, frameIndex, selectedId,
      vertex:selectedVertex, tool, rectangle:targetRectangle,extent:targetExtent };
  }
  function clearHistory(){history.current.clear();setSelectedVertex(null);refreshHistory(v=>v+1);}
  function undoEdit(redo=false) {
    const next=redo ? history.current.redo(snapshot()) : history.current.undo(snapshot());
    if(!next)return;
    changeFrame(next.frameIndex,false);
    annotationsRef.current=next.annotations;setAnnotations(next.annotations);
    setDraftVertices(next.draft);setSelectedId(next.selectedId);setSelectedVertex(next.vertex);
    setTool(next.tool);setTargetRectangle(next.rectangle);setTargetExtent(next.extent);setDirty(true);
  }
  function editDraft(vertices:UV[]) {history.current.record(snapshot());setDraftVertices(vertices);setSelectedVertex(null);}
  function cancelDraft(){if(draftVertices.length)editDraft([]);}

  function chooseExtent(extent:'surface'|'object') {
    if(extent===targetExtent)return;
    const observation=selected?.observations?.find(o=>o.frameId===currentFrameId);
    if(observation && !draftVertices.length) {
      updateAnnotation(selected!.id,{observations:selected!.observations!.map(o=>o.frameId===currentFrameId?{...o,extent}:o)});
      flash(extent==='object'?'请检查本帧轮廓是否包含正面和侧面，并逐帧统一范围；旧候选已清除':'本帧按单个表面处理，不推断完整墙体厚度');
    } else history.current.record(snapshot());
    setTargetExtent(extent);
  }
  function selectContourObject(id:string|null) {
    cancelDraft();setSelectedVertex(null);setSelectedId(id);
    const item=annotations.find(a=>a.id===id),observation=item?.observations?.find(o=>o.frameId===currentFrameId)??item?.observations?.[0];
    setTargetExtent(observation?(observation.extent??'surface'):'object');
  }

  function editVertices(vertices:UV[],draft:boolean) {
    if(draft){history.current.record(snapshot());setDraftVertices(vertices);return;}
    if(!selected)return;
    try {
      contourPlane(vertices);
      if(selected.observations?.some(o=>o.frameId===currentFrameId))
        mutateAnnotations(items=>items.map(item=>item.id===selected.id?replaceObservation(item,currentFrameId,vertices):item));
      else updateAnnotation(selected.id,{panorama:{kind:'polygon',vertices}});
      if(selected.triangulation)flash('轮廓已更新；旧 3D 候选已清除，请重新多帧定位并核验');
    } catch(error){flash(error instanceof Error?error.message:'轮廓无效');}
  }
  function deleteVertex() {
    const vertices=draftVertices.length?draftVertices:currentVertices;
    const index=selectedVertex ?? (draftVertices.length?vertices.length-1:null);
    if(index===null || !vertices[index])return;
    if(!draftVertices.length && vertices.length<=3){flash('闭合轮廓至少保留 3 个顶点；如需清除，请删除当前轮廓');return;}
    editVertices(vertices.filter((_,i)=>i!==index),draftVertices.length>0);setSelectedVertex(null);
  }
  function insertVertex() {
    if(selectedVertex===null || currentVertices.length<3)return;
    const i=selectedVertex,next=(i+1)%currentVertices.length;
    const midpoint=directionToPanorama(panoramaToDirection(currentVertices[i]).add(panoramaToDirection(currentVertices[next])).normalize());
    editVertices([...currentVertices.slice(0,i+1),midpoint,...currentVertices.slice(i+1)],false);setSelectedVertex(i+1);
  }
  function deleteContour(redraw=false) {
    if(!selected)return;
    if(selected.observations?.some(o=>o.frameId===currentFrameId))
      updateAnnotation(selected.id,{observations:selected.observations.filter(o=>o.frameId!==currentFrameId)});
    else updateAnnotation(selected.id,{panorama:undefined,panoramaFrameId:undefined});
    setSelectedVertex(null);
    if(redraw)setTool(selected.observations?'target-box':'pano-polygon');
  }

  function mutateAnnotations(updater: (previous: Annotation[]) => Annotation[]) {
    history.current.record(snapshot());
    const next=updater(annotationsRef.current);annotationsRef.current=next;setAnnotations(next);
    setDirty(true);
  }

  function mutateRegistration(updater: (previous: Registration) => Registration,
    evidence: Omit<RegistrationEvidence, 'updatedAt'> = { source: 'manual' }) {
    autoRegistrationAbort.current?.abort();
    clearHistory();
    const next = updater(registration);
    setRegistration(next);
    setFrameRegistrations((previous) => ({ ...previous, [currentFrameId]: next }));
    setFrameEvidence((previous) => ({ ...previous, [currentFrameId]: { ...evidence, updatedAt: new Date().toISOString() } }));
    setAutoRegistrationCandidates((previous) => { const next = { ...previous }; delete next[currentFrameId]; return next; });
    setAnnotations((previous) => previous.map((item) => item.triangulation && item.observations?.some((observation) => observation.frameId === currentFrameId)
      ? { ...item, triangulation: { ...item.triangulation, reviewed: false, stale: true } } : item));
    setDirty(true);
  }

  function changeFrame(index: number, recordDraft=true) {
    if (index < 0 || index >= frames.length) return;
    if(recordDraft && draftVertices.length){editDraft([]);flash('未完成轮廓已放入撤销历史；可撤销回原帧继续绘制');}
    setSelectedVertex(null);
    setFrameIndex(index);
    const observation=selected?.observations?.find(o=>o.frameId===frames[index].id)??selected?.observations?.[0];
    if(observation)setTargetExtent(observation.extent??'surface');
    setRegistration(frameRegistrations[frames[index].id] ?? frames[index].initialRegistration ?? initialRegistration);
    setPendingTiePoint(null);
    setFocus(null);
    setRegistrationQuality('');
    setPreviewAutoRegistration(Boolean(autoRegistrationCandidates[frames[index].id]));
    setPairCandidates([]);
    setPairPointCandidates([]);
    setPairModelVersion('');
  }

  function addTiePoint(cloud: Vec3) {
    setPendingTiePoint(cloud);
    flash('已选点云同名点；请在右侧当前全景点击对应位置');
  }

  function solveCurrentFrame() {
    try {
      const pairs = tiePoints.filter((item) => item.frameId === currentFrameId);
      const result = solveTiePoints(registration, pairs);
      if (result.medianErrorDeg > 2 || result.maxErrorDeg > 5)
        throw new Error(`残差偏大（中位 ${result.medianErrorDeg.toFixed(2)}°，最大 ${result.maxErrorDeg.toFixed(2)}°），请检查同名点`);
      mutateRegistration(() => result.registration, { source: 'tie-points',
        medianErrorDeg: result.medianErrorDeg, maxErrorDeg: result.maxErrorDeg });
      setRegistrationQuality(`当前帧：${pairs.length} 对同名点；角误差中位 ${result.medianErrorDeg.toFixed(2)}°，最大 ${result.maxErrorDeg.toFixed(2)}°`);
      setShowProjection(true);
      setRegistrationStep(2); setViewLayout('overlay'); setTool('navigate');
      flash('同名点位姿已求解；请检查投影叠加后保存');
    } catch (error) { flash(error instanceof Error ? error.message : '位姿求解失败'); }
  }

  async function runAutoYaw() {
    if (!geometry || autoYawRunning) return;
    setAutoYawRunning(true);
    try {
      const estimate = await estimatePanoramaYaw(geometry, activePanoramaUrl, registration);
      if (estimate.margin < 0.03 || estimate.bestScore > estimate.currentScore * 0.98)
        throw new Error('彩色匹配优势不足，朝向结果不明确；请用同名点核验');
      mutateRegistration((previous) => ({ ...previous, rotation: [estimate.yawDeg, previous.rotation[1], previous.rotation[2]] }),
        { source: 'color-yaw', colorMargin: estimate.margin });
      setRegistrationQuality(`彩色点云朝向候选 ${estimate.yawDeg.toFixed(1)}°；颜色误差 ${estimate.bestScore.toFixed(4)}；相对次优方向优势 ${(estimate.margin * 100).toFixed(1)}%。仍须核验位置和外参。`);
      setShowProjection(true);
      flash('已应用自动朝向候选；请检查建筑边缘和同名点');
    } catch (error) { flash(error instanceof Error ? error.message : '自动朝向估计失败'); }
    finally { setAutoYawRunning(false); }
  }

  async function runAutoRegistration(allFrames: boolean) {
    if(autoRegistrationRunning)return;
    if(!geometry){flash('点云加载完成后再运行自动配准');return;}
    const controller = new AbortController();
    autoRegistrationAbort.current = controller;
    setAutoRegistrationRunning(true);
    const targets = allFrames ? frames : [currentFrame];
    const failures: string[] = [];
    let succeeded = 0;
    try {
      const statusResponse = await fetch(autoRegistrationMethod==='da2'?'/api/registration/depth':'/api/registration/automatic', { signal: controller.signal });
      const status = await statusResponse.json() as { configured: boolean; reason?: string; label?: string };
      setAutoRegistrationStatus(status);
      if (!status.configured) throw new Error(status.reason ?? '自动配准环境尚未配置');
      for (let index = 0; index < targets.length; index++) {
        const frame = targets[index];
        const prior = frame.id === currentFrameId ? registration : frameRegistrations[frame.id] ?? frame.initialRegistration;
        if (!prior || (!task.isDemo && !frameRegistrations[frame.id] && !frame.initialRegistration)) {
          failures.push(`${frame.name}：缺少粗位姿`); continue;
        }
        setAutoRegistrationProgress(`${index + 1}/${targets.length} · ${frame.name}`);
        setAutoRegistrationCandidates((previous) => { const next={...previous};delete next[frame.id];return next; });
        try {
          let candidate:AutoRegistrationCandidate;
          if(autoRegistrationMethod==='da2') {
            const result=await runDepthRegistration(geometry,frame.url,frame.id,prior,controller.signal);
            if(controller.signal.aborted||autoRegistrationAbort.current!==controller)break;
            setDepthResults(previous=>({...previous,[frame.id]:result}));
            candidate=validateDepthCandidate(result,prior);
          } else candidate = await runAutomaticRegistration(geometry, frame.url, frame.id, prior, controller.signal);
          if (controller.signal.aborted || autoRegistrationAbort.current !== controller) break;
          setAutoRegistrationCandidates((previous) => ({ ...previous, [frame.id]: candidate }));
          if (frame.id === currentFrameId) { setPreviewAutoRegistration(true); setShowProjection(true); }
          succeeded++;
        } catch (error) {
          if (controller.signal.aborted) break;
          failures.push(`${frame.name}：${error instanceof Error ? error.message : '推理失败'}`);
        }
      }
      if (controller.signal.aborted) return;
      setRegistrationQuality(`自动精配准完成 ${succeeded}/${targets.length} 帧候选。${failures.length ? `待处理：${failures.slice(0, 3).join('；')}` : '请检查投影，再应用候选位姿。'}`);
      flash(`自动配准生成 ${succeeded} 帧候选；${failures.length} 帧待处理`);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '自动配准失败';
        setRegistrationQuality(message); flash(message);
      }
    } finally {
      if (autoRegistrationAbort.current === controller) {
        autoRegistrationAbort.current = null;
        setAutoRegistrationRunning(false);
        setAutoRegistrationProgress('');
      }
    }
  }

  function acceptAutoRegistration(allFrames: boolean) {
    const entries = Object.entries(autoRegistrationCandidates).filter(([id, candidate]) => {
      const prior = id === currentFrameId ? registration : frameRegistrations[id] ?? frames.find(frame => frame.id === id)?.initialRegistration;
      return (allFrames || id === currentFrameId) && JSON.stringify(prior) === JSON.stringify(candidate.prior);
    });
    if (!entries.length) { flash('候选初值已改变，请重新运行自动精配准'); return; }
    clearHistory();
    const changed = new Set(entries.map(([id]) => id));
    setFrameRegistrations((previous) => ({ ...previous,
      ...Object.fromEntries(entries.map(([id, candidate]) => [id, candidate.registration])) }));
    setFrameEvidence((previous) => ({ ...previous,
      ...Object.fromEntries(entries.map(([id, candidate]) => [id, { source: candidate.method==='da2' ? 'auto-depth' as const : 'auto-nid' as const,
        updatedAt: new Date().toISOString(), algorithmVersion: candidate.algorithmVersion, signal: candidate.signal,
        optimizationMetrics: { ...candidate.metrics } }])) }));
    const current = autoRegistrationCandidates[currentFrameId];
    if (current && changed.has(currentFrameId)) setRegistration(current.registration);
    setAnnotations((previous) => previous.map((item) => item.triangulation && item.observations?.some((observation) => changed.has(observation.frameId))
      ? { ...item, triangulation: { ...item.triangulation, reviewed: false, stale: true } } : item));
    setAutoRegistrationCandidates((previous) => { const next = { ...previous }; for (const [id] of entries) delete next[id]; return next; });
    setPreviewAutoRegistration(false);
    setShowProjection(true);
    setDirty(true);
    setRegistrationQuality(`已应用 ${entries.length} 帧 无权重自动配准 候选位姿；请核验建筑边缘与标志位置。`);
    flash(`已应用 ${entries.length} 帧自动配准位姿`);
  }

  async function locateSelectedTarget() {
    if (!selected) { flash('请先选择一个已在多帧框定的对象'); return; }
    if(draftVertices.length || locatingTarget)return;
    setLocatingTarget(true);
    await new Promise(resolve=>setTimeout(resolve,20));
    if(annotationsRef.current.find(item=>item.id===selected.id)!==selected || poseStateRef.current!==frameRegistrations){
      setLocatingTarget(false);return;
    }
    try {
      const result = triangulateTarget(selected.observations ?? [], frameRegistrations, geometry);
      if (!('method' in result) && (!Number.isFinite(result.nearestCloudPointM) || result.nearestCloudPointM > 2))
        throw new Error(`计算位置与最近点云相距 ${formatNumber(result.nearestCloudPointM)} m，请核查位姿和目标对应`);
      updateAnnotation(selected.id, { pointCloud: result.cuboid,
        triangulation: { baselineM: result.baselineM, maxRayAngleDeg: result.maxRayAngleDeg,
          medianRayMissM: result.medianRayMissM, nearestCloudPointM: result.nearestCloudPointM, reviewed: false, stale: false,
          ...("method" in result ? {method:result.method,supportPointCount:result.supportPointCount,extent:result.extent}: {}) } });
      setRegistrationQuality(`${'supportPointCount' in result ? '轮廓交集支持 '+result.supportPointCount+' 点；' : ''}目标 ${selected.id}：基线 ${result.baselineM.toFixed(2)} m；视差 ${result.maxRayAngleDeg.toFixed(2)}°；射线偏差 ${result.medianRayMissM.toFixed(2)} m；距点云 ${result.nearestCloudPointM.toFixed(2)} m`);
      flash('extent' in result && result.extent==='object'?'已生成体积候选；请核验侧面覆盖和深度 D，必要时用尺寸手柄修正':'已生成表面范围候选；单面点云不能确认整面墙的厚度');
    } catch (error) { flash(error instanceof Error ? error.message : '目标定位失败'); }
    finally {setLocatingTarget(false);}
  }

  function save() {
    try {
      localStorage.setItem(`atlas-labels-${task.id}`, JSON.stringify(annotations));
      localStorage.setItem(`atlas-reg-${task.id}`, JSON.stringify(registration));
      localStorage.setItem(`atlas-frame-reg-${task.id}`, JSON.stringify(frameRegistrations));
      localStorage.setItem(`atlas-frame-evidence-${task.id}`, JSON.stringify(frameEvidence));
      localStorage.setItem(`atlas-ties-${task.id}`, JSON.stringify(tiePoints));
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
      if (selectedPairModel.adapter === 'qwen-vl-v1' || selectedPairModel.adapter === 'deepseek-vision-v1') {
        const panoramaResponse = await fetch(activePanoramaUrl, { signal: controller.signal });
        if (!panoramaResponse.ok) throw new Error('当前全景影像无法读取');
        const output = await runVisionLlm(selectedPairModel, await panoramaResponse.blob(), classes, 'panorama', controller.signal);
        if (controller.signal.aborted) return;
        setPairCandidates(output.boxes.map((box) => {
          const left = box.x - box.w / 2, right = box.x + box.w / 2;
          const top = box.y - box.h / 2, bottom = box.y + box.h / 2;
          return { id: `candidate:${crypto.randomUUID()}`, classId: box.classId,
            name: classes.find((entry) => entry.id === box.classId)?.name ?? box.classId,
            visible: true, origin: 'prediction' as const, modelId: selectedPairModel.id,
            modelVersion: output.modelVersion,
            panorama: { kind: 'polygon' as const, vertices: [[left, top], [right, top], [right, bottom], [left, bottom]] as [number, number][] } };
        }));
        setPairPointCandidates([]);
        setPairModelVersion(output.modelVersion ?? selectedPairModel.name);
        flash(`收到 ${output.boxes.length} 个全景区域候选；请在影像中审核。LLM 不生成点云 3D 框。`);
        return;
      }
      const [cloudResponse, panoramaResponse] = await Promise.all([
        fetch(task.pointCloudUrl, { signal: controller.signal }),
        fetch(activePanoramaUrl, { signal: controller.signal }),
      ]);
      if (!cloudResponse.ok || !panoramaResponse.ok) throw new Error('当前配对文件无法读取');
      const [cloudBlob, panoramaBlob] = await Promise.all([cloudResponse.blob(), panoramaResponse.blob()]);
      const cloudAssetId = await uploadPrelabelAsset(selectedPairModel.endpoint,
        new File([cloudBlob], task.pointCloudName), 'pointCloud', controller.signal);
      const panoramaAssetId = await uploadPrelabelAsset(selectedPairModel.endpoint,
        new File([panoramaBlob], activePanoramaName), 'panorama', controller.signal);
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
    mutateAnnotations((previous) => [...previous, { ...candidate, id: generateId(previous),
      panoramaFrameId: candidate.panorama ? currentFrameId : undefined }]);
    setPairCandidates((previous) => previous.filter((item) => item.id !== id));
  }

  function acceptAllPairCandidates() {
    if (!pairCandidates.length) return;
    mutateAnnotations((previous) => {
      const next = [...previous];
      for (const candidate of pairCandidates) next.push({ ...candidate, id: generateId(next),
        panoramaFrameId: candidate.panorama ? currentFrameId : undefined });
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
    clearHistory();setTargetExtent('object');
    setSceneKey('');
    autoRegistrationAbort.current?.abort();
    setAutoRegistrationCandidates({});
    setDepthResults({});
    setPreviewAutoRegistration(false);
    setActiveTaskId(next.id);
    setAnnotations(loadSaved(`atlas-labels-${next.id}`, []));
    setSemanticLabels(loadSaved(`atlas-points-${next.id}`, {}));
    setPaintHistory([]);
    const stored = loadSaved<Record<string, Registration>>(`atlas-frame-reg-${next.id}`, {});
    setFrameRegistrations(stored);
    setFrameEvidence(loadSaved(`atlas-frame-evidence-${next.id}`, {}));
    setTiePoints(loadSaved(`atlas-ties-${next.id}`, []));
    setFrameIndex(0);
    setRegistration(stored[next.frames?.[0]?.id ?? next.id] ?? next.frames?.[0]?.initialRegistration ?? loadSaved(`atlas-reg-${next.id}`, initialRegistration));
    setPendingTiePoint(null);
    setRegistrationQuality('');
    setSelectedId(null);
    setFocusSelected(false);
    setTool('navigate');
    setDraftVertices([]);
    setDirty(false);
    setPage('registration');
  }

  function updateAnnotation(id: string, update: Partial<Annotation>) {
    mutateAnnotations((previous) => previous.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...update };
      if (update.observations && item.triangulation) {
        next.pointCloud = undefined;
        next.triangulation = undefined;
      }
      if (update.pointCloud && !update.triangulation && item.triangulation)
        next.triangulation = { ...item.triangulation, reviewed: false };
      return next;
    }));
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
    selectContourObject(id);
    if (!id) { setFocusSelected(false); return; }
    setSelectedTab('attributes');
    const box = annotations.find((item) => item.id === id)?.pointCloud;
    if (box) setFocus({ uv: pointToPanorama(box.center, registration), serial: Date.now() });
  }

  function addPanoramaShape(panorama: Annotation['panorama']) {
    if (!panorama) return;
    const target = chooseTarget();
    if (target.existing && !target.existing.panorama && !target.existing.observations?.length) {
      updateAnnotation(target.id, { panorama, panoramaFrameId: currentFrameId });
      flash(`${target.id} 已关联全景标注`);
    } else {
      const id = target.existing ? generateId(annotations) : target.id;
      mutateAnnotations((previous) => [...previous, {
        id, classId: selectedClassId, name: `${classes.find((item) => item.id === selectedClassId)?.name ?? '对象'} ${previous.length + 1}`,
        origin: 'manual', visible: true, panorama, panoramaFrameId: currentFrameId,
      }]);
      setSelectedId(id);
      flash('全景标注已创建；选择该对象后可在点云中关联 3D 框');
    }
  }

  function onPanoramaPick(uv: UV) {
    if (tool === 'tie-point') {
      if (!pendingTiePoint) { flash('请先在左侧点云选同名点'); return; }
      setTiePoints((previous) => [...previous, { id: crypto.randomUUID(), frameId: currentFrameId, cloud: pendingTiePoint, uv }]);
      setPendingTiePoint(null);
      setDirty(true);
      flash('同名点已配对；继续添加不同方向的对应点');
      return;
    }
    if (tool === 'pano-polygon' || tool === 'target-box') {
      if(draftVertices.length>=256){flash('最多支持 256 个轮廓顶点');return;}
      if(tool==='target-box' && targetRectangle && draftVertices.length===1) {
        const a=draftVertices[0];
        finishContour([[a[0],a[1]],[uv[0],a[1]],[uv[0],uv[1]],[a[0],uv[1]]]);
      } else editDraft([...draftVertices,uv]);
      return;
    }
    addPanoramaShape({ kind: 'point', uv });
    if (geometry) {
      const suggestion = nearestPointOnRay(geometry, registration.position, panoramaToWorldDirection(uv, registration));
      if (suggestion) flash(`全景射线附近存在点云候选点 (${suggestion.map(formatNumber).join(', ')})`);
    }
  }

  function finishContour(vertices:UV[]) {
    try {
      contourPlane(vertices);
      if(tool==='target-box') {
        const observation=makeObservation(currentFrameId,vertices,targetExtent);
        if(selected)updateAnnotation(selected.id,{observations:[...(selected.observations??[]).filter(o=>o.frameId!==currentFrameId),observation]});
        else {
          const id=generateId(annotations);
          mutateAnnotations(previous=>[...previous,{id,classId:selectedClassId,
            name:`${classes.find(item=>item.id===selectedClassId)?.name??'对象'} ${previous.length+1}`,
            origin:'manual',visible:true,observations:[observation]}]);setSelectedId(id);
        }
        flash('当前帧轮廓已保存；切换相邻帧，保持同一对象继续圈选');
      } else addPanoramaShape({kind:'polygon',vertices});
      setDraftVertices([]);setSelectedVertex(null);
    } catch(error){flash(error instanceof Error?error.message:'轮廓无效，请调整顶点');}
  }
  function finishPolygon(){finishContour(draftVertices);}

  function exportData() {
    downloadJson(`${task.id}-annotations.json`, {
      schemaVersion: '0.2', task: { id: task.id, name: task.name, pointCloudName: task.pointCloudName, panoramaName: task.panoramaName },
      coordinateSystem: task.isDemo || task.id === syntheticDemoTask.id ? 'camera-local: +X right, +Y up, -Z forward' : 'source point-cloud coordinates',
      frames: frames.map(({ id, name, utcSeconds }) => ({ id, name, utcSeconds })),
      registration, frameRegistrations, frameEvidence, tiePoints, classes, annotations,
      semanticPointLabels: Object.entries(semanticLabels).map(([pointIndex, classId]) => ({ pointIndex: Number(pointIndex), classId })),
    });
    flash('已导出 JSON 标注文件');
  }

  async function importPair() {
    autoRegistrationAbort.current?.abort();
    if (!cloudFile || !imageFiles.length) { flash('请选择点云和至少一张全景文件'); return; }
    if (cloudFile.size > 150 * 1024 * 1024) { flash('浏览器直读上限为 150 MiB；请在数据管理中使用本机大点云导入'); return; }
    if (new Set(imageFiles.map((file) => file.name.toLowerCase())).size !== imageFiles.length) { flash('全景文件名不能重复'); return; }
    const naturalImages = [...imageFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let imported: ReturnType<typeof parseCalibrationDocument> = { frames: {} };
    if (calibrationFile) {
      try {
        imported = parseCalibrationDocument(JSON.parse(await calibrationFile.text()), naturalImages.map((file) => file.name));
      } catch (error) { flash(`配准 JSON 无法解析：${error instanceof Error ? error.message : '未知格式'}`); return; }
    }
    const id = `PAIR-${Date.now().toString(36).toUpperCase()}`;
    const hasTimes = imageFiles.every((file) => imported.frames[file.name]?.utcSeconds !== undefined);
    const orderedImages = [...naturalImages].sort((a, b) => hasTimes
      ? imported.frames[a.name].utcSeconds! - imported.frames[b.name].utcSeconds!
      : a.name.localeCompare(b.name, undefined, { numeric: true }));
    const importedFrames = orderedImages.map((file, index) => ({ id: `${id}-F${index + 1}`, name: file.name,
      url: URL.createObjectURL(file), utcSeconds: imported.frames[file.name]?.utcSeconds,
      initialRegistration: imported.frames[file.name]?.registration }));
    const initialPoses = Object.fromEntries(importedFrames.filter((frame) => frame.initialRegistration)
      .map((frame) => [frame.id, frame.initialRegistration!])) as Record<string, Registration>;
    const next: PairTask = {
      id, name: newTaskName.trim() || `${cloudFile.name} × ${orderedImages.length} 张全景`,
      location: '本地导入 / 当前浏览器会话', pointCloudName: cloudFile.name, panoramaName: importedFrames[0].name,
      pointCloudUrl: URL.createObjectURL(cloudFile), panoramaUrl: importedFrames[0].url, frames: importedFrames,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setTasks((previous) => [...previous, next]);
    setFrameIndex(0);
    setFrameRegistrations(initialPoses);
    setFrameEvidence(Object.fromEntries(Object.keys(initialPoses).map((frameId) => [frameId,
      { source: 'imported', updatedAt: new Date().toISOString() }])));
    setRegistration(initialPoses[importedFrames[0].id] ?? initialRegistration);
    setTiePoints([]);
    setPendingTiePoint(null);
    setRegistrationQuality('');
    setAutoRegistrationCandidates({});
    setDepthResults({});
    setPreviewAutoRegistration(false);
    clearHistory();setTargetExtent('object');setDraftVertices([]);
    setAnnotations([]);
    setSemanticLabels({});
    setPaintHistory([]);
    setActiveTaskId(id);
    setSceneKey('');
    setSelectedId(null);
    setFocusSelected(false);
    setTool('navigate');
    setDirty(false);
    setPage('registration');
    flash(imported.warning ?? `已导入 ${orderedImages.length} 张全景；请在配准校验中核对各帧位姿`);
  }

  async function importPoseAfterPair(file: File) {
    autoRegistrationAbort.current?.abort();
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const imported = parseCalibrationDocument(data, Array.isArray(data.frames)
        ? frames.map((frame) => frame.name) : [currentFrame.name]);
      const next = { ...frameRegistrations };
      for (const frame of frames) if (imported.frames[frame.name]) next[frame.id] = imported.frames[frame.name].registration;
      setFrameRegistrations(next);
      setAutoRegistrationCandidates({});
    setDepthResults({});
      setPreviewAutoRegistration(false);
      clearHistory();
      const changedFrameIds = new Set(frames.filter((frame) => imported.frames[frame.name]).map((frame) => frame.id));
      setAnnotations((previous) => previous.map((item) => item.triangulation &&
        item.observations?.some((observation) => changedFrameIds.has(observation.frameId))
        ? { ...item, triangulation: { ...item.triangulation, reviewed: false, stale: true } } : item));
      setFrameEvidence((previous) => ({ ...previous, ...Object.fromEntries(frames.filter((frame) => imported.frames[frame.name])
        .map((frame) => [frame.id, { source: 'imported', updatedAt: new Date().toISOString() }])) }));
      setTasks((previous) => previous.map((item) => item.id !== task.id || !item.frames ? item : {
        ...item, frames: item.frames.map((frame) => ({ ...frame,
          utcSeconds: imported.frames[frame.name]?.utcSeconds ?? frame.utcSeconds })) }));
      if (next[currentFrameId]) setRegistration(next[currentFrameId]);
      setDirty(true);
    flash(imported.warning ?? `已导入 ${Object.keys(imported.frames).length} 帧位姿；请检查投影叠加`);
    } catch (error) { flash(`位姿导入失败：${error instanceof Error ? error.message : '未知格式'}`); }
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

  function navigate(target: Page) {
    if (dirty && (page === 'workspace' || page === 'registration')) save();
    if (target === 'registration') { chooseRegistrationStep(0); return; }
    if (target === 'workspace' || target === 'review') {
      setAnnotationMode(target === 'review' ? 'image' : 'paired');
      cancelDraft();setSelectedVertex(null);setTool('navigate'); setPendingTiePoint(null);
      chooseLayout('split'); setPreviewAutoRegistration(false);
    }
    setPage(target === 'tasks' ? 'sources' : target);
  }

  const filteredAnnotations = useMemo(() => annotations.filter((item) =>
    `${item.name} ${item.id} ${classes.find((definition) => definition.id === item.classId)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  ), [annotations, classes, search]);

  const inspector = (
    <aside className={`inspector ${sideOpen ? '' : 'is-collapsed'}`}>
      {sideOpen ? <>
        <div className="inspector-title"><div><strong>{page === 'registration' ? '配准校验' : '标注对象'}</strong><span>{page === 'registration' ? '同步采样 · INS 粗配准' : `${annotations.length} 个对象`}</span></div><button className="icon-button" onClick={() => setSideOpen(false)} title="收起面板"><PanelRightClose size={18} /></button></div>
        {page === 'registration' ? <RegistrationInspector registration={registration} onChange={mutateRegistration} onReset={() => mutateRegistration(() => currentFrame.initialRegistration ?? initialRegistration, { source: initialPoseSource })} showProjection={showProjection} setShowProjection={setShowProjection} isDemo={isInsApproximate} /> : <>
          <div className="inspector-tabs"><button className={selectedTab === 'objects' ? 'active' : ''} onClick={() => setSelectedTab('objects')}>对象列表</button><button className={selectedTab === 'attributes' ? 'active' : ''} onClick={() => setSelectedTab('attributes')}>属性详情</button></div>
          {selectedTab === 'objects' ? <>
            <div className="inspector-section"><div className="section-heading"><span>标注类别</span><span className="subtle">快捷键 1–9</span></div><div className="class-list">{classes.map((definition) => <button key={definition.id} className={`class-chip ${selectedClassId === definition.id ? 'selected' : ''}`} onClick={() => setSelectedClassId(definition.id)}><span className="class-dot" style={{ background: definition.color }} />{definition.name}<kbd>{definition.shortcut}</kbd></button>)}</div></div>
            <div className="object-section"><div className="section-heading"><span>对象列表</span><span className="subtle">{annotations.length} 个</span></div><div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索对象或 ID" /></div><div className="object-list">{filteredAnnotations.length ? filteredAnnotations.map((item) => <button key={item.id} className={`object-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => { selectContourObject(item.id); setSelectedTab('attributes'); if (item.pointCloud) setFocus({ uv: pointToPanorama(item.pointCloud.center, registration), serial: Date.now() }); }}><span className="object-icon" style={{ color: classes.find((c) => c.id === item.classId)?.color }}><Box size={17} /></span><span className="object-copy"><strong>{item.name}</strong><small>{item.id} · {item.pointCloud ? '3D' : '—'} / {item.observations?.length ? `全景 ${item.observations.length} 帧` : item.panorama ? '全景' : '—'}</small></span><ChevronRight size={15} /></button>) : <div className="empty-objects"><Focus size={26} /><strong>尚无标注对象</strong><span>选类别后在点云或全景视图中创建</span></div>}</div></div>
          </> : selected ? <div className="attributes-panel"><div className="selected-object-heading"><span className="class-dot" style={{ background: classes.find((c) => c.id === selected.classId)?.color }} /><div><strong>{selected.id}</strong><small>同一对象 ID 关联双视图</small></div></div><label className="field-label">对象名称<input value={selected.name} onChange={(event) => updateAnnotation(selected.id, { name: event.target.value })} /></label><label className="field-label">类别<select value={selected.classId} onChange={(event) => updateAnnotation(selected.id, { classId: event.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="modality-status"><div><span className={selected.pointCloud ? 'status-icon good' : 'status-icon'}>{selected.pointCloud ? <Check size={13} /> : <Plus size={13} />}</span><span>点云 3D 框</span><strong>{selected.pointCloud ? '已标注' : '待标注'}</strong></div><div><span className={(selected.panorama || selected.observations?.length) ? 'status-icon good' : 'status-icon'}>{(selected.panorama || selected.observations?.length) ? <Check size={13} /> : <Plus size={13} />}</span><span>全景影像</span><strong>{(selected.panorama || selected.observations?.length) ? '已标注' : '待标注'}</strong></div></div>{selected.pointCloud && <div className="dimension-block"><div className="section-heading">3D 框中心 <span className="subtle">米</span></div><div className="triple-input">{selected.pointCloud.center.map((value, index) => <label key={index}>{['X', 'Y', 'Z'][index]}<input type="number" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => { const center = [...selected.pointCloud!.center] as Vec3; center[index] = Number(event.target.value); updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, center } }); }} /></label>)}</div><div className="section-heading">框尺寸 <span className="subtle">宽 / 高 / 深</span></div><div className="triple-input">{selected.pointCloud.size.map((value, index) => <label key={index}>{['W', 'H', 'D'][index]}<input type="number" min="0.1" step="0.1" value={Number(value.toFixed(3))} onChange={(event) => { const size = [...selected.pointCloud!.size] as Vec3; size[index] = Math.max(0.1, Number(event.target.value)); updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, size } }); }} /></label>)}</div><label className="field-label">水平旋转 Yaw（°）<input type="number" step="5" value={selected.pointCloud.yaw ?? 0} onChange={(event) => updateAnnotation(selected.id, { pointCloud: { ...selected.pointCloud!, yaw: Number(event.target.value) } })} /></label><p className="box-edit-hint">方向键平移 · PageUp/Down 升降 · Q/E 旋转 · Delete 删除</p></div>}<p className="inspector-tip"><Link2 size={15} />选择这个对象，再到另一视图绘制，即可共享 {selected.id}。</p><div className="object-actions"><button onClick={() => updateAnnotation(selected.id, { visible: !selected.visible })}>{selected.visible ? <EyeOff size={15} /> : <Eye size={15} />}{selected.visible ? '隐藏' : '显示'}</button><button className="danger" onClick={() => { mutateAnnotations((previous) => previous.filter((item) => item.id !== selected.id)); setSelectedId(null); setSelectedTab('objects'); }}><Trash2 size={15} />删除</button></div></div> : <div className="empty-attributes"><Target size={30} /><strong>选择一个标注对象</strong><span>在此编辑名称、类别与 3D 框尺寸</span></div>}
        </>}
      </> : <button className="reopen-side" onClick={() => setSideOpen(true)} title="展开对象面板"><PanelRightClose size={20} /></button>}
    </aside>
  );

  const section = workflowPage(page);
  const sectionLabel = {sources:'数据管理',registration:'配准',workspace:'标注',training:'训练与导出',settings:'项目设置'}[section];
  const imageReviewProps = { models:modelProfiles, selectedModelId:selectedModels.image2d,
    onSelectModel:(id:string)=>setSelectedModels(previous=>({...previous,image2d:id})),
    onOpenSettings:()=>navigate('models'), session:reviewSession, onSessionChange:setReviewSession,
    onData:()=>{setDataKind('image');navigate('sources');}, onAnnotate:()=>navigate('review') };
  return <div className="app-shell workflow-app">
    <WorkflowSidebar page={page} onNavigate={target=>navigate(target==='workspace'&&annotationMode==='image'?'review':target)}/>
    <div className="main-shell">
      <header className="workflow-topbar"><div>城市空间要素标注<ChevronRight size={14}/><strong>{sectionLabel}</strong></div><span><i/>本地工作区</span></header>
      {(page==='workspace'||page==='review')&&<AnnotationTabs page={page} onNavigate={navigate}/>}
      {(page==='workspace'||page==='registration') ? <>
        <div className="task-header"><div className="task-header-main"><button className="back-button" onClick={() => navigate('sources')} title="返回数据管理"><ArrowLeft size={18} /></button><div><div className="eyebrow">{page === 'registration' ? '02 / REGISTER' : '03 / ANNOTATE'}</div><h1>{task.name}</h1><div className="task-meta"><span><MapPin size={14} />{task.location}</span><span className="meta-divider" /><span><CheckCircle2 size={14} />双模态配对</span><span className="meta-divider" /><span>{annotations.length} 个标注对象</span></div></div></div><div className="task-header-actions"><button className="button button-light" onClick={exportData}><ArrowDownToLine size={16} />导出结果</button><button className="button button-primary" onClick={save}><Save size={16} />{dirty ? '保存更改' : '已保存'}</button></div></div>
        <div className={'work-area '+(page==='registration'?'registration-focus':'annotation-focus')}><main className="workspace">
          {page !== 'registration' && <><div className="workspace-tools"><div className="tool-group">{TOOLS.filter(item => item.mode !== 'tie-point').map(({ mode, label, icon: Icon, hint }) => <button key={mode} className={`tool-button ${tool === mode ? 'active' : ''}`} title={hint} onClick={() => { cancelDraft();setSelectedVertex(null);setPendingTiePoint(null);setTool(mode); if (mode === 'cloud-paint') setSelectedTab('objects'); }}><Icon size={17} />{label}</button>)}</div></div><div className="instruction-strip"><span className="instruction-symbol"><CircleHelp size={16} /></span><span>{tool==='target-box' && targetRectangle ? '点击目标的两个对角生成矩形，完成后可拖动四角修正' : tool==='target-box' ? targetExtent==='object' ? '沿完整物体外轮廓圈选，包含正面和侧面；换到能看到侧面的邻帧继续。背面缺失时需人工核验厚度' : '仅圈单个可见表面，不能据此确定整面墙的厚度；需要体积时切换为完整物体轮廓' : TOOLS.find((item) => item.mode === tool)?.hint}。选择右侧已有对象后在另一视图绘制，可关联同一个对象 ID。</span></div>
          </>}
          {page !== 'registration' && <details className="model-drawer"><summary>AI 辅助标注</summary><PairModelBar models={modelProfiles} selectedModelId={selectedPairModel?.id ?? ""} onSelectModel={(id) => setSelectedModels((previous) => ({ ...previous, paired3d: id }))} onOpenSettings={() => navigate('models')} onRun={() => void runPairModel()} onCancel={() => pairAbort.current?.abort()} running={pairRunning} ready={Boolean(geometry)} candidates={pairCandidates} pointCandidateCount={pairPointCandidates.length} modelVersion={pairModelVersion} classes={classes} onFocus={(candidate) => { if (candidate.panorama?.kind === "point") setFocus({ uv: candidate.panorama.uv, serial: Date.now() }); else if (candidate.panorama?.kind === "polygon") setFocus({ uv: candidate.panorama.vertices[0], serial: Date.now() }); else if (candidate.pointCloud) setFocus({ uv: pointToPanorama(candidate.pointCloud.center, registration), serial: Date.now() }); }} onAccept={acceptPairCandidate} onReject={(id) => setPairCandidates((previous) => previous.filter((item) => item.id !== id))} onAcceptAll={acceptAllPairCandidates} onRejectAll={() => setPairCandidates([])} onAcceptPoints={acceptPairPoints} onRejectPoints={() => setPairPointCandidates([])} /></details>}
{page !== 'registration' && (tool==='target-box' || tool==='pano-polygon' || currentVertices.length>0) && <ContourTools extent={targetExtent} onExtent={chooseExtent} target={tool==='target-box'} rectangle={targetRectangle} onRectangle={value=>{cancelDraft();setTargetRectangle(value);}} draft={draftVertices.length} vertices={currentVertices.length} selectedVertex={selectedVertex} canUndo={history.current.undoStack.length>0} canRedo={history.current.redoStack.length>0} onUndo={()=>undoEdit()} onRedo={()=>undoEdit(true)} onFinish={finishPolygon} onCancel={cancelDraft} onDeleteVertex={deleteVertex} onInsert={insertVertex} onRedraw={()=>deleteContour(true)} onDeleteContour={()=>deleteContour()}/>}
                    {page==='registration' ? <RegistrationWorkflow sceneKey={sceneKey} sceneLoading={sceneLoading} coverageLabel={task.coverageLabel} onSceneChange={(key) => { if (dirty) save(); void loadLocalScene(key); }} step={registrationStep} onStep={chooseRegistrationStep} layout={viewLayout} onLayout={chooseLayout} linked={viewLinked && hasFramePose} onLinked={() => setViewLinked((value) => !value)} labeling={false} onLabel={() => { setPage('workspace'); setTool('navigate'); setSideOpen(true); chooseLayout('split'); }} hasPose={hasFramePose} parameters={<RegistrationInspector registration={registration} onChange={mutateRegistration} onReset={() => mutateRegistration(() => currentFrame.initialRegistration ?? initialRegistration, { source: initialPoseSource })} showProjection={showProjection} setShowProjection={setShowProjection} isDemo={isInsApproximate} />} frames={frames} frameIndex={frameIndex} tiePoints={tiePoints} pendingTiePoint={pendingTiePoint} pendingBoxCorner={null} selected={selected} quality={registrationQuality} evidence={frameEvidence[currentFrameId] ?? (task.isDemo ? { source: 'ins-approximate', updatedAt: '' } : undefined)} onFrameChange={changeFrame} onSolve={solveCurrentFrame} onAutoYaw={() => void runAutoYaw()} autoYawReady={hasUsableRgb(geometry)} autoYawRunning={autoYawRunning} automaticStatus={autoRegistrationStatus} automaticMethod={autoRegistrationMethod} onAutomaticMethod={(method) => { setAutoRegistrationMethod(method); setPreviewAutoRegistration(false); }} depthResult={depthResults[currentFrameId]} automaticRunning={autoRegistrationRunning} automaticProgress={autoRegistrationProgress} automaticCandidate={autoRegistrationCandidates[currentFrameId]} automaticCandidateCount={Object.keys(autoRegistrationCandidates).length} automaticPreview={previewAutoRegistration} onAutomaticRun={(all) => void runAutoRegistration(all)} onAutomaticCancel={() => autoRegistrationAbort.current?.abort()} onAutomaticAccept={acceptAutoRegistration} onAutomaticReject={() => { setAutoRegistrationCandidates((previous) => { const next = { ...previous }; delete next[currentFrameId]; return next; }); setPreviewAutoRegistration(false); }} onAutomaticPreview={() => { setPreviewAutoRegistration((previous) => !previous); setShowProjection(true); }} onLocate={locateSelectedTarget} onImportPose={(file) => void importPoseAfterPair(file)} onRemoveTie={(id) => { setTiePoints((previous) => previous.filter((item) => item.id !== id)); setDirty(true); }} onClearTies={() => { setTiePoints((previous) => previous.filter((item) => item.frameId !== currentFrameId)); setDirty(true); }} onReview={() => { if (selected?.triangulation) updateAnnotation(selected.id, { triangulation: { ...selected.triangulation, reviewed: true } }); }} /> : <FrameNavigator frames={frames} index={frameIndex} onFrame={changeFrame} linked={viewLinked&&hasFramePose} hasPose={hasFramePose} onLinked={()=>setViewLinked(value=>!value)} selected={selected} pending={draftVertices.length>0} working={locatingTarget} onLocate={locateSelectedTarget} onReview={()=>{if(selected?.triangulation)updateAnnotation(selected.id,{triangulation:{...selected.triangulation,reviewed:true}});}}/>}
          <div className={"split-view " + (viewLayout === "overlay" ? "is-overlay" : expandedCloud ? "is-expanded-cloud" : "")}><section className="viewport-card"><div className="viewport-head"><div className="viewport-heading"><span className="view-icon cloud"><Box size={18} /></span><div><strong>三维点云</strong><small>POINT CLOUD · PCD</small></div></div><div className="viewport-head-right"><span className="view-count">{geometry?.getAttribute('position')?.count.toLocaleString() ?? '—'} 点</span><button className="icon-button" aria-label={expandedCloud ? '还原双视图' : '放大点云窗口'} title={expandedCloud ? '还原双视图' : '放大点云窗口'} onClick={()=>setExpandedCloud(value=>!value)}><Maximize2 size={16}/></button></div></div><div className="viewport-body"><PointCloudView pointDisplayRanges={task.pointDisplayRanges} viewSync={viewSync} linked={viewLinked && hasFramePose} tiePoints={currentTies} pendingTiePoint={pendingTiePoint} geometry={geometry} annotations={annotations} previewAnnotations={pairCandidates} classes={classes} semanticLabels={semanticLabels} previewSemanticLabels={pairPreviewPointLabels} selectedId={selectedId} registration={displayedRegistration} tool={tool} focusSelected={focusSelected} onToggleFocus={() => setFocusSelected((value) => !value)} onCreate={onPointCloudPick} onUpdate={(id, box) => updateAnnotation(id, { pointCloud: box })} onPaint={paintPoints} onUndoPaint={undoPaint} canUndoPaint={paintHistory.length > 0} onSelect={onPointCloudSelect} onEmptySelection={() => flash("选区没有找到足够的点；请扩大范围或切换俯视视角")} onTiePointPick={addTiePoint} />{!geometry && <div className="viewer-loading">{loadError ? `加载失败：${loadError}` : '正在加载点云…'}</div>}{(sceneLoading || readyPanoramaUrl !== activePanoramaUrl) && <div className="frame-sync-mask" role="status">{panoramaError || '正在同步全景与点云视角…'}</div>}<div className="view-overlay top-left"><span className="live-dot" />{task.id === syntheticDemoTask.id ? '合成演示数据' : task.isDemo ? '真实样本 · 局部降采样' : '本地配对数据'}</div><div className="view-overlay bottom-left">{viewLinked && hasFramePose ? '拖动环视 · 滚轮同步缩放 · 当前相机位置' : '左键旋转 · 滚轮缩放 · 右键平移'}</div><div className="axis-legend"><i className="axis-x" />X <i className="axis-y" />Y <i className="axis-z" />Z</div></div><div className="viewport-foot"><span><span className="tiny-color cloud" />{task.pointCloudName}</span><span>{geometry ? '已加载' : '加载中'}</span></div></section>
          <div className="pair-bridge"><span><Link2 size={17} /></span></div>
          <section className="viewport-card"><div className="viewport-head"><div className="viewport-heading"><span className="view-icon pano"><Image size={18} /></span><div><strong>全景影像</strong><small>PANORAMA · 360°</small></div></div><div className="viewport-head-right"><span className="view-count">等距柱状投影</span><button className="icon-button" onClick={() => setFocus({ uv: [0.5, 0.5], serial: Date.now() })} title="回到正前方"><Focus size={16} /></button></div></div><div className="viewport-body"><PanoramaView canEdit={page==='workspace'} viewSync={viewSync} linked={viewLinked && hasFramePose} tiePoints={currentTies} onImageReady={(url, ready, error) => { setReadyPanoramaUrl((previous) => ready ? url : previous === url ? '' : previous); setPanoramaError(error ?? ''); }} imageUrl={activePanoramaUrl} cloudGeometry={geometry} annotations={displayAnnotations} previewAnnotations={pairCandidates} classes={classes} selectedId={selectedId} registration={displayedRegistration} tool={tool} draftVertices={draftVertices} selectedVertex={selectedVertex} onVertexSelect={setSelectedVertex} onVerticesChange={editVertices} onSelect={selectContourObject} showProjection={showProjection || viewLayout === "overlay"} focus={focus} onPick={onPanoramaPick} onFinishPolygon={finishPolygon} />{(sceneLoading || readyPanoramaUrl !== activePanoramaUrl) && <div className="frame-sync-mask" role="status">{panoramaError || '正在同步全景与点云视角…'}</div>}<div className="view-overlay top-left"><span className="live-dot cyan" />{showProjection ? '点云投影叠加 · 核验中' : '球面交互视图'}</div><div className="view-overlay bottom-left">拖拽环视 · 滚轮调整视角</div><div className="compass">N <span>·</span> 360°</div></div><div className="viewport-foot"><span><span className="tiny-color pano" />{activePanoramaName}</span><span>{readyPanoramaUrl === activePanoramaUrl ? '已配对' : '同步中'}</span></div></section></div>
        </main>{page==='workspace'&&inspector}</div>
      </> : <div className="content-page workflow-content">
        {page==='sources'&&<><DataWorkspace importOpen={importOpen} onImportOpen={setImportOpen} tasks={tasks} activeId={activeTaskId} scenes={sceneOptions} sceneKey={sceneKey} onTask={next=>{if(dirty)save();selectTask(next);}} onScene={key=>{if(dirty)save();void loadLocalScene(key);}} loading={sceneLoading} kind={dataKind} onKind={setDataKind} cloud={cloudFile} images={imageFiles} calibration={calibrationFile} name={newTaskName} onCloud={setCloudFile} onImages={setImageFiles} onCalibration={setCalibrationFile} onName={setNewTaskName} onImport={()=>void importPair()}/>{dataKind==='image'&&<ImageReview {...imageReviewProps} view="data" showImport={importOpen}/>}</>}
        {page==='review'&&<ImageReview {...imageReviewProps} view="annotate"/>}
        {page==='training'&&<TrainingWorkspace session={reviewSession} models={modelProfiles} onAnnotate={()=>navigate('review')} onExportPair={exportData} onMessage={flash}/>}
        {(page==='ontology'||page==='models')&&<div className="settings-tabs" role="group" aria-label="项目设置分类"><button className={page==='ontology'?'active':''} onClick={()=>navigate('ontology')}>标签体系</button><button className={page==='models'?'active':''} onClick={()=>navigate('models')}>模型服务</button></div>}
        {page === 'ontology' && <><PageHeading eyebrow="ONTOLOGY" title="标签体系" description="建筑组件、标志和地物共享一套类别。所有标注对象都保留稳定 ID，便于关联点云与影像结果。" /><div className="ontology-card"><div className="table-title"><strong>当前类别</strong><span>{classes.length} 类</span></div>{classes.map((definition) => <div className="ontology-row" key={definition.id}><span className="class-dot large" style={{ background: definition.color }} /><div><strong>{definition.name}</strong><small>{definition.id}</small></div><span className="ontology-hotkey">快捷键 {definition.shortcut}</span><span className="enabled-pill">已启用</span></div>)}<div className="ontology-add"><input value={newClassName} onChange={(event) => setNewClassName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addClass(); }} placeholder="新增类别名称，例如：路灯" /><button className="button button-primary" onClick={addClass}><Plus size={16} />添加类别</button></div></div></>}

        {page === 'models' && <><PageHeading eyebrow="AI PRELABELING" title="模型服务管理" description="按数据类型配置多个模型，在标注页选择并运行。模型输出先进入待审核层。" /><ModelSettings profiles={modelProfiles} selected={selectedModels} onProfilesChange={setModelProfiles} onSelectionChange={setSelectedModels} /></>}
      </div>}
    </div>
    {toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><X size={14}/></button></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function RegistrationInspector({ registration, onChange, onReset, showProjection, setShowProjection, isDemo }: { registration: Registration; onChange: (updater: (previous: Registration) => Registration) => void; onReset: () => void; showProjection: boolean; setShowProjection: (value: boolean) => void; isDemo: boolean }) {
  const adjust = (kind: 'position' | 'rotation', index: number, value: number) => onChange((previous) => {
    const next = [...previous[kind]] as Vec3;
    next[index] = value;
    return { ...previous, [kind]: next };
  });
  return <div className="registration-inspector"><div className="quality-card"><span><CheckCircle2 size={17} /></span><div><strong>{isDemo ? 'INS 位姿已载入' : '位姿参数已就绪'}</strong><p>{isDemo ? '当前为平台共轴近似，全景零方位待校验。请开启投影并参照建筑边缘微调。' : '请核对相机位置与全景朝向。'}</p></div></div><div className="registration-toggle"><div><strong>点云投影叠加</strong><small>在全景中显示稀疏投影点</small></div><button className={`switch ${showProjection ? 'on' : ''}`} onClick={() => setShowProjection(!showProjection)} aria-label="切换点云投影叠加"><span /></button></div><div className="reg-section"><div className="section-heading"><span>相机位置</span><span className="subtle">点云坐标 · 米</span></div><div className="reg-inputs">{registration.position.map((value, index) => <label key={index}><span>{['X', 'Y', 'Z'][index]}</span><input type="number" step="0.05" value={value} onChange={(event) => adjust('position', index, Number(event.target.value))} /></label>)}</div></div><div className="reg-section"><div className="section-heading"><span>相机朝向</span><span className="subtle">角度</span></div><div className="reg-inputs">{registration.rotation.map((value, index) => <label key={index}><span>{['Yaw', 'Pitch', 'Roll'][index]}</span><input type="number" step="0.1" value={value} onChange={(event) => adjust('rotation', index, Number(event.target.value))} /></label>)}</div></div><button className="reset-registration" onClick={onReset}><RotateCcw size={15} />恢复初始位姿</button><div className="formula-card"><span><AlignHorizontalJustifyCenter size={17} />球面投影约定</span><code>u = 0.5 − atan2(left, forward) / 2π<br />v = 0.5 − asin(up / distance) / π</code><p>与 TREE 的 Ladybug 投影公式一致。示例点云已转为相机局部坐标；零位姿仅为粗配准，零方位仍待核验。</p></div></div>;
}
