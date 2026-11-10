import * as THREE from 'three';
import { pointToPanorama } from './geometry';
import type { Registration, Vec3 } from './types';

export interface YawEstimate { yawDeg: number; currentScore: number; bestScore: number; margin: number; sampleCount: number }

export function hasUsableRgb(cloud: THREE.BufferGeometry | null): boolean {
  if (cloud?.userData?.generatedColors) return false;
  const colors = cloud?.getAttribute('sourceColor') ?? cloud?.getAttribute('color');
  const positions = cloud?.getAttribute('position');
  if (!colors || !positions || colors.count !== positions.count) return false;
  const stride = Math.max(1, Math.floor(colors.count / 3000));
  let chromatic = 0;
  for (let i = 0; i < colors.count; i += stride) {
    const channels = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    if (channels.every(Number.isFinite) && Math.max(...channels) - Math.min(...channels) > 0.08) chromatic++;
  }
  return chromatic >= 100;
}

export async function estimatePanoramaYaw(cloud: THREE.BufferGeometry, imageUrl: string, initial: Registration): Promise<YawEstimate> {
  const positions = cloud.getAttribute('position');
  const colors = cloud.getAttribute('sourceColor') ?? cloud.getAttribute('color');
  if (!positions || !colors || !hasUsableRgb(cloud)) throw new Error('自动朝向估计需要足够的有效 RGB 彩色点');
  const image = new Image();
  image.src = imageUrl;
  await image.decode();
  const width = 1024, height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法读取全景图像像素');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const stride = Math.max(1, Math.floor(positions.count / 5000));
  const samples: Array<{ point: Vec3; color: Vec3; depth: number }> = [];
  for (let i = 0; i < positions.count; i += stride) {
    const point: Vec3 = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    const color: Vec3 = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    const depth = Math.hypot(point[0] - initial.position[0], point[1] - initial.position[1], point[2] - initial.position[2]);
    if (point.every(Number.isFinite) && color.every(Number.isFinite) && depth > 1 && depth < 100 &&
      Math.max(...color) <= 1.01 && Math.max(...color) - Math.min(...color) > 0.08)
      samples.push({ point, color, depth });
  }
  if (samples.length < 100) throw new Error('有效彩色点不足 100 个，无法可靠估计朝向');
  const score = (offset: number) => {
    const pose: Registration = { ...initial, rotation: [initial.rotation[0] + offset, initial.rotation[1], initial.rotation[2]] };
    const visible = new Map<number, { depth: number; color: Vec3 }>();
    for (const sample of samples) {
      const [u, v] = pointToPanorama(sample.point, pose);
      const x = Math.min(width - 1, Math.floor(u * width));
      const y = Math.max(0, Math.min(height - 1, Math.floor(v * height)));
      const index = y * width + x;
      const previous = visible.get(index);
      if (!previous || sample.depth < previous.depth) visible.set(index, { depth: sample.depth, color: sample.color });
    }
    if (visible.size < 80) return Infinity;
    let error = 0, count = 0;
    for (const [index, sample] of visible) {
      const source = sample.color;
      const target: Vec3 = [pixels[index * 4] / 255, pixels[index * 4 + 1] / 255, pixels[index * 4 + 2] / 255];
      const sTotal = source[0] + source[1] + source[2] + 0.05;
      const tTotal = target[0] + target[1] + target[2] + 0.05;
      error += (Math.abs(source[0] / sTotal - target[0] / tTotal) +
        Math.abs(source[1] / sTotal - target[1] / tTotal) +
        Math.abs(source[2] / sTotal - target[2] / tTotal)) / 3;
      count++;
    }
    return error / count;
  };
  const candidates = new Map<number, number>();
  for (let offset = -180; offset < 180; offset += 10) candidates.set(offset, score(offset));
  const coarse = [...candidates].sort((a, b) => a[1] - b[1])[0][0];
  for (let offset = coarse - 10; offset <= coarse + 10; offset += 2) candidates.set(offset, score(offset));
  const refine = [...candidates].sort((a, b) => a[1] - b[1])[0][0];
  for (let offset = refine - 2; offset <= refine + 2; offset++) candidates.set(offset, score(offset));
  const ranked = [...candidates].sort((a, b) => a[1] - b[1]);
  const best = ranked[0];
  const distant = ranked.find(([offset]) => Math.abs(offset - best[0]) > 20) ?? ranked.at(-1)!;
  const currentScore = score(0);
  if (!Number.isFinite(best[1])) throw new Error('彩色点投影覆盖不足，无法估计朝向');
  return { yawDeg: THREE.MathUtils.euclideanModulo(initial.rotation[0] + best[0] + 180, 360) - 180,
    currentScore, bestScore: best[1], margin: (distant[1] - best[1]) / Math.max(distant[1], 1e-6), sampleCount: samples.length };
}
