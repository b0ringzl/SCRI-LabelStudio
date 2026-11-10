import * as THREE from 'three';
import { panoramaToDirection, panoramaToWorldDirection, pointToPanorama } from './geometry';
import type { Registration, TargetObservation, TiePoint, UV, Vec3 } from './types';
import { fitSilhouetteTarget } from './panoramaContours';

const finiteVec = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item));

function rigidMatrix(value: unknown): THREE.Matrix4 {
  if (!finiteVec(value, 16)) throw new Error('需要 16 个有限数的行优先 4×4 矩阵');
  const matrix = new THREE.Matrix4().set(...value as Parameters<THREE.Matrix4['set']>);
  const e = matrix.elements;
  if (Math.max(Math.abs(e[3]), Math.abs(e[7]), Math.abs(e[11]), Math.abs(e[15] - 1)) > 1e-5)
    throw new Error('4×4 矩阵末行必须为 [0,0,0,1]');
  const basis = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]), new THREE.Vector3(e[8], e[9], e[10])];
  if (basis.some((axis) => Math.abs(axis.length() - 1) > 0.02) ||
    Math.max(Math.abs(basis[0].dot(basis[1])), Math.abs(basis[0].dot(basis[2])), Math.abs(basis[1].dot(basis[2]))) > 0.02 ||
    matrix.determinant() < 0.95) throw new Error('旋转部分必须是右手正交矩阵，不能含缩放或镜像');
  return matrix;
}

export function registrationFromMatrix(value: unknown): Registration {
  const matrix = rigidMatrix(value);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  const angles = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  return { position: position.toArray() as Vec3,
    rotation: [angles.y, angles.x, angles.z].map(THREE.MathUtils.radToDeg) as Vec3 };
}

export function parsePose(value: unknown): Registration {
  if (!value || typeof value !== 'object') throw new Error('配准参数必须是 JSON 对象');
  const data = value as Record<string, unknown>;
  if (data.registration) return parsePose(data.registration);
  if (data.cameraToCloud) return registrationFromMatrix(data.cameraToCloud);
  if (data.bodyToCloud || data.cameraToBody) {
    const body = rigidMatrix(data.bodyToCloud);
    const camera = rigidMatrix(data.cameraToBody);
    return registrationFromMatrix(matrixRowMajor(body.multiply(camera)));
  }
  if (finiteVec(data.rotationMatrixRowMajor, 9) && finiteVec(data.position, 3)) {
    const r = data.rotationMatrixRowMajor, p = data.position;
    return registrationFromMatrix([r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2], 0, 0, 0, 1]);
  }
  if (finiteVec(data.position, 3) && finiteVec(data.rotation, 3))
    return { position: data.position as Vec3, rotation: data.rotation as Vec3 };
  throw new Error('支持 position+rotation、cameraToCloud、rotationMatrixRowMajor+position，或 bodyToCloud+cameraToBody');
}

function matrixRowMajor(matrix: THREE.Matrix4): number[] {
  const e = matrix.elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]];
}

function solveLinear(source: number[][], rhs: number[]): number[] | null {
  const a = source.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < rhs.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < rhs.length; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    if (Math.abs(a[pivot][i]) < 1e-10) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const scale = a[i][i];
    for (let k = i; k <= rhs.length; k++) a[i][k] /= scale;
    for (let j = 0; j < rhs.length; j++) if (j !== i) {
      const factor = a[j][i];
      for (let k = i; k <= rhs.length; k++) a[j][k] -= factor * a[i][k];
    }
  }
  return a.map((row) => row[rhs.length]);
}

function residuals(pose: Registration, pairs: TiePoint[]): number[] {
  return pairs.flatMap((pair) => {
    const projected = panoramaToWorldDirection(pair.uv, pose);
    const actual = new THREE.Vector3(...pair.cloud).sub(new THREE.Vector3(...pose.position)).normalize();
    return [projected.x - actual.x, projected.y - actual.y, projected.z - actual.z];
  });
}

export function solveTiePoints(initial: Registration, pairs: TiePoint[]): { registration: Registration; medianErrorDeg: number; maxErrorDeg: number } {
  if (pairs.length < 4) throw new Error('同一帧至少需要 4 对分布在不同方向的同名点');
  const cloudSpread = new THREE.Box3().setFromPoints(pairs.map((pair) => new THREE.Vector3(...pair.cloud))).getSize(new THREE.Vector3());
  if (cloudSpread.length() < 1) throw new Error('同名点过于集中，无法稳定求解');
  const bearings = pairs.map((pair) => panoramaToDirection(pair.uv));
  let bearingSpan = 0;
  for (let i = 0; i < bearings.length; i++) for (let j = i + 1; j < bearings.length; j++)
    bearingSpan = Math.max(bearingSpan, THREE.MathUtils.radToDeg(bearings[i].angleTo(bearings[j])));
  if (bearingSpan < 8) throw new Error('同名点在影像中分布过窄，请选择不同方向的地物');
  const toPose = (x: number[]): Registration => ({ position: x.slice(0, 3) as Vec3, rotation: x.slice(3, 6) as Vec3 });
  let best: { x: number[]; cost: number } | null = null;
  for (const yawOffset of [0, 180, -90, 90]) {
    let x = [...initial.position, initial.rotation[0] + yawOffset, initial.rotation[1], initial.rotation[2]];
    let damping = 0.01;
    for (let iteration = 0; iteration < 80; iteration++) {
      const base = residuals(toPose(x), pairs);
      const cost = base.reduce((sum, value) => sum + value * value, 0);
      const steps = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
      const jac = steps.map((step, i) => {
        const shifted = [...x]; shifted[i] += step;
        return residuals(toPose(shifted), pairs).map((v, j) => (v - base[j]) / step);
      });
      const normal = jac.map((column, i) => jac.map((other, j) =>
        column.reduce((sum, value, k) => sum + value * other[k], 0) + (i === j ? damping : 0)));
      const rhs = jac.map((column) => -column.reduce((sum, value, k) => sum + value * base[k], 0));
      const delta = solveLinear(normal, rhs);
      if (!delta) break;
      const candidate = x.map((value, i) => value + delta[i]);
      const next = residuals(toPose(candidate), pairs).reduce((sum, value) => sum + value * value, 0);
      if (next < cost) { x = candidate; damping = Math.max(1e-7, damping / 2); }
      else damping = Math.min(1e7, damping * 5);
      if (delta.reduce((sum, value) => sum + value * value, 0) < 1e-10) break;
    }
    const cost = residuals(toPose(x), pairs).reduce((sum, value) => sum + value * value, 0);
    if (!best || cost < best.cost) best = { x, cost };
  }
  if (!best) throw new Error('位姿求解失败');
  const pose = toPose(best.x);
  const errors = pairs.map((pair) => {
    const ray = panoramaToWorldDirection(pair.uv, pose);
    const actual = new THREE.Vector3(...pair.cloud).sub(new THREE.Vector3(...pose.position)).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(ray.dot(actual), -1, 1)));
  }).sort((a, b) => a - b);
  return { registration: pose, medianErrorDeg: errors[Math.floor(errors.length / 2)], maxErrorDeg: errors.at(-1)! };
}

export function rectangleCenter(a: UV, b: UV): UV {
  let delta = b[0] - a[0];
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return [((a[0] + delta / 2) % 1 + 1) % 1, (a[1] + b[1]) / 2];
}

export function triangulateTarget(observations: TargetObservation[], poses: Record<string, Registration>, cloud?: THREE.BufferGeometry | null) {
  const valid = observations.filter((item) => poses[item.frameId]);
  if (valid.length !== observations.length) throw new Error('部分目标框所在帧缺少独立相机位姿');
  if (valid.length < 2) throw new Error('至少需要两张带不同相机位姿的相邻全景');
  const rays = valid.map((item) => ({ origin: new THREE.Vector3(...poses[item.frameId].position),
    direction: panoramaToWorldDirection(item.center, poses[item.frameId]).normalize(), observation: item }));
  let maxAngle = 0;
  let baseline = 0;
  for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) {
    maxAngle = Math.max(maxAngle, THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(Math.abs(rays[i].direction.dot(rays[j].direction)), -1, 1))));
    baseline = Math.max(baseline, rays[i].origin.distanceTo(rays[j].origin));
  }
  if (baseline < 0.1 || maxAngle < 1.5) throw new Error('相机基线或视差过小，请增加不同位置的图像');
  if(valid.some(o=>o.vertices || o.extent==='object')) {
    const fitted=fitSilhouetteTarget(valid,poses,cloud),center=new THREE.Vector3(...fitted.cuboid.center);
    const errors=rays.map(ray=>{const r=center.clone().sub(ray.origin);return r.addScaledVector(ray.direction,-r.dot(ray.direction)).length();}).sort((a,b)=>a-b);
    let nearest=Infinity;const points=cloud!.getAttribute('position'),p=new THREE.Vector3();
    for(let i=0;i<points.count;i++)nearest=Math.min(nearest,p.fromBufferAttribute(points,i).distanceToSquared(center));
    return {...fitted,method:'silhouette' as const,baselineM:baseline,maxRayAngleDeg:maxAngle,medianRayMissM:errors[Math.floor(errors.length/2)],nearestCloudPointM:Math.sqrt(nearest),projectedCenters:valid.map(o=>pointToPanorama(fitted.cuboid.center,poses[o.frameId]))};
  }
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  const rhs = [0, 0, 0];
  for (const ray of rays) {
    const d = ray.direction.toArray(), o = ray.origin.toArray();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const value = (i === j ? 1 : 0) - d[i] * d[j];
      matrix[i][j] += value;
      rhs[i] += value * o[j];
    }
  }
  const solved = solveLinear(matrix, rhs);
  if (!solved) throw new Error('射线几乎平行，无法三角定位');
  const center = new THREE.Vector3(...solved as Vec3);
  const misses = rays.map((ray) => {
    const relative = center.clone().sub(ray.origin);
    const depth = relative.dot(ray.direction);
    return { depth, miss: relative.addScaledVector(ray.direction, -depth).length() };
  });
  if (misses.some((item) => item.depth <= 0)) throw new Error('目标位于某张图像的相机背后，请核查位姿和框');
  const medianMiss = [...misses.map((item) => item.miss)].sort((a, b) => a - b)[Math.floor(misses.length / 2)];
  if (medianMiss > 2) throw new Error(`多视角射线偏差 ${medianMiss.toFixed(2)} m，需先校正配准或目标框`);
  let nearestDistance = Infinity;
  const positions = cloud?.getAttribute('position');
  if (positions) {
    const p = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i);
      const distance = p.distanceToSquared(center);
      if (distance < nearestDistance) nearestDistance = distance;
    }
    nearestDistance = Math.sqrt(nearestDistance);
  }
  const widths = rays.map((ray) => {
    const [u0, v0, u1, v1] = ray.observation.bounds;
    const horizontal = Math.min(Math.abs(u1 - u0), 1 - Math.abs(u1 - u0)) * 2 * Math.PI;
    const vertical = Math.abs(v1 - v0) * Math.PI;
    if (horizontal > Math.PI / 2 || vertical > Math.PI / 2) throw new Error('目标框跨度超过 90°，请拆分或缩小框');
    const depth = center.distanceTo(ray.origin);
    return [2 * depth * Math.tan(horizontal / 2), 2 * depth * Math.tan(vertical / 2)];
  });
  const width = widths.reduce((sum, value) => sum + value[0], 0) / widths.length;
  const height = widths.reduce((sum, value) => sum + value[1], 0) / widths.length;
  const cuboid = { kind: 'cuboid' as const, center: center.toArray() as Vec3,
    size: [Math.max(0.2, width), Math.max(0.2, height), Math.max(0.2, width / 2)] as Vec3, yaw: 0 };
  return { cuboid, baselineM: baseline, maxRayAngleDeg: maxAngle, medianRayMissM: medianMiss,
    nearestCloudPointM: nearestDistance, projectedCenters: valid.map((item) => pointToPanorama(cuboid.center, poses[item.frameId])) };
}
