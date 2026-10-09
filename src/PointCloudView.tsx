import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { countPointsInCuboid, fitCuboidFromScreenRect, pointInCuboid } from './boxFitting';
import { nearestPointOnRay } from './geometry';
import type { Annotation, ClassDefinition, Cuboid, Registration, ToolMode, Vec3 } from './types';

type ViewMode = 'perspective' | 'top' | 'front';
type EditMode = 'translate' | 'scale' | 'rotate';
const EMPTY_PREVIEWS: Annotation[] = [];
const EMPTY_PREVIEW_LABELS: Record<string, string> = {};

interface Props {
  geometry: THREE.BufferGeometry | null;
  annotations: Annotation[];
  previewAnnotations?: Annotation[];
  classes: ClassDefinition[];
  semanticLabels: Record<string, string>;
  previewSemanticLabels?: Record<string, string>;
  selectedId: string | null;
  registration: Registration;
  tool: ToolMode;
  focusSelected: boolean;
  onToggleFocus: () => void;
  onCreate: (box: Cuboid) => void;
  onUpdate: (id: string, box: Cuboid) => void;
  onPaint: (indices: number[], erase: boolean) => void;
  onUndoPaint: () => void;
  canUndoPaint: boolean;
  onSelect: (id: string | null) => void;
  onEmptySelection: () => void;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transform: TransformControls;
  transformTarget: THREE.Object3D;
  selectedAnnotationId: string | null;
  cloud: THREE.Points | null;
  overlays: THREE.Group;
  raycaster: THREE.Raycaster;
  bounds: { center: THREE.Vector3; distance: number } | null;
  baseColors: Float32Array | null;
}

function disposeOverlays(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.clear();
}

function applyViewPreset(view: SceneState, mode: ViewMode) {
  if (!view.bounds) return;
  const { center, distance } = view.bounds;
  view.controls.target.copy(center);
  view.camera.up.set(0, mode === 'top' ? 0 : 1, mode === 'top' ? -1 : 0);
  if (mode === 'top') view.camera.position.copy(center).add(new THREE.Vector3(0, distance, 0.001));
  else if (mode === 'front') view.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
  else view.camera.position.copy(center).add(new THREE.Vector3(distance * 0.48, distance * 0.34, distance * 0.76));
  view.camera.lookAt(center);
  view.controls.update();
}

export default function PointCloudView({ geometry, annotations, previewAnnotations = EMPTY_PREVIEWS, classes, semanticLabels, previewSemanticLabels = EMPTY_PREVIEW_LABELS, selectedId, registration, tool, focusSelected, onToggleFocus, onCreate, onUpdate, onPaint, onUndoPaint, canUndoPaint, onSelect, onEmptySelection }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  const createRef = useRef(onCreate);
  const updateRef = useRef(onUpdate);
  const paintRef = useRef(onPaint);
  const selectRef = useRef(onSelect);
  const emptyRef = useRef(onEmptySelection);
  const mode = useRef(tool);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [editMode, setEditMode] = useState<EditMode>('translate');
  const [pointSize, setPointSize] = useState(0.23);
  const [selectionRect, setSelectionRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [brushCursor, setBrushCursor] = useState<{ left: number; top: number } | null>(null);
  createRef.current = onCreate;
  updateRef.current = onUpdate;
  paintRef.current = onPaint;
  selectRef.current = onSelect;
  emptyRef.current = onEmptySelection;
  mode.current = tool;
  const selectedBox = annotations.find((item) => item.id === selectedId)?.pointCloud;
  const selectedPointCount = useMemo(() => selectedBox ? countPointsInCuboid(geometry, selectedBox) : 0, [geometry, selectedBox]);
  const locateSelectedBox = () => {
    const view = state.current;
    if (!view || !selectedBox) return;
    const direction = view.camera.position.clone().sub(view.controls.target).normalize();
    const center = new THREE.Vector3(...selectedBox.center);
    const distance = Math.max(6, Math.max(...selectedBox.size) * 2.8);
    view.controls.target.copy(center);
    view.camera.position.copy(center).addScaledVector(direction, distance);
    view.controls.update();
  };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#141c29');
    scene.fog = new THREE.FogExp2('#141c29', 0.0045);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 5000);
    camera.position.set(22, 19, 31);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, -4);
    controls.update();
    const grid = new THREE.GridHelper(100, 40, '#50617a', '#2d3a4d');
    grid.position.y = -1.6;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);
    const axes = new THREE.AxesHelper(3);
    axes.position.set(-2, -1.5, 3);
    scene.add(axes);
    const overlays = new THREE.Group();
    scene.add(overlays);
    const transformTarget = new THREE.Object3D();
    scene.add(transformTarget);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.78);
    scene.add(transform.getHelper());
    transform.addEventListener('dragging-changed', (event) => { controls.enabled = !event.value; });
    transform.addEventListener('objectChange', () => {
      const id = state.current?.selectedAnnotationId;
      if (!id) return;
      transformTarget.scale.set(
        Math.max(0.1, Math.abs(transformTarget.scale.x)),
        Math.max(0.1, Math.abs(transformTarget.scale.y)),
        Math.max(0.1, Math.abs(transformTarget.scale.z)),
      );
      updateRef.current(id, {
        kind: 'cuboid',
        center: transformTarget.position.toArray() as Vec3,
        size: transformTarget.scale.toArray() as Vec3,
        yaw: Number(THREE.MathUtils.radToDeg(transformTarget.rotation.y).toFixed(2)),
      });
    });
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.5;
    state.current = { renderer, scene, camera, controls, transform, transformTarget, selectedAnnotationId: null, cloud: null, overlays, raycaster, bounds: null, baseColors: null };

    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();
    let down: { x: number; y: number; selecting: boolean; painting: boolean; erase: boolean; indices?: Set<number>; projected?: Float32Array; lastX?: number; lastY?: number } | null = null;
    const projectCloud = () => {
      const positions = state.current?.cloud?.geometry.getAttribute('position');
      if (!positions) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const projected = new Float32Array(positions.count * 3);
      const point = new THREE.Vector3();
      camera.updateMatrixWorld();
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        const distance = point.distanceTo(camera.position);
        point.project(camera);
        projected[index * 3] = rect.left + (point.x + 1) * rect.width / 2;
        projected[index * 3 + 1] = rect.top + (1 - point.y) * rect.height / 2;
        projected[index * 3 + 2] = point.z >= -1 && point.z <= 1 ? distance : Infinity;
      }
      return projected;
    };
    const brushAt = (stroke: NonNullable<typeof down>, x: number, y: number) => {
      if (!stroke.projected || !stroke.indices) return;
      const nearby: number[] = [];
      let closest = Infinity;
      for (let index = 0; index < stroke.projected.length / 3; index++) {
        const offset = index * 3;
        const dx = stroke.projected[offset] - x;
        const dy = stroke.projected[offset + 1] - y;
        if (dx * dx + dy * dy > 14 * 14) continue;
        const distance = stroke.projected[offset + 2];
        if (!Number.isFinite(distance)) continue;
        closest = Math.min(closest, distance);
        nearby.push(index);
      }
      const depthTolerance = Math.max(0.8, closest * 0.035);
      for (const index of nearby) {
        if (stroke.projected[index * 3 + 2] <= closest + depthTolerance) stroke.indices.add(index);
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (transform.dragging || transform.axis) return;
      const painting = mode.current === 'cloud-paint';
      const selecting = mode.current === 'cuboid' || event.ctrlKey || (painting && event.shiftKey);
      down = { x: event.clientX, y: event.clientY, selecting, painting, erase: painting && event.altKey,
        indices: painting ? new Set<number>() : undefined,
        projected: painting ? projectCloud() ?? undefined : undefined,
        lastX: event.clientX, lastY: event.clientY };
      if (painting && !selecting) brushAt(down, event.clientX, event.clientY);
      if (selecting || painting) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    };
    const onMove = (event: PointerEvent) => {
      if (mode.current === 'cloud-paint') {
        const rect = element.getBoundingClientRect();
        setBrushCursor({ left: event.clientX - rect.left, top: event.clientY - rect.top });
      }
      if (down?.painting && !down.selecting) {
        const lastX = down.lastX ?? event.clientX;
        const lastY = down.lastY ?? event.clientY;
        const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - lastX, event.clientY - lastY) / 7));
        for (let step = 1; step <= steps; step++) {
          brushAt(down, lastX + (event.clientX - lastX) * step / steps, lastY + (event.clientY - lastY) * step / steps);
        }
        down.lastX = event.clientX;
        down.lastY = event.clientY;
        return;
      }
      if (!down?.selecting) return;
      const rect = element.getBoundingClientRect();
      setSelectionRect({
        left: Math.min(down.x, event.clientX) - rect.left,
        top: Math.min(down.y, event.clientY) - rect.top,
        width: Math.abs(event.clientX - down.x),
        height: Math.abs(event.clientY - down.y),
      });
    };
    const onUp = (event: PointerEvent) => {
      if (!down) return;
      const start = down;
      down = null;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (start.painting) {
        controls.enabled = true;
        setSelectionRect(null);
        if (start.selecting && start.projected) {
          const left = Math.min(start.x, event.clientX);
          const right = Math.max(start.x, event.clientX);
          const top = Math.min(start.y, event.clientY);
          const bottom = Math.max(start.y, event.clientY);
          for (let index = 0; index < start.projected.length / 3; index++) {
            const offset = index * 3;
            if (start.projected[offset] >= left && start.projected[offset] <= right &&
              start.projected[offset + 1] >= top && start.projected[offset + 1] <= bottom &&
              Number.isFinite(start.projected[offset + 2])) start.indices?.add(index);
          }
        }
        if (start.indices?.size) paintRef.current([...start.indices], start.erase);
        else emptyRef.current();
        return;
      }
      if (start.selecting) {
        controls.enabled = true;
        setSelectionRect(null);
        if (moved < 8 && mode.current !== 'cuboid') return;
        const cloud = state.current?.cloud;
        if (moved >= 8 && !cloud) return;
        if (moved >= 8) {
          const rect = element.getBoundingClientRect();
          const left = Math.min(start.x, event.clientX) - rect.left;
          const right = Math.max(start.x, event.clientX) - rect.left;
          const top = Math.min(start.y, event.clientY) - rect.top;
          const bottom = Math.max(start.y, event.clientY) - rect.top;
          const fitted = fitCuboidFromScreenRect(cloud!.geometry, camera, {
            minX: left / rect.width * 2 - 1,
            maxX: right / rect.width * 2 - 1,
            minY: 1 - bottom / rect.height * 2,
            maxY: 1 - top / rect.height * 2,
          });
          if (fitted) createRef.current(fitted);
          else emptyRef.current();
          return;
        }
      }
      if (moved > 5 || event.button !== 0) return;
      const view = state.current;
      if (!view) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hitBox = raycaster.intersectObjects(view.overlays.children, true)
        .find((hit) => typeof hit.object.userData.annotationId === 'string');
      if (hitBox) {
        selectRef.current(hitBox.object.userData.annotationId as string);
        return;
      }
      if (mode.current !== 'cuboid' || !view.cloud) { selectRef.current(null); return; }
      const hit = raycaster.intersectObject(view.cloud, false)[0];
      const point = hit
        ? [hit.point.x, hit.point.y, hit.point.z] as Vec3
        : nearestPointOnRay(view.cloud.geometry, [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z], raycaster.ray.direction);
      if (point) createRef.current({ kind: 'cuboid', center: point, size: [1.4, 1.4, 1.4], yaw: 0 });
    };
    const onCancel = () => { down = null; controls.enabled = true; setSelectionRect(null); };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onCancel);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      if (state.current?.cloud) (state.current.cloud.material as THREE.Material).dispose();
      disposeOverlays(overlays);
      transform.detach();
      transform.dispose();
      scene.remove(transform.getHelper());
      scene.remove(transformTarget);
      grid.geometry.dispose();
      grid.material.dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      controls.dispose();
      renderer.dispose();
      element.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (view.cloud) {
      view.scene.remove(view.cloud);
      (view.cloud.material as THREE.Material).dispose();
      view.cloud = null;
      view.baseColors = null;
    }
    if (!geometry) return;
    if (!geometry.getAttribute('color')) {
      const position = geometry.getAttribute('position');
      const intensity = geometry.getAttribute('intensity');
      const color = new Float32Array(position.count * 3);
      const low = new THREE.Color('#59758f');
      const high = new THREE.Color('#d9ecf8');
      const tint = new THREE.Color();
      for (let i = 0; i < position.count; i++) {
        const t = THREE.MathUtils.clamp((position.getY(i) + 2) / 18, 0, 1);
        tint.copy(low).lerp(high, t);
        const boost = intensity ? THREE.MathUtils.clamp(intensity.getX(i) / 80, 0.65, 1.28) : 1;
        color[i * 3] = Math.min(1, tint.r * boost);
        color[i * 3 + 1] = Math.min(1, tint.g * boost);
        color[i * 3 + 2] = Math.min(1, tint.b * boost);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    }
    const colors = geometry.getAttribute('color');
    const baseColors = new Float32Array(colors.count * 3);
    for (let i = 0; i < colors.count; i++) {
      baseColors[i * 3] = colors.getX(i);
      baseColors[i * 3 + 1] = colors.getY(i);
      baseColors[i * 3 + 2] = colors.getZ(i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(baseColors.slice(), 3));
    view.baseColors = baseColors;
    const material = new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95 });
    const cloud = new THREE.Points(geometry, material);
    view.cloud = cloud;
    view.scene.add(cloud);
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (sphere) {
      const distance = Math.max(16, sphere.radius * 2.4);
      view.bounds = { center: sphere.center.clone(), distance };
      view.camera.far = Math.max(1000, distance * 10);
      view.camera.updateProjectionMatrix();
      applyViewPreset(view, viewMode);
    }
  }, [geometry]);

  useEffect(() => { if (state.current) applyViewPreset(state.current, viewMode); }, [viewMode]);
  useEffect(() => {
    const view = state.current;
    if (!view) return;
    view.transform.setMode(editMode);
    view.transform.setSpace(editMode === 'scale' ? 'local' : 'world');
    view.transform.showX = editMode !== 'rotate';
    view.transform.showY = true;
    view.transform.showZ = editMode !== 'rotate';
  }, [editMode]);
  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (!selectedBox || !selectedId || tool === 'cloud-paint') {
      view.selectedAnnotationId = null;
      view.transform.detach();
      return;
    }
    view.selectedAnnotationId = selectedId;
    if (!view.transform.dragging) {
      view.transformTarget.position.set(...selectedBox.center);
      view.transformTarget.rotation.set(0, THREE.MathUtils.degToRad(selectedBox.yaw ?? 0), 0);
      view.transformTarget.scale.set(...selectedBox.size);
      view.transform.attach(view.transformTarget);
    }
  }, [selectedId, selectedBox, tool]);
  useEffect(() => {
    const material = state.current?.cloud?.material as THREE.PointsMaterial | undefined;
    if (material) material.size = pointSize;
  }, [pointSize, geometry]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    disposeOverlays(view.overlays);
    for (const annotation of [...annotations, ...previewAnnotations]) {
      if (!annotation.visible || !annotation.pointCloud) continue;
      const preview = previewAnnotations.includes(annotation);
      const definition = classes.find((item) => item.id === annotation.classId);
      const color = new THREE.Color(preview ? '#c3a4ff' : definition?.color ?? '#ffffff');
      const box = annotation.pointCloud;
      const group = new THREE.Group();
      group.position.set(...box.center);
      group.rotation.y = THREE.MathUtils.degToRad(box.yaw ?? 0);
      const boxGeometry = new THREE.BoxGeometry(...box.size);
      const edges = new THREE.EdgesGeometry(boxGeometry);
      boxGeometry.dispose();
      const wire = new THREE.LineSegments(edges, preview
        ? new THREE.LineDashedMaterial({ color, depthTest: false, dashSize: 0.28, gapSize: 0.16 })
        : new THREE.LineBasicMaterial({ color, depthTest: false }));
      if (preview) wire.computeLineDistances();
      wire.renderOrder = 3;
      group.add(wire);
      if (!preview) {
      const pickingMesh = new THREE.Mesh(
        new THREE.BoxGeometry(...box.size),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: annotation.id === selectedId ? 0.075 : 0.018, depthWrite: false }),
      );
      pickingMesh.userData.annotationId = annotation.id;
      pickingMesh.renderOrder = 2;
      group.add(pickingMesh);
      }
      if (annotation.id === selectedId) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color }));
        dot.renderOrder = 4;
        group.add(dot);
      }
      view.overlays.add(group);
    }
    const cameraMarker = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: '#ffc96c' }));
    cameraMarker.position.set(...registration.position);
    view.overlays.add(cameraMarker);
  }, [annotations, previewAnnotations, classes, selectedId, registration]);

  useEffect(() => {
    const view = state.current;
    const positions = geometry?.getAttribute('position');
    const colors = geometry?.getAttribute('color');
    if (!view?.baseColors || !positions || !colors) return;
    const box = focusSelected ? annotations.find((item) => item.id === selectedId)?.pointCloud : undefined;
    const labelColors = new Map(classes.map((definition) => {
      const color = new THREE.Color(definition.color);
      return [definition.id, [color.r, color.g, color.b] as Vec3] as const;
    }));
    const target = colors.array as Float32Array;
    const base = view.baseColors;
    for (let i = 0; i < positions.count; i++) {
      const brightness = box && !pointInCuboid(positions.getX(i), positions.getY(i), positions.getZ(i), box) ? 0.08 : 1;
      const labelColor = labelColors.get(semanticLabels[i]);
      const candidateColor = !labelColor && previewSemanticLabels[i] !== undefined ? [0.72, 0.43, 1] : null;
      target[i * 3] = (labelColor?.[0] ?? candidateColor?.[0] ?? base[i * 3]) * brightness;
      target[i * 3 + 1] = (labelColor?.[1] ?? candidateColor?.[1] ?? base[i * 3 + 1]) * brightness;
      target[i * 3 + 2] = (labelColor?.[2] ?? candidateColor?.[2] ?? base[i * 3 + 2]) * brightness;
    }
    colors.needsUpdate = true;
  }, [geometry, annotations, selectedId, focusSelected, semanticLabels, previewSemanticLabels, classes]);

  return <div className={`viewer-canvas point-view ${tool === 'cuboid' || tool === 'cloud-paint' ? 'crosshair' : ''}`} aria-label="三维点云视图">
    <div ref={host} className="point-canvas-host" />
    {selectionRect && <div className="cloud-selection-rect" style={selectionRect} />}
    {tool === 'cloud-paint' && brushCursor && <div className="cloud-brush-cursor" style={brushCursor} />}
    <div className="point-view-controls">
      <select aria-label="点云视角" value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
        <option value="perspective">透视</option><option value="top">俯视</option><option value="front">正视</option>
      </select>
      <button onClick={onToggleFocus} disabled={!selectedBox} className={focusSelected ? 'active' : ''} title="突出显示框内点">聚焦</button>
      <button onClick={() => setPointSize((size) => Math.max(0.06, size - 0.06))} title="减小点大小">−</button>
      <button onClick={() => setPointSize((size) => Math.min(1, size + 0.06))} title="增大点大小">+</button>
    </div>
    {selectedBox && <div className="cloud-point-count">框内 {selectedPointCount.toLocaleString()} 点</div>}
    {selectedBox && tool !== 'cloud-paint' && <div className="cloud-edit-controls" role="group" aria-label="3D 框直接调整">
      <span>拖动手柄调整框</span>
      <button onClick={locateSelectedBox} title="将视角移近当前 3D 框，便于精细调整">定位到框</button>
      <button className={editMode === 'translate' ? 'active' : ''} onClick={() => setEditMode('translate')}>移动</button>
      <button className={editMode === 'scale' ? 'active' : ''} onClick={() => setEditMode('scale')}>尺寸</button>
      <button className={editMode === 'rotate' ? 'active' : ''} onClick={() => setEditMode('rotate')}>旋转</button>
    </div>}
    {tool === 'cloud-paint' && <div className="cloud-paint-controls"><span>拖动涂抹 · Shift 框选 · Alt 擦除 · {Object.keys(semanticLabels).length.toLocaleString()} 点已分类</span><button disabled={!canUndoPaint} onClick={onUndoPaint}>撤销上一步</button></div>}
  </div>;
}
