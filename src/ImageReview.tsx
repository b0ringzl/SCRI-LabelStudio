import { useEffect, useMemo, useRef, useState } from 'react';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp,
  FileUp, FolderOpen, RotateCcw, Search, Sparkles, Trash2, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { ROAD_CLASSES, duplicatePairs, parseYolo, serializeYolo, validateClassOrder } from './reviewData';
import type { ReviewBox, ReviewManifest, ReviewTask } from './reviewData';
import { buildDistillationManifest } from './distillation';
import { runImageModel } from './modelApi';
import type { ModelProfile } from './modelRegistry';
import './review.css';

type SourceItem = { name: string; imageUrl?: string; file?: File; labelText: string };
type Filter = 'all' | 'pending' | 'reviewed' | 'empty' | 'duplicates';
type Handle = 'nw' | 'ne' | 'sw' | 'se';
type Drag = { mode: 'create' | 'move' | 'resize'; startX: number; startY: number; box: ReviewBox; handle?: Handle };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const stem = (name: string) => name.replace(/\.[^.]+$/, '');
const storeKey = (datasetId: string) => `atlas-road-review-v1:${datasetId}`;

function point(event: React.PointerEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function dragBox(drag: Drag, x: number, y: number): ReviewBox {
  const source = drag.box;
  if (drag.mode === 'create') {
    const left = Math.min(drag.startX, x);
    const top = Math.min(drag.startY, y);
    const right = Math.max(drag.startX, x);
    const bottom = Math.max(drag.startY, y);
    return { ...source, x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top };
  }
  if (drag.mode === 'move') {
    return { ...source,
      x: clamp(source.x + x - drag.startX, source.w / 2, 1 - source.w / 2),
      y: clamp(source.y + y - drag.startY, source.h / 2, 1 - source.h / 2) };
  }
  let left = source.x - source.w / 2;
  let right = source.x + source.w / 2;
  let top = source.y - source.h / 2;
  let bottom = source.y + source.h / 2;
  if (drag.handle?.includes('w')) left = clamp(x, 0, right - 0.004);
  else right = clamp(x, left + 0.004, 1);
  if (drag.handle?.includes('n')) top = clamp(y, 0, bottom - 0.004);
  else bottom = clamp(y, top + 0.004, 1);
  return { ...source, x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top };
}

interface Props {
  models: ModelProfile[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
}

export default function ImageReview({ models, selectedModelId, onSelectModel, onOpenSettings }: Props) {
  const [datasetId, setDatasetId] = useState('');
  const [items, setItems] = useState<ReviewTask[]>([]);
  const itemsRef = useRef<ReviewTask[]>([]);
  const [activeName, setActiveName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [draft, setDraft] = useState<ReviewBox | null>(null);
  const draftRef = useRef<ReviewBox | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const undoRef = useRef<Record<string, ReviewBox[][]>>({});
  const folderInput = useRef<HTMLInputElement>(null);
  const progressInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });
  const [imageSize, setImageSize] = useState({ width: 4096, height: 2456 });
  const [zoom, setZoom] = useState(1);
  const [extraImages, setExtraImages] = useState<File[]>([]);
  const [extraLabels, setExtraLabels] = useState<File[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const [candidates, setCandidates] = useState<ReviewBox[]>([]);
  const [candidateVersion, setCandidateVersion] = useState('');
  const [runningModel, setRunningModel] = useState(false);
  const modelAbort = useRef<AbortController | null>(null);

  function loadDataset(id: string, classes: string[], sources: SourceItem[]) {
    modelAbort.current?.abort();
    setCandidates([]);
    setCandidateVersion('');
    if (!validateClassOrder(classes)) {
      setMessage(`类别顺序与项目要求不一致。需要：${ROAD_CLASSES.map((entry) => entry.id).join(', ')}`);
      return;
    }
    let previous: Record<string, { boxes?: ReviewBox[]; reviewed?: boolean }> = {};
    try { previous = JSON.parse(localStorage.getItem(storeKey(id)) ?? '{}'); } catch { /* Ignore stale cache. */ }
    let invalid = 0;
    const next = sources.sort((a, b) => a.name.localeCompare(b.name)).map((source) => {
      const parsed = parseYolo(source.labelText, source.name);
      invalid += parsed.invalidLines;
      const saved = previous[source.name];
      return {
        name: source.name, imageUrl: source.imageUrl, file: source.file,
        boxes: Array.isArray(saved?.boxes) ? saved.boxes : parsed.boxes,
        reviewed: Boolean(saved?.reviewed),
      } satisfies ReviewTask;
    });
    itemsRef.current = next;
    setItems(next);
    setDatasetId(id);
    setActiveName(next.find((item) => item.name === localStorage.getItem(`${storeKey(id)}:active`))?.name ?? next[0]?.name ?? '');
    setSelectedId(null);
    setInvalidCount(invalid);
    setMessage(invalid ? `${invalid} 行标签格式错误，已跳过；请核对原文件。` : `已载入 ${next.length} 张图片。原始目录不会被修改。`);
    undoRef.current = {};
  }

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
    folderInput.current?.setAttribute('directory', '');
    let live = true;
    fetch('/api/review-manifest').then(async (response) => {
      if (!response.ok) return;
      const manifest = await response.json() as ReviewManifest;
      if (live) loadDataset(manifest.datasetId, manifest.classes, manifest.items);
    }).catch(() => { /* Portable folder picker is still available. */ });
    return () => { live = false; };
  }, []);

  const active = items.find((item) => item.name === activeName);
  const selectedModel = models.find((model) => model.id === selectedModelId && model.modality === 'image2d');
  const selected = active?.boxes.find((box) => box.id === selectedId) ?? null;
  const duplicates = active ? duplicatePairs(active.boxes) : [];
  const duplicateIds = new Set(duplicates.flat());

  useEffect(() => {
    modelAbort.current?.abort();
    modelAbort.current = null;
    setRunningModel(false);
    setCandidates([]);
    setCandidateVersion('');
  }, [activeName, datasetId, selectedModelId]);

  useEffect(() => () => modelAbort.current?.abort(), []);

  useEffect(() => {
    if (!active) { setImageUrl(''); return; }
    if (!active.file) { setImageUrl(active.imageUrl ?? ''); return; }
    const url = URL.createObjectURL(active.file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [active?.name, active?.file, active?.imageUrl]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setCanvasSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length > 0]);

  const stats = useMemo(() => ({
    reviewed: items.filter((item) => item.reviewed).length,
    boxes: items.reduce((sum, item) => sum + item.boxes.length, 0),
    duplicates: items.filter((item) => duplicatePairs(item.boxes).length > 0).length,
  }), [items]);

  const filtered = useMemo(() => items.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'pending') return !item.reviewed;
    if (filter === 'reviewed') return item.reviewed;
    if (filter === 'empty') return item.boxes.length === 0;
    if (filter === 'duplicates') return duplicatePairs(item.boxes).length > 0;
    return true;
  }), [items, filter, search]);

  function persist(next: ReviewTask[]) {
    itemsRef.current = next;
    setItems(next);
    try {
      const payload = Object.fromEntries(next.map(({ name, boxes, reviewed }) => [name, { boxes, reviewed }]));
      localStorage.setItem(storeKey(datasetId), JSON.stringify(payload));
    } catch {
      setMessage('浏览器本地存储已满。请立即导出 YOLO ZIP 保存修改。');
    }
  }

  function mutateBoxes(nextBoxes: ReviewBox[], recordUndo = true) {
    if (!active) return;
    if (recordUndo) {
      const history = undoRef.current[active.name] ?? [];
      history.push(active.boxes);
      if (history.length > 30) history.shift();
      undoRef.current[active.name] = history;
    }
    persist(itemsRef.current.map((item) => item.name === active.name
      ? { ...item, boxes: nextBoxes, reviewed: false } : item));
  }

  function undo() {
    if (!active) return;
    const history = undoRef.current[active.name];
    const boxes = history?.pop();
    if (boxes) { mutateBoxes(boxes, false); setSelectedId(null); }
  }

  function selectTask(name: string) {
    setActiveName(name);
    setSelectedId(null);
    setDraft(null);
    setZoom(1);
    setMessage('');
    if (datasetId) localStorage.setItem(`${storeKey(datasetId)}:active`, name);
  }

  function step(direction: -1 | 1) {
    const index = itemsRef.current.findIndex((item) => item.name === activeName);
    const next = itemsRef.current[index + direction];
    if (next) selectTask(next.name);
  }

  function markReviewed() {
    if (!active) return;
    persist(itemsRef.current.map((item) => item.name === active.name ? { ...item, reviewed: true } : item));
    const index = itemsRef.current.findIndex((item) => item.name === active.name);
    const next = itemsRef.current.slice(index + 1).find((item) => !item.reviewed) ??
      itemsRef.current.slice(0, index).find((item) => !item.reviewed);
    if (next) selectTask(next.name);
    else setMessage('全部图片已确认，可以导出 YOLO 标签。');
  }

  function changeClass(classId: number) {
    setSelectedClass(classId);
    if (active && selected) mutateBoxes(active.boxes.map((box) => box.id === selected.id ? { ...box, classId } : box));
  }

  function deleteSelected() {
    if (!active || !selected) return;
    mutateBoxes(active.boxes.filter((box) => box.id !== selected.id));
    setSelectedId(null);
  }

  async function runModel() {
    if (!active || !selectedModel || runningModel) return;
    const controller = new AbortController();
    modelAbort.current = controller;
    setRunningModel(true);
    setMessage(`正在调用 ${selectedModel.name}…`);
    try {
      let image: Blob;
      if (active.file) image = active.file;
      else {
        const response = await fetch(active.imageUrl ?? '', { signal: controller.signal });
        if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`);
        image = await response.blob();
      }
      const prediction = await runImageModel(selectedModel, active.name, image, active.name, controller.signal);
      if (controller.signal.aborted) return;
      setCandidates(prediction.boxes.map((box) => ({ ...box, id: `candidate:${crypto.randomUUID()}`,
        origin: 'prediction', modelId: selectedModel.id, modelVersion: prediction.modelVersion })));
      setCandidateVersion(prediction.modelVersion ?? selectedModel.name);
      setMessage(`收到 ${prediction.boxes.length} 个候选框。逐个接受或全部接受后才进入正式标注。`);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(`模型运行失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      if (modelAbort.current === controller) { modelAbort.current = null; setRunningModel(false); }
    }
  }

  function acceptCandidate(id: string) {
    const candidate = candidates.find((box) => box.id === id);
    if (!candidate || !active) return;
    mutateBoxes([...active.boxes, candidate]);
    setCandidates((previous) => previous.filter((box) => box.id !== id));
  }

  function acceptAllCandidates() {
    if (!active || !candidates.length) return;
    mutateBoxes([...active.boxes, ...candidates]);
    setCandidates([]);
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!active || event.button !== 0) return;
    const { x, y } = point(event);
    const target = event.target as Element;
    const boxId = target.getAttribute('data-box-id');
    const handle = target.getAttribute('data-handle') as Handle | null;
    const box = active.boxes.find((entry) => entry.id === boxId);
    if (box) {
      setSelectedId(box.id);
      setSelectedClass(box.classId);
      dragRef.current = { mode: handle ? 'resize' : 'move', startX: x, startY: y, box, handle: handle ?? undefined };
      draftRef.current = box;
      setDraft(box);
    } else {
      const created: ReviewBox = { id: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
        classId: selectedClass, x, y, w: 0, h: 0, origin: 'manual' };
      setSelectedId(null);
      dragRef.current = { mode: 'create', startX: x, startY: y, box: created };
      draftRef.current = created;
      setDraft(created);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const { x, y } = point(event);
    const next = dragBox(dragRef.current, x, y);
    draftRef.current = next;
    setDraft(next);
  }

  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const result = draftRef.current;
    if (!drag || !result || !active) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.mode === 'create' && result.w >= 0.003 && result.h >= 0.003) {
      mutateBoxes([...active.boxes, result]);
      setSelectedId(result.id);
    } else if (drag.mode !== 'create' && JSON.stringify(result) !== JSON.stringify(drag.box)) {
      mutateBoxes(active.boxes.map((box) => box.id === result.id ? result : box));
    }
    dragRef.current = null;
    draftRef.current = null;
    setDraft(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return; }
      if (/^[1-7]$/.test(event.key)) changeClass(Number(event.key) - 1);
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeName, active, selectedId, selectedClass, items]);

  async function importFiles(files: File[]) {
    const scoped = files.some((file) => file.webkitRelativePath.includes('data_for_annotation/'))
      ? files.filter((file) => file.webkitRelativePath.includes('data_for_annotation/')) : files;
    const images = scoped.filter((file) => /\.(jpe?g|png)$/i.test(file.name) &&
      (!file.webkitRelativePath || file.webkitRelativePath.replaceAll('\\', '/').includes('/images/')));
    const labels = new Map(scoped.filter((file) => file.name.toLowerCase().endsWith('.txt') &&
      (!file.webkitRelativePath || file.webkitRelativePath.replaceAll('\\', '/').includes('/labels/')))
      .map((file) => [stem(file.name), file]));
    const classFile = scoped.find((file) => file.name === 'class.txt');
    if (!images.length || !labels.size) { setMessage('请选择包含 images/、labels/ 和 class.txt 的 data_for_annotation 文件夹。'); return; }
    const classes = classFile ? (await classFile.text()).trim().split(/\r?\n/) : ROAD_CLASSES.map((entry) => entry.id);
    const sources = await Promise.all(images.map(async (file) => ({
      name: file.name, file, labelText: await labels.get(stem(file.name))?.text() ?? '',
    })));
    const id = classFile?.webkitRelativePath.split('/')[0] || 'data_for_annotation';
    loadDataset(id, classes, sources);
    const missing = sources.filter((source) => !labels.has(stem(source.name))).length;
    if (missing) setMessage(`${missing} 张图片没有同名标签，将按空框任务载入。`);
  }

  function exportYolo() {
    if (!items.length) return;
    const files: Record<string, Uint8Array> = {
      'class.txt': strToU8(`${ROAD_CLASSES.map((entry) => entry.id).join('\n')}\n`),
      'review_manifest.json': strToU8(JSON.stringify({ datasetId, schemaVersion: 1,
        reviewed: Object.fromEntries(items.map((item) => [item.name, item.reviewed])),
        boxMeta: Object.fromEntries(items.map((item) => [item.name,
          item.boxes.map(({ id, origin, confidence, modelId, modelVersion }) =>
            ({ id, origin, confidence, modelId, modelVersion }))])) }, null, 2)),
    };
    items.forEach((item) => { files[`labels/${stem(item.name)}.txt`] = strToU8(serializeYolo(item.boxes)); });
    const zipped = zipSync(files, { level: 6 });
    const url = URL.createObjectURL(new Blob([new Uint8Array(zipped)], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${datasetId || 'road-furniture'}-reviewed-yolo.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`已导出 ${items.length} 份 YOLO 标签；其中 ${stats.reviewed} 张已确认。`);
  }

  function exportDistillationManifest() {
    try {
      const manifest = buildDistillationManifest(datasetId, items, models);
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${datasetId || 'road-furniture'}-distillation-v1.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`已导出 ${manifest.samples.length} 张已确认图片的训练清单；影像文件需单独提供给训练服务。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '蒸馏清单导出失败');
    }
  }

  async function importProgress(file?: File) {
    if (!file || !items.length) return;
    try {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      if (!entries['class.txt'] || !validateClassOrder(strFromU8(entries['class.txt']).trim().split(/\r?\n/))) {
        throw new Error('类别顺序不匹配');
      }
      const manifest = entries['review_manifest.json']
        ? JSON.parse(strFromU8(entries['review_manifest.json'])) as {
          datasetId?: string; reviewed?: Record<string, boolean>;
          boxMeta?: Record<string, Array<{ id: string; origin: 'prediction' | 'manual';
            confidence?: number; modelId?: string; modelVersion?: string }>>;
        } : {};
      if (manifest.datasetId && manifest.datasetId !== datasetId) throw new Error('ZIP 属于另一个数据集');
      const found = itemsRef.current.filter((item) => entries[`labels/${stem(item.name)}.txt`]).length;
      if (found !== itemsRef.current.length) throw new Error(`ZIP 中只有 ${found}/${itemsRef.current.length} 个匹配标签`);
      const next = itemsRef.current.map((item) => {
        const parsed = parseYolo(strFromU8(entries[`labels/${stem(item.name)}.txt`]), item.name);
        if (parsed.invalidLines) throw new Error(`${item.name} 中有无效标签`);
        const meta = manifest.boxMeta?.[item.name];
        const boxes = parsed.boxes.map((box, index) => {
          const entry = meta?.[index];
          return entry && typeof entry.id === 'string' && ['prediction', 'manual'].includes(entry.origin)
            ? { ...box, id: entry.id, origin: entry.origin,
              confidence: entry.confidence, modelId: entry.modelId, modelVersion: entry.modelVersion } : box;
        });
        return { ...item, boxes, reviewed: Boolean(manifest.reviewed?.[item.name]) };
      });
      undoRef.current = {};
      setSelectedId(null);
      persist(next);
      setMessage(`已从 ZIP 恢复 ${found} 张图片的标签和审核状态。`);
    } catch (error) {
      setMessage(`无法导入复核进度：${error instanceof Error ? error.message : '文件格式错误'}`);
    } finally {
      if (progressInput.current) progressInput.current.value = '';
    }
  }

  const shownBoxes = active?.boxes.map((box) => draft?.id === box.id ? draft : box) ?? [];
  if (draft && dragRef.current?.mode === 'create') shownBoxes.push(draft);
  const activeIndex = items.findIndex((item) => item.name === activeName);
  const fitWidth = Math.max(100, Math.min(canvasSize.width - 36,
    (canvasSize.height - 36) * imageSize.width / imageSize.height, imageSize.width));

  return <div className="road-review">
    <div className="review-title"><div><span className="eyebrow">ROAD FURNITURE · YOLO REVIEW</span><h1>道路设施预标注复核</h1><p>依据本次 900 张图片与七类标注规范，逐张修正重复、错误和遗漏的 2D 框。</p></div><div className="review-title-actions"><input ref={progressInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importProgress(event.target.files?.[0])} /><button className="review-import-progress" disabled={!items.length} onClick={() => progressInput.current?.click()} title="导入 ZIP 并覆盖当前本地复核状态"><FileUp size={17} />导入进度 ZIP</button><button className="review-import-progress" disabled={!stats.reviewed} onClick={exportDistillationManifest} title="仅导出已确认图片的标注和教师来源，不包含影像文件"><ArrowDownToLine size={17} />导出蒸馏清单</button><button className="review-export" disabled={!items.length} onClick={exportYolo}><ArrowDownToLine size={17} />导出 YOLO ZIP</button></div></div>
    <div className="review-summary"><span><strong>{items.length}</strong> 张图片</span><span><strong>{stats.reviewed}</strong> 已确认</span><span><strong>{stats.boxes}</strong> 个框</span><span className={stats.duplicates ? 'warning' : ''}><strong>{stats.duplicates}</strong> 张疑似重复</span><span className="review-source">{datasetId || '尚未载入数据'}</span></div>
    <div className="review-model-bar"><Sparkles size={17} /><label>辅助模型<select aria-label="道路设施辅助模型" value={selectedModel?.id ?? ''} onChange={(event) => onSelectModel(event.target.value)}><option value="">选择图片模型</option>{models.filter((model) => model.modality === 'image2d').map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><button onClick={() => void runModel()} disabled={!active || !selectedModel || runningModel || candidates.length > 0}>{runningModel ? '运行中…' : '运行当前图片'}</button>{runningModel && <button onClick={() => modelAbort.current?.abort()}>取消</button>}<button className="review-model-settings" onClick={onOpenSettings}>管理模型</button><span>点击运行后才上传当前图片；切换图片或模型会丢弃未审核候选。</span></div>
    {!items.length && <div className="review-import"><FolderOpen size={32} /><h2>载入 data_for_annotation</h2><p>本机启动服务会自动读取已配置的数据目录。其他电脑可选择含 images、labels、class.txt 的文件夹。图片和标签只在当前浏览器中读取。</p><input ref={folderInput} type="file" multiple hidden onChange={(event) => void importFiles(Array.from(event.target.files ?? []))} /><button onClick={() => folderInput.current?.click()}><FolderOpen size={18} />选择数据文件夹</button><div className="review-import-fallback"><label>或分别选取图片<input type="file" accept="image/*" multiple onChange={(event) => setExtraImages(Array.from(event.target.files ?? []))} /></label><label>与 YOLO 标签<input type="file" accept=".txt,text/plain" multiple onChange={(event) => setExtraLabels(Array.from(event.target.files ?? []))} /></label><button disabled={!extraImages.length || !extraLabels.length} onClick={() => void importFiles([...extraImages, ...extraLabels])}>载入所选文件</button></div></div>}
    {items.length > 0 && <div className="review-layout">
      <aside className="review-queue"><div className="review-queue-head"><strong>图片任务</strong><span>{filtered.length} / {items.length}</span></div><div className="review-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件名" /></div><div className="review-filters">{([['all', '全部'], ['pending', '待确认'], ['reviewed', '已确认'], ['empty', '空标注'], ['duplicates', '疑似重复']] as [Filter, string][]).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="review-task-list">{filtered.map((item) => <button key={item.name} className={`review-task ${item.name === activeName ? 'active' : ''}`} onClick={() => selectTask(item.name)}><span className={item.reviewed ? 'review-task-state done' : 'review-task-state'}>{item.reviewed ? <Check size={12} /> : null}</span><span className="review-task-copy"><strong title={item.name}>{item.name}</strong><small>{item.boxes.length} 框{duplicatePairs(item.boxes).length ? ' · 疑似重复' : ''}</small></span><ChevronRight size={15} /></button>)}</div></aside>
      <main className="review-center"><div className="review-image-head"><div><strong>{active?.name}</strong><span>{activeIndex + 1} / {items.length} · {active?.reviewed ? '已确认' : '待复核'}</span></div><div className="review-image-actions"><button onClick={() => setZoom((value) => Math.max(1, value / 1.5))} disabled={zoom <= 1} title="缩小"><ZoomOut size={17} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(6, value * 1.5))} disabled={zoom >= 6} title="放大"><ZoomIn size={17} /></button><button onClick={() => step(-1)} disabled={activeIndex <= 0} title="上一张"><ArrowLeft size={17} /></button><button onClick={() => step(1)} disabled={activeIndex >= items.length - 1} title="下一张"><ArrowRight size={17} /></button><button onClick={undo} disabled={!active || !(undoRef.current[active.name]?.length)} title="撤销 Ctrl+Z"><RotateCcw size={17} /></button></div></div><div ref={canvasRef} className="review-canvas"><div className="review-image-stage" style={{ width: Math.round(fitWidth * zoom) }}><img src={imageUrl} alt={active?.name ?? ''} draggable={false} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        {shownBoxes.map((box) => { const info = ROAD_CLASSES[box.classId]; const left = (box.x - box.w / 2) * 1000; const top = (box.y - box.h / 2) * 1000; const width = box.w * 1000; const height = box.h * 1000; const isSelected = selectedId === box.id; return <g key={box.id}><rect data-box-id={box.id} className={`review-svg-box ${isSelected ? 'selected' : ''} ${duplicateIds.has(box.id) ? 'duplicate' : ''}`} x={left} y={top} width={width} height={height} stroke={info?.color ?? '#fff'} /><text x={left + 3} y={Math.max(16, top - 4)} fill={info?.color ?? '#fff'}>{info?.id ?? '?'}</text>{isSelected && (['nw', 'ne', 'sw', 'se'] as Handle[]).map((handle) => <rect key={handle} data-box-id={box.id} data-handle={handle} className="review-svg-handle" x={(handle.includes('w') ? left : left + width) - 6} y={(handle.includes('n') ? top : top + height) - 6} width="12" height="12" fill={info?.color ?? '#fff'} />)}</g>; })}
        {candidates.map((box) => { const info = ROAD_CLASSES[box.classId]; return <g key={box.id} className="review-candidate-shape"><rect x={(box.x - box.w / 2) * 1000} y={(box.y - box.h / 2) * 1000} width={box.w * 1000} height={box.h * 1000} stroke={info?.color ?? '#fff'} /><text x={(box.x - box.w / 2) * 1000 + 3} y={Math.max(16, (box.y - box.h / 2) * 1000 - 4)} fill={info?.color ?? '#fff'}>AI · {info?.id}</text></g>; })}
      </svg></div></div><div className="review-canvas-foot"><span><CircleHelp size={15} />拖空白处新增框；拖框移动；拖四角改大小。Delete 删除，1–7 改类，← → 切图。</span><button className="review-confirm" disabled={candidates.length > 0} title={candidates.length ? '请先接受或忽略模型候选' : ''} onClick={markReviewed}><Check size={17} />确认并下一张</button></div></main>
      <aside className="review-inspector"><div className="review-inspector-head"><strong>标注检查</strong><span>{active?.boxes.length ?? 0} 个框</span></div><div className="review-rule-note"><strong>本批次规则</strong><p>连续围栏尽量用一个框。近处及大型标志分别标；背面也标。杆子只标交通标识牌主杆。</p></div>{candidates.length > 0 && <div className="review-candidates"><div><strong>模型候选 · {candidateVersion}</strong><small>{candidates.length} 个未审核</small></div>{candidates.map((box) => <div className="review-candidate-row" key={box.id}><span>{ROAD_CLASSES[box.classId]?.id} {box.confidence === undefined ? '' : `${Math.round(box.confidence * 100)}%`}</span><button onClick={() => acceptCandidate(box.id)}>接受</button><button onClick={() => setCandidates((previous) => previous.filter((item) => item.id !== box.id))}>忽略</button></div>)}<div className="review-candidate-actions"><button onClick={acceptAllCandidates}>全部接受</button><button onClick={() => setCandidates([])}>全部忽略</button></div></div>}{duplicates.length > 0 && <div className="review-duplicate-note"><TriangleAlert size={17} /><span>发现 {duplicates.length} 对高重叠框，请人工核对并删除多余框。</span></div>}<div className="review-classes"><strong>类别 · 快捷键 1–7</strong>{ROAD_CLASSES.map((entry, index) => <button key={entry.id} className={selectedClass === index ? 'active' : ''} onClick={() => changeClass(index)} title={entry.hint}><i style={{ background: entry.color }} /><span><b>{entry.id}</b><small>{entry.label}</small></span><kbd>{index + 1}</kbd></button>)}</div><div className="review-box-list"><strong>当前图片的框</strong>{active?.boxes.map((box, index) => <button key={box.id} className={selectedId === box.id ? 'active' : ''} onClick={() => { setSelectedId(box.id); setSelectedClass(box.classId); }}><span style={{ background: ROAD_CLASSES[box.classId]?.color }} /><b>{index + 1}. {ROAD_CLASSES[box.classId]?.id}</b><small>{box.origin === 'prediction' ? '预标注' : '新增'}</small>{duplicateIds.has(box.id) && <TriangleAlert size={14} />}</button>)}{active?.boxes.length === 0 && <p>没有预标注框。请检查是否有漏标，也可以直接确认空图。</p>}</div>{selected && <div className="review-selected"><strong>选中框</strong><span>{ROAD_CLASSES[selected.classId]?.id}</span><small>中心 {selected.x.toFixed(3)}, {selected.y.toFixed(3)} · 尺寸 {selected.w.toFixed(3)} × {selected.h.toFixed(3)}</small><button onClick={deleteSelected}><Trash2 size={15} />删除这个框</button></div>}</aside>
    </div>}
    {message && <div className={`review-message ${invalidCount ? 'warn' : ''}`}><FileUp size={16} />{message}<button onClick={() => setMessage('')}>×</button></div>}
  </div>;
}
