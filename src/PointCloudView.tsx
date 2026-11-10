import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { countPointsInCuboid, fitCuboidFromScreenRect, pointInCuboid } from './boxFitting';
import { nearestPointOnRay } from './geometry';
import type { Annotation, ClassDefinition, Cuboid, Registration, TiePoint, ToolMode, Vec3 } from './types';
import { ViewSync, dragOrientation, recordCamera, tieMarker, clearTieMarkers } from './viewSync';
import { displaySpacing, intensityLimits } from './cloudDisplay';
import type { PointDisplayRange } from './cloudDisplay';
import { createOrbitFromCamera, observationOrbitTarget } from './cameraOrbit';

type ViewMode = 'current' | 'perspective' | 'top' | 'front';
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
  viewSync: ViewSync;
  linked: boolean;
  tiePoints: TiePoint[];
  pendingTiePoint: Vec3 | null;
  pointDisplayRanges?: PointDisplayRange[];
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
  onTiePointPick?: (point: Vec3) => void;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  rebaseOrbit: (target: THREE.Vector3) => void;
  transform: TransformControls;
  transformTarget: THREE.Object3D;
  selectedAnnotationId: string | null;
  cloud: THREE.Points | null;
  overlays: THREE.Group;
  raycaster: THREE.Raycaster;
  bounds: { center: THREE.Vector3; distance: number } | null;
  baseColors: Float32Array | null;
  ties: THREE.Group;
  intensityRange: [number,number];
  pointFovUniform: {value:number} | null;
  pointSizeUniforms: { scale:{value:number}; adaptive:{value:number} } | null;
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
  if (!view.bounds || mode === 'current') return;
  const { center, distance } = view.bounds;
  view.controls.target.copy(center);
  view.camera.up.set(0, mode === 'top' ? 0 : 1, mode === 'top' ? -1 : 0);
  if (mode === 'top') view.camera.position.copy(center).add(new THREE.Vector3(0, distance, 0.001));
  else if (mode === 'front') view.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
  else view.camera.position.copy(center).add(new THREE.Vector3(distance * 0.48, distance * 0.34, distance * 0.76));
  view.camera.lookAt(center);
  view.rebaseOrbit(center);
}

export default function PointCloudView({ geometry, annotations, previewAnnotations = EMPTY_PREVIEWS, classes, semanticLabels, previewSemanticLabels = EMPTY_PREVIEW_LABELS, selectedId, registration, viewSync, linked, tiePoints, pendingTiePoint, pointDisplayRanges, tool, focusSelected, onToggleFocus, onCreate, onUpdate, onPaint, onUndoPaint, canUndoPaint, onSelect, onEmptySelection, onTiePointPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  const createRef = useRef(onCreate);
  const updateRef = useRef(onUpdate);
  const paintRef = useRef(onPaint);
  const selectRef = useRef(onSelect);
  const emptyRef = useRef(onEmptySelection);
  const tiePointRef = useRef(onTiePointPick);
  const mode = useRef(tool);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [editMode, setEditMode] = useState<EditMode>('translate');
  const [pointSize, setPointSize] = useState(2.2);
  const [pointSizeMode, setPointSizeMode] = useState('adaptive');
  const [adaptiveAvailable, setAdaptiveAvailable] = useState(false);
  const pointDisplay = useRef({size:pointSize,mode:pointSizeMode});
  pointDisplay.current = {size:pointSize,mode:pointSizeMode};
  const [colorMode, setColorMode] = useState('enhanced');
  const liveRef = useRef({ linked, registration, viewSync });
  const previousLinked = useRef(linked);
  liveRef.current = { linked, registration, viewSync };
  const [selectionRect, setSelectionRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [brushCursor, setBrushCursor] = useState<{ left: number; top: number } | null>(null);
  createRef.current = onCreate;
  updateRef.current = onUpdate;
  paintRef.current = onPaint;
  selectRef.current = onSelect;
  emptyRef.current = onEmptySelection;
  tiePointRef.current = onTiePointPick;
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

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#141c29');
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 5000);
    camera.position.set(22, 19, 31);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const recordOrbit = () => { if (!liveRef.current.linked) recordCamera(element, camera); };
    camera.lookAt(0, 1, -4);
    let controls = createOrbitFromCamera(camera, renderer.domElement, new THREE.Vector3(0, 1, -4), recordOrbit);
    const rebaseOrbit = (target: THREE.Vector3) => {
      controls.dispose();
      controls = createOrbitFromCamera(camera, renderer.domElement, target, recordOrbit);
      controls.enabled = !liveRef.current.linked;
      if (state.current) state.current.controls = controls;
      recordOrbit();
    };
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
    transform.addEventListener('dragging-changed', (event) => { controls.enabled = !event.value && !liveRef.current.linked; });
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
    raycaster.params.Points.threshold = 0.07;
    const ties = new THREE.Group(); scene.add(ties);
    state.current = { renderer, scene, camera, controls, rebaseOrbit, transform, transformTarget, selectedAnnotationId: null, cloud: null, overlays, raycaster, bounds: null, baseColors: null, ties, intensityRange:[0,1], pointFovUniform:null, pointSizeUniforms:null };

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
      if (!liveRef.current.linked) controls.update();
      grid.visible = !liveRef.current.linked; axes.visible = !liveRef.current.linked;
      if(state.current?.pointFovUniform) state.current.pointFovUniform.value=1/Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5);
      if (element.clientWidth) renderer.render(scene, camera);
    };
    render();
    let down: { x: number; y: number; world: THREE.Quaternion; selecting: boolean; painting: boolean; erase: boolean; indices?: Set<number>; projected?: Float32Array; lastX?: number; lastY?: number } | null = null;
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
      down = { x: event.clientX, y: event.clientY, world: liveRef.current.viewSync.snapshot.quaternion, selecting, painting, erase: painting && event.altKey,
        indices: painting ? new Set<number>() : undefined,
        projected: painting ? projectCloud() ?? undefined : undefined,
        lastX: event.clientX, lastY: event.clientY };
      if (painting && !selecting) brushAt(down, event.clientX, event.clientY);
      if (selecting || painting || liveRef.current.linked) {
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
      if (!down?.selecting) {
        if (down && liveRef.current.linked) liveRef.current.viewSync.set(dragOrientation(down.world, event.clientX-down.x, event.clientY-down.y, camera.fov));
        return;
      }
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
        controls.enabled = !liveRef.current.linked;
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
        controls.enabled = !liveRef.current.linked;
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
      if (mode.current === 'tie-point' && view.cloud) {
        const hit = raycaster.intersectObject(view.cloud, false)[0];
        const source = view.cloud.geometry.getAttribute('position');
        let point: Vec3 | null = hit?.index !== undefined ? [source.getX(hit.index), source.getY(hit.index), source.getZ(hit.index)] : null;
        if (!point) {
          const projected = projectCloud();
          const positions = view.cloud.geometry.getAttribute('position');
          let bestIndex = -1, bestPixelDistance = 12 * 12, bestDepth = Infinity;
          if (projected) for (let index = 0; index < positions.count; index++) {
            const offset = index * 3;
            const dx = projected[offset] - event.clientX, dy = projected[offset + 1] - event.clientY;
            const distance = dx * dx + dy * dy, depth = projected[offset + 2];
            if (!Number.isFinite(depth) || distance > 12 * 12) continue;
            if (distance < bestPixelDistance - 9 || (Math.abs(distance - bestPixelDistance) <= 9 && depth < bestDepth)) {
              bestIndex = index; bestPixelDistance = distance; bestDepth = depth;
            }
          }
          if (bestIndex >= 0) point = [positions.getX(bestIndex), positions.getY(bestIndex), positions.getZ(bestIndex)];
        }
        if (point) tiePointRef.current?.(point);
        else emptyRef.current();
        return;
      }
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
    const onCancel = () => { down = null; controls.enabled = !liveRef.current.linked; setSelectionRect(null); };
    const onWheel = (event: WheelEvent) => {
      if (!liveRef.current.linked) return;
      event.preventDefault();
      const current = liveRef.current.viewSync.snapshot;
      liveRef.current.viewSync.set(current.quaternion, current.fov + Math.sign(event.deltaY)*4);
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onCancel);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheel);
      clearTieMarkers(ties);
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
    view.intensityRange=intensityLimits(geometry.getAttribute('intensity'));
    setColorMode(!geometry.getAttribute('color') || geometry.userData.generatedColors ? (geometry.getAttribute('intensity') ? 'intensity' : 'height') : 'enhanced');
    if (!geometry.getAttribute('color')) {
      geometry.userData.generatedColors = true;
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
    if (!geometry.getAttribute('sourceColor')) geometry.setAttribute('sourceColor', geometry.getAttribute('color').clone());
    const colors = geometry.getAttribute('sourceColor');
    const baseColors = new Float32Array(colors.count * 3);
    for (let i = 0; i < colors.count; i++) {
      baseColors[i * 3] = colors.getX(i);
      baseColors[i * 3 + 1] = colors.getY(i);
      baseColors[i * 3 + 2] = colors.getZ(i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(baseColors.slice(), 3));
    view.baseColors = baseColors;
    const spacing=displaySpacing(geometry.getAttribute('position').count,pointDisplayRanges);
    setAdaptiveAvailable(Boolean(spacing));
    const material = new THREE.PointsMaterial({ size: pointDisplay.current.size, vertexColors: true, sizeAttenuation: false });
    view.pointFovUniform=null;
    view.pointSizeUniforms=null;
    if(spacing) {
      geometry.setAttribute('hintSpacing',new THREE.BufferAttribute(spacing,1));
      material.onBeforeCompile=(shader)=>{
        shader.uniforms.pointFovFactor={value:1/Math.tan(THREE.MathUtils.degToRad(view.camera.fov)*.5)};
        shader.uniforms.pointUserScale={value:pointDisplay.current.size/2.2};
        shader.uniforms.pointAdaptive={value:pointDisplay.current.mode==='adaptive' ? 1 : 0};
        view.pointFovUniform=shader.uniforms.pointFovFactor;
        view.pointSizeUniforms={scale:shader.uniforms.pointUserScale,adaptive:shader.uniforms.pointAdaptive};
        shader.vertexShader='attribute float hintSpacing;\nuniform float pointFovFactor;\nuniform float pointUserScale;\nuniform float pointAdaptive;\n'+shader.vertexShader;
        // Clamp the automatic baseline FIRST, then apply the user scale. Applying
        // the user scale inside clamp made +/- ineffective on saturated points.
        shader.vertexShader=shader.vertexShader.replace('#include <logdepthbuf_vertex>','if (pointAdaptive > 0.5) { gl_PointSize = clamp((size / pointUserScale) * (scale / max(0.01, -mvPosition.z)) * hintSpacing * pointFovFactor, 1.0, 10.0) * pointUserScale; }\n#include <logdepthbuf_vertex>');
      };
    }
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
      if (!liveRef.current.linked) {
        const preset = viewMode === 'current' ? 'perspective' : viewMode;
        applyViewPreset(view, preset);
        setViewMode(preset);
      }
    }
  }, [geometry]);

  useLayoutEffect(() => {
    const view = state.current;
    if (!view) return;
    const leavingSync = previousLinked.current && !linked;
    previousLinked.current = linked;
    if (leavingSync) {
      view.rebaseOrbit(observationOrbitTarget(view.camera));
      setViewMode('current');
    }
    view.controls.enabled = !linked;
    if (!linked) return;
    return viewSync.subscribe((shared) => {
      view.camera.position.set(...registration.position);
      view.camera.quaternion.copy(shared.quaternion);
      view.camera.fov = shared.fov; view.camera.updateProjectionMatrix();
      view.camera.updateMatrixWorld();
      if (host.current) recordCamera(host.current, view.camera);
    });
  }, [viewSync, linked, registration, geometry]);

  useEffect(() => {
    const group = state.current?.ties;
    if (!group) return;
    clearTieMarkers(group);
    tiePoints.forEach((pair, i) => { const marker = tieMarker(String(i + 1)); marker.position.set(...pair.cloud); group.add(marker); });
    if (pendingTiePoint) { const marker = tieMarker('+', '#7cead4'); marker.position.set(...pendingTiePoint); group.add(marker); }
  }, [tiePoints, pendingTiePoint]);
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
    const view=state.current;
    const material = view?.cloud?.material as THREE.PointsMaterial | undefined;
    if (material) material.size = pointSize;
    if(view?.pointSizeUniforms) {
      view.pointSizeUniforms.scale.value=pointSize/2.2;
      view.pointSizeUniforms.adaptive.value=pointSizeMode==='adaptive' ? 1 : 0;
    }
    if(host.current) {
      host.current.dataset.pointSize=pointSize.toFixed(1);
      host.current.dataset.pointSizeMode=adaptiveAvailable ? pointSizeMode : 'fixed';
    }
  }, [pointSize, pointSizeMode, adaptiveAvailable, geometry]);

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
    const tint = new THREE.Color();
    const intensity=geometry?.getAttribute('intensity');
    const [iLow,iHigh]=view.intensityRange;
    for (let i = 0; i < positions.count; i++) {
      const brightness = box && !pointInCuboid(positions.getX(i), positions.getY(i), positions.getZ(i), box) ? 0.08 : 1;
      const labelColor = labelColors.get(semanticLabels[i]);
      const candidateColor = !labelColor && previewSemanticLabels[i] !== undefined ? [0.72, 0.43, 1] : null;
      let r = base[i*3], g = base[i*3+1], b = base[i*3+2];
      if (colorMode === 'intensity' && intensity) {
        const v=intensity.getX(i);const t=Number.isFinite(v) ? THREE.MathUtils.clamp((v-iLow)/(iHigh-iLow),0,1) : 0;
        r=g=b=.02+.6*Math.pow(t,1.5);
      } else if (colorMode === 'height') {
        tint.setHSL(.58-THREE.MathUtils.clamp((positions.getY(i)+3)/28,0,1)*.5, .45, .56);
        r=tint.r; g=tint.g; b=tint.b;
      } else if (colorMode === 'enhanced') {
        r=Math.min(.95,r*2.5+.035); g=Math.min(.95,g*2.5+.035); b=Math.min(.95,b*2.5+.035);
      }
      target[i*3] = (labelColor?.[0] ?? candidateColor?.[0] ?? r)*brightness;
      target[i*3+1] = (labelColor?.[1] ?? candidateColor?.[1] ?? g)*brightness;
      target[i*3+2] = (labelColor?.[2] ?? candidateColor?.[2] ?? b)*brightness;
    }
    colors.needsUpdate = true;
  }, [geometry, annotations, selectedId, focusSelected, semanticLabels, previewSemanticLabels, classes, colorMode]);

  return <div className={`viewer-canvas point-view ${tool === 'cuboid' || tool === 'cloud-paint' ? 'crosshair' : ''}`} aria-label="三维点云视图">
    <div ref={host} className="point-canvas-host" />
    {selectionRect && <div className="cloud-selection-rect" style={selectionRect} />}
    {tool === 'cloud-paint' && brushCursor && <div className="cloud-brush-cursor" style={brushCursor} />}
    <div className="point-view-controls">
      {!linked && <select aria-label="点云视角" value={viewMode} onChange={(event) => { const next=event.target.value as ViewMode; setViewMode(next); if(state.current)applyViewPreset(state.current,next); }}>
        <option value="current" disabled>当前视角</option>
        <option value="perspective">透视</option><option value="top">俯视</option><option value="front">正视</option>
      </select>}
      <select aria-label="点云着色" value={colorMode} onChange={(event) => setColorMode(event.target.value)}>{geometry?.getAttribute('intensity') && <option value="intensity">强度对比</option>}<option value="height">高程增强</option>{geometry?.getAttribute('color') && !geometry.userData.generatedColors && <><option value="enhanced">亮度增强</option><option value="rgb">原始颜色</option></>}</select>
      {selectedBox && <button onClick={onToggleFocus} className={focusSelected ? 'active' : ''} title="突出显示框内点">聚焦</button>}
      <select aria-label="点径模式" value={adaptiveAvailable ? pointSizeMode : 'fixed'} onChange={(event)=>setPointSizeMode(event.target.value)}><option value="adaptive" disabled={!adaptiveAvailable}>自适应点径</option><option value="fixed">固定像素</option></select>
      <label className="point-size-label">点大小<output aria-label="当前点大小">{adaptiveAvailable && pointSizeMode==='adaptive' ? (pointSize/2.2).toFixed(1)+'×' : pointSize.toFixed(1)+' px'}</output></label>
      <div className="point-size-slider"><button aria-label="减小点大小" disabled={pointSize<=.6} onClick={() => setPointSize((size) => Math.max(.6, Number((size - .4).toFixed(1))))}>−</button><input type="range" aria-label="点大小" min="0.6" max="8.2" step="0.2" value={pointSize} onChange={(event)=>setPointSize(Number(event.target.value))}/><button aria-label="增大点大小" disabled={pointSize>=8.2} onClick={() => setPointSize((size) => Math.min(8.2, Number((size + .4).toFixed(1))))}>+</button></div>
    </div>
    {selectedBox && <div className="cloud-point-count">框内 {selectedPointCount.toLocaleString()} 点</div>}
    {selectedBox && tool !== 'cloud-paint' && <div className="cloud-edit-controls" role="group" aria-label="3D 框直接调整">
      <span>拖动手柄调整框</span>
      <button disabled={linked} onClick={locateSelectedBox} title="将视角移近当前 3D 框，便于精细调整">定位到框</button>
      <button className={editMode === 'translate' ? 'active' : ''} onClick={() => setEditMode('translate')}>移动</button>
      <button className={editMode === 'scale' ? 'active' : ''} onClick={() => setEditMode('scale')}>尺寸</button>
      <button className={editMode === 'rotate' ? 'active' : ''} onClick={() => setEditMode('rotate')}>旋转</button>
    </div>}
    {tool === 'cloud-paint' && <div className="cloud-paint-controls"><span>拖动涂抹 · Shift 框选 · Alt 擦除 · {Object.keys(semanticLabels).length.toLocaleString()} 点已分类</span><button disabled={!canUndoPaint} onClick={onUndoPaint}>撤销上一步</button></div>}
  </div>;
}
