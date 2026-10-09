import { ROAD_CLASSES } from './reviewData';
import type { PredictionResponse } from './types';
import type { ModelProfile } from './modelRegistry';
import { normalizeEndpoint } from './modelRegistry';
import { requestWithTimeout } from './prelabel';

export interface ImagePredictionBox {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
}

export interface ImagePredictionResponse {
  schemaVersion: '1.0';
  modelVersion?: string;
  boxes: ImagePredictionBox[];
  warnings?: string[];
}

async function checkedJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
  return response.json();
}

export async function runImageModel(profile: ModelProfile, taskId: string, image: Blob, filename: string,
  signal?: AbortSignal): Promise<ImagePredictionResponse> {
  if (profile.modality !== 'image2d' || profile.adapter !== 'atlas-image-v1') throw new Error('模型不支持普通图片任务');
  const endpoint = normalizeEndpoint(profile.endpoint);
  const form = new FormData();
  form.set('kind', 'image');
  form.set('file', image, filename);
  const asset = await checkedJson(await requestWithTimeout(`${endpoint}/assets`, { method: 'POST', body: form }, 300_000, signal), '图片上传') as { assetId?: unknown };
  if (typeof asset.assetId !== 'string' || !asset.assetId) throw new Error('图片上传响应缺少 assetId');
  const raw = await checkedJson(await requestWithTimeout(`${endpoint}/predict`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: '1.0', taskId, imageAssetId: asset.assetId,
      classes: ROAD_CLASSES.map((entry) => entry.id) }),
  }, 120_000, signal), '图片预测') as Partial<ImagePredictionResponse>;
  if (raw.schemaVersion !== '1.0' || !Array.isArray(raw.boxes)) throw new Error('图片模型输出不符合 atlas-image-v1 协议');
  const boxes = raw.boxes.map((box) => {
    if (!box || !Number.isInteger(box.classId) || box.classId < 0 || box.classId >= ROAD_CLASSES.length ||
      ![box.x, box.y, box.w, box.h].every((value) => typeof value === 'number' && Number.isFinite(value)) ||
      box.x < 0 || box.x > 1 || box.y < 0 || box.y > 1 || box.w <= 0 || box.h <= 0 ||
      box.x - box.w / 2 < 0 || box.x + box.w / 2 > 1 || box.y - box.h / 2 < 0 || box.y + box.h / 2 > 1 ||
      (box.confidence !== undefined && (!Number.isFinite(box.confidence) || box.confidence < 0 || box.confidence > 1))) {
      throw new Error('图片模型返回了无效的类别或归一化框');
    }
    return { classId: box.classId, x: box.x, y: box.y, w: box.w, h: box.h, confidence: box.confidence };
  });
  return { schemaVersion: '1.0', boxes, modelVersion: raw.modelVersion,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === 'string') : [] };
}

export function validatePairPrediction(value: PredictionResponse, allowedClasses: string[], pointCount: number): PredictionResponse {
  const validClass = new Set(allowedClasses);
  const finiteVec = (vector: unknown, length: number): vector is number[] =>
    Array.isArray(vector) && vector.length === length && vector.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  if (value.schemaVersion !== '0.2' || !Array.isArray(value.annotations)) throw new Error('点云／全景模型输出不符合 v0.2 协议');
  for (const item of value.annotations) {
    if (!item || typeof item.id !== 'string' || !validClass.has(item.classId) ||
        (!item.pointCloud && !item.panorama) ||
        (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) ||
        (item.pointCloud && (item.pointCloud.kind !== 'cuboid' || !finiteVec(item.pointCloud.center, 3) ||
          !finiteVec(item.pointCloud.size, 3) || item.pointCloud.size.some((n) => n <= 0) ||
          (item.pointCloud.yaw !== undefined && !Number.isFinite(item.pointCloud.yaw)))) ||
        (item.panorama && (item.panorama.kind === 'point'
          ? !finiteVec(item.panorama.uv, 2) || item.panorama.uv.some((n) => n < 0 || n > 1)
          : item.panorama.kind === 'polygon'
            ? !Array.isArray(item.panorama.vertices) || item.panorama.vertices.length < 3 ||
              item.panorama.vertices.some((uv) => !finiteVec(uv, 2) || uv.some((n) => n < 0 || n > 1))
            : true))) throw new Error('点云／全景模型返回了无效类别或坐标');
  }
  if (value.semanticPointLabels && (!Array.isArray(value.semanticPointLabels) ||
      value.semanticPointLabels.some((entry) => !Number.isInteger(entry.pointIndex) ||
        entry.pointIndex < 0 || entry.pointIndex >= pointCount || !validClass.has(entry.classId) ||
        (entry.confidence !== undefined && (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1))))) {
    throw new Error('模型返回了无效的逐点类别或点索引');
  }
  return value;
}
