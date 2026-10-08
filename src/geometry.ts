import * as THREE from 'three';
import type { Registration, UV, Vec3 } from './types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function registrationQuaternion(registration: Registration) {
  const [yaw, pitch, roll] = registration.rotation.map((v) => THREE.MathUtils.degToRad(v));
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
}

export function pointToPanorama(point: Vec3, registration: Registration): UV {
  const local = new THREE.Vector3(...point)
    .sub(new THREE.Vector3(...registration.position))
    .applyQuaternion(registrationQuaternion(registration).invert())
    .normalize();
  const u = ((0.5 + Math.atan2(local.x, -local.z) / (Math.PI * 2)) % 1 + 1) % 1;
  const v = 0.5 - Math.asin(clamp(local.y, -1, 1)) / Math.PI;
  return [u, v];
}

export function panoramaToDirection([u, v]: UV): THREE.Vector3 {
  const azimuth = (u - 0.5) * Math.PI * 2;
  const elevation = (0.5 - v) * Math.PI;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  );
}

export function panoramaToWorldDirection(uv: UV, registration: Registration) {
  return panoramaToDirection(uv).applyQuaternion(registrationQuaternion(registration));
}

export function directionToPanorama(direction: THREE.Vector3): UV {
  const d = direction.clone().normalize();
  return [
    ((0.5 + Math.atan2(d.x, -d.z) / (Math.PI * 2)) % 1 + 1) % 1,
    0.5 - Math.asin(clamp(d.y, -1, 1)) / Math.PI,
  ];
}

export function nearestPointOnRay(geometry: THREE.BufferGeometry, origin: Vec3, direction: THREE.Vector3) {
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const o = new THREE.Vector3(...origin);
  const p = new THREE.Vector3();
  let bestDistance = Infinity;
  let best: Vec3 | null = null;
  const step = Math.max(1, Math.floor(position.count / 250_000));
  for (let i = 0; i < position.count; i += step) {
    p.fromBufferAttribute(position, i);
    const relative = p.clone().sub(o);
    const depth = relative.dot(direction);
    if (depth < 0.1) continue;
    const distance = relative.addScaledVector(direction, -depth).lengthSq();
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [p.x, p.y, p.z];
    }
  }
  return bestDistance < 2.25 ? best : null;
}
