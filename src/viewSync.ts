import * as THREE from 'three';
import { registrationQuaternion } from './geometry';
import type { Registration } from './types';

export interface Observation { quaternion: THREE.Quaternion; fov: number }

// Both renderers consume a world-space orientation. Calibration is never changed
// by looking around; panorama orientation is transformed into camera-local space.
export class ViewSync {
  private value: Observation = { quaternion: new THREE.Quaternion(), fov: 72 };
  private listeners = new Set<(view: Observation) => void>();
  get snapshot(): Observation { return { quaternion: this.value.quaternion.clone(), fov: this.value.fov }; }
  set(quaternion: THREE.Quaternion, fov = this.value.fov) {
    this.value = { quaternion: quaternion.clone().normalize(), fov: THREE.MathUtils.clamp(fov, 28, 95) };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  subscribe(listener: (view: Observation) => void) {
    this.listeners.add(listener); listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }
}

export function panoramaOrientation(world: THREE.Quaternion, registration: Registration) {
  return registrationQuaternion(registration).invert().multiply(world);
}

export function dragOrientation(start: THREE.Quaternion, dx: number, dy: number, fov: number) {
  const angles = new THREE.Euler().setFromQuaternion(start, 'YXZ');
  const scale = 0.0038 * fov / 72;
  angles.y -= dx * scale;
  angles.x = THREE.MathUtils.clamp(angles.x - dy * scale, -1.48, 1.48);
  return new THREE.Quaternion().setFromEuler(angles);
}

export function recordCamera(element: HTMLElement, camera: THREE.PerspectiveCamera, world = camera.quaternion, position = camera.position.toArray()) {
  // DOM diagnostics also allow end-to-end tests to inspect the cameras actually
  // used for rendering, without a second mock camera implementation.
  element.dataset.viewQuaternion = world.toArray().join(',');
  element.dataset.viewPosition = position.join(',');
  element.dataset.viewFov = String(camera.fov);
}

export function tieMarker(label: string, color = '#ffcd63') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(32, 32, 25, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = '#172033'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 32, 33);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false }));
  sprite.scale.set(.075, .075, 1); sprite.renderOrder = 12;
  return sprite;
}

export function clearTieMarkers(group: THREE.Group) {
  for (const child of group.children) if (child instanceof THREE.Sprite) {
    child.material.map?.dispose(); child.material.dispose();
  }
  group.clear();
}
