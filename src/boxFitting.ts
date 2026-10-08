import * as THREE from 'three';
import type { Cuboid, Vec3 } from './types';

export interface ScreenRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function percentile(values: number[], fraction: number): number {
  values.sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * fraction)));
  return values[index];
}

/**
 * Fit an upright box to points inside a screen rectangle. The horizontal PCA
 * gives an initial yaw; trimmed bounds reduce the influence of stray returns.
 * This is deliberately a local browser heuristic, not a sensor-level fit.
 */
export function fitCuboidFromScreenRect(
  geometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  rect: ScreenRect,
): Cuboid | null {
  const positions = geometry.getAttribute('position');
  if (!positions) return null;
  const samples: Vec3[] = [];
  const point = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const step = Math.max(1, Math.floor(positions.count / 300_000));
  camera.updateMatrixWorld();
  for (let i = 0; i < positions.count; i += step) {
    point.fromBufferAttribute(positions, i);
    projected.copy(point).project(camera);
    if (projected.z < -1 || projected.z > 1 || projected.x < rect.minX || projected.x > rect.maxX ||
      projected.y < rect.minY || projected.y > rect.maxY) continue;
    samples.push([point.x, point.y, point.z]);
  }
  if (samples.length < 12) return null;

  let meanX = 0;
  let meanZ = 0;
  for (const [x, , z] of samples) { meanX += x; meanZ += z; }
  meanX /= samples.length;
  meanZ /= samples.length;
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const [x, , z] of samples) {
    const dx = x - meanX;
    const dz = z - meanZ;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }
  const spread = Math.hypot(xx - zz, 2 * xz) / Math.max(1e-9, xx + zz);
  const yaw = spread > 0.12 ? -0.5 * Math.atan2(2 * xz, xx - zz) : 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const localX: number[] = [];
  const localY: number[] = [];
  const localZ: number[] = [];
  for (const [x, y, z] of samples) {
    const dx = x - meanX;
    const dz = z - meanZ;
    localX.push(cosine * dx - sine * dz);
    localY.push(y);
    localZ.push(sine * dx + cosine * dz);
  }
  const x0 = percentile(localX, 0.02);
  const x1 = percentile(localX, 0.98);
  const y0 = percentile(localY, 0.02);
  const y1 = percentile(localY, 0.98);
  const z0 = percentile(localZ, 0.02);
  const z1 = percentile(localZ, 0.98);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return {
    kind: 'cuboid',
    center: [meanX + cosine * cx + sine * cz, (y0 + y1) / 2, meanZ - sine * cx + cosine * cz],
    size: [Math.max(0.15, x1 - x0 + 0.15), Math.max(0.15, y1 - y0 + 0.15), Math.max(0.15, z1 - z0 + 0.15)],
    yaw: Number(THREE.MathUtils.radToDeg(yaw).toFixed(2)),
  };
}

export function pointInCuboid(x: number, y: number, z: number, box: Cuboid): boolean {
  const yaw = THREE.MathUtils.degToRad(box.yaw ?? 0);
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const dx = x - box.center[0];
  const dz = z - box.center[2];
  const localX = cosine * dx - sine * dz;
  const localZ = sine * dx + cosine * dz;
  return Math.abs(localX) <= box.size[0] / 2 &&
    Math.abs(y - box.center[1]) <= box.size[1] / 2 &&
    Math.abs(localZ) <= box.size[2] / 2;
}

export function countPointsInCuboid(geometry: THREE.BufferGeometry | null, box: Cuboid): number {
  const positions = geometry?.getAttribute('position');
  if (!positions) return 0;
  let count = 0;
  for (let i = 0; i < positions.count; i++) {
    if (pointInCuboid(positions.getX(i), positions.getY(i), positions.getZ(i), box)) count++;
  }
  return count;
}
