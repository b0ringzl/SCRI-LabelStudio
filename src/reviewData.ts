export const ROAD_CLASSES = [
  { id: 'sign', label: '交通标志', color: '#7c68e8', hint: '其他交通标志牌' },
  { id: 'sign_s', label: '街道名称牌', color: '#e8a548', hint: '黑白街名牌' },
  { id: 'fence', label: '行人围栏', color: '#32ae9c', hint: '行人隔离铁栏、道路中央网状铁栏' },
  { id: 'sign_p', label: '人形指示牌', color: '#dd6a9a', hint: '交通指示牌，通常带人形符号' },
  { id: 'fence_v', label: '车辆围栏', color: '#5c93db', hint: '石质、连续铁质或临时红白围栏' },
  { id: 'sign_d', label: '车辆引导牌', color: '#d27f5d', hint: '蓝色或绿色大型车牌' },
  { id: 'pole', label: '标志牌杆', color: '#a2aa59', hint: '只标交通标志牌的主杆' },
] as const;

export interface ReviewBox {
  id: string;
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  origin: 'prediction' | 'manual';
  confidence?: number;
  modelId?: string;
  modelVersion?: string;
}

export interface ReviewTask {
  name: string;
  imageUrl?: string;
  file?: File;
  boxes: ReviewBox[];
  reviewed: boolean;
}

export interface ReviewManifest {
  datasetId: string;
  classes: string[];
  items: Array<{ name: string; imageUrl: string; labelText: string }>;
}

export function parseYolo(text: string, imageName: string): { boxes: ReviewBox[]; invalidLines: number } {
  const boxes: ReviewBox[] = [];
  let invalidLines = 0;
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const parts = line.trim().split(/\s+/).map(Number);
    const [classId, x, y, w, h] = parts;
    if (parts.length !== 5 || parts.some((value) => !Number.isFinite(value)) ||
      !Number.isInteger(classId) || classId < 0 || classId >= ROAD_CLASSES.length ||
      x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
      invalidLines += 1;
      return;
    }
    boxes.push({ id: `${imageName}:${index}`, classId, x, y, w, h, origin: 'prediction' });
  });
  return { boxes, invalidLines };
}

export function serializeYolo(boxes: ReviewBox[]): string {
  return boxes.map(({ classId, x, y, w, h }) =>
    `${classId} ${x.toFixed(6)} ${y.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`).join('\n') +
    (boxes.length ? '\n' : '');
}

export function overlap(a: ReviewBox, b: ReviewBox): number {
  const left = Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const top = Math.max(a.y - a.h / 2, b.y - b.h / 2);
  const right = Math.min(a.x + a.w / 2, b.x + b.w / 2);
  const bottom = Math.min(a.y + a.h / 2, b.y + b.h / 2);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union ? intersection / union : 0;
}

export function duplicatePairs(boxes: ReviewBox[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i], boxes[j]) >= 0.85) pairs.push([boxes[i].id, boxes[j].id]);
    }
  }
  return pairs;
}

export function validateClassOrder(classes: string[]): boolean {
  return classes.length === ROAD_CLASSES.length &&
    classes.every((name, index) => name.trim().toLowerCase() === ROAD_CLASSES[index].id);
}
