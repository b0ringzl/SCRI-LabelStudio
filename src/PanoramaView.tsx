import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { directionToPanorama, panoramaToDirection, pointToPanorama, registrationQuaternion } from './geometry';
import type { Annotation, ClassDefinition, Registration, ToolMode, UV } from './types';
const EMPTY_PREVIEWS: Annotation[] = [];

interface Props {
  imageUrl: string;
  cloudGeometry: THREE.BufferGeometry | null;
  annotations: Annotation[];
  previewAnnotations?: Annotation[];
  classes: ClassDefinition[];
  selectedId: string | null;
  registration: Registration;
  tool: ToolMode;
  draftVertices: UV[];
  showProjection: boolean;
  focus?: { uv: UV; serial: number } | null;
  onPick: (uv: UV) => void;
  onFinishPolygon: () => void;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sphere: THREE.Mesh;
  annotations: THREE.Group;
  projection: THREE.Points | null;
  yaw: number;
  pitch: number;
}

function spherePoint(uv: UV, radius = 19.72) {
  return panoramaToDirection(uv).multiplyScalar(radius);
}

export default function PanoramaView({ imageUrl, cloudGeometry, annotations, previewAnnotations = EMPTY_PREVIEWS, classes, selectedId, registration, tool, draftVertices, showProjection, focus, onPick, onFinishPolygon }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  const pickRef = useRef(onPick);
  const finishRef = useRef(onFinishPolygon);
  const modeRef = useRef(tool);
  pickRef.current = onPick;
  finishRef.current = onFinishPolygon;
  modeRef.current = tool;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a2230');
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 50);
    camera.position.set(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const sphereGeometry = new THREE.SphereGeometry(20, 64, 48);
    sphereGeometry.scale(-1, 1, 1);
    const sphere = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({ color: '#243447' }));
    sphere.rotation.y = -Math.PI / 2;
    scene.add(sphere);
    const annotationGroup = new THREE.Group();
    scene.add(annotationGroup);
    state.current = { renderer, scene, camera, sphere, annotations: annotationGroup, projection: null, yaw: 0, pitch: 0 };
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };
    render();

    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY, yaw: state.current?.yaw ?? 0, pitch: state.current?.pitch ?? 0 };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!down || !state.current) return;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      if (Math.hypot(dx, dy) < 3) return;
      state.current.yaw = down.yaw - dx * 0.0038;
      state.current.pitch = THREE.MathUtils.clamp(down.pitch - dy * 0.0038, -1.45, 1.45);
      camera.rotation.set(state.current.pitch, state.current.yaw, 0, 'YXZ');
    };
    const onUp = (event: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 5 || !['pano-point', 'pano-polygon'].includes(modeRef.current)) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector3(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
        0.5,
      );
      const direction = ndc.unproject(camera).normalize();
      pickRef.current(directionToPanorama(direction));
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (modeRef.current === 'pano-polygon') {
        event.preventDefault();
        finishRef.current();
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + Math.sign(event.deltaY) * 4, 28, 95);
      camera.updateProjectionMatrix();
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      sphereGeometry.dispose();
      (sphere.material as THREE.Material).dispose();
      renderer.dispose();
      element.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    const loader = new THREE.TextureLoader();
    let active = true;
    loader.load(imageUrl, (texture) => {
      if (!active) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      const previous = view.sphere.material as THREE.MeshBasicMaterial;
      if (previous.map) previous.map.dispose();
      previous.map = texture;
      previous.color.set('#ffffff');
      previous.needsUpdate = true;
    });
    return () => { active = false; };
  }, [imageUrl]);

  useEffect(() => {
    const view = state.current;
    if (!view || !focus) return;
    const direction = panoramaToDirection(focus.uv);
    view.yaw = -Math.atan2(direction.x, -direction.z);
    view.pitch = Math.asin(direction.y);
    view.camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
  }, [focus]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    view.annotations.clear();
    const dot = (uv: UV, color: string, radius = 0.17) => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      marker.position.copy(spherePoint(uv));
      marker.renderOrder = 5;
      view.annotations.add(marker);
    };
    const line = (vertices: UV[], color: string, close = false) => {
      if (vertices.length < 2) return;
      const points = [...vertices, ...(close ? [vertices[0]] : [])].map((uv) => spherePoint(uv));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color, depthTest: false });
      const shape = new THREE.Line(geometry, material);
      shape.renderOrder = 4;
      view.annotations.add(shape);
    };
    for (const annotation of [...annotations, ...previewAnnotations]) {
      if (!annotation.visible) continue;
      const preview = previewAnnotations.includes(annotation);
      const color = preview ? '#c3a4ff' : classes.find((item) => item.id === annotation.classId)?.color ?? '#ffffff';
      if (annotation.panorama?.kind === 'point') dot(annotation.panorama.uv, color, annotation.id === selectedId ? 0.26 : 0.16);
      if (annotation.panorama?.kind === 'polygon') {
        line(annotation.panorama.vertices, color, true);
        for (const uv of annotation.panorama.vertices) dot(uv, color, 0.1);
      }
      if (annotation.pointCloud && !annotation.panorama) dot(pointToPanorama(annotation.pointCloud.center, registration), preview ? '#c3a4ff' : '#ffffff', 0.12);
    }
    if (draftVertices.length) {
      line(draftVertices, '#ffd37d');
      for (const uv of draftVertices) dot(uv, '#ffd37d', 0.11);
    }
  }, [annotations, previewAnnotations, classes, selectedId, registration, draftVertices]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (view.projection) {
      view.scene.remove(view.projection);
      view.projection.geometry.dispose();
      (view.projection.material as THREE.Material).dispose();
      view.projection = null;
    }
    if (!showProjection || !cloudGeometry) return;
    const source = cloudGeometry.getAttribute('position');
    const step = Math.max(10, Math.ceil(source.count / 9000));
    const data: number[] = [];
    const origin = new THREE.Vector3(...registration.position);
    const inverse = registrationQuaternion(registration).invert();
    for (let i = 0; i < source.count; i += step) {
      const position = new THREE.Vector3().fromBufferAttribute(source, i).sub(origin);
      if (position.lengthSq() < 1) continue;
      position.applyQuaternion(inverse).normalize().multiplyScalar(19.65);
      data.push(position.x, position.y, position.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
    const material = new THREE.PointsMaterial({ color: '#65e2ff', size: 2.8, sizeAttenuation: false, transparent: true, opacity: 0.58, depthTest: false });
    view.projection = new THREE.Points(geometry, material);
    view.projection.renderOrder = 3;
    view.scene.add(view.projection);
  }, [cloudGeometry, registration, showProjection]);

  return <div ref={host} className={`viewer-canvas panorama-view ${tool.startsWith('pano') ? 'crosshair' : ''}`} aria-label="360度全景影像视图" />;
}
