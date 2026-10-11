import { ROAD_CLASSES } from './reviewData';
import type { ReviewBox, ReviewTask } from './reviewData';
import type { ModelProfile } from './modelRegistry';

export type TeacherProvider = 'qwen' | 'deepseek' | 'http' | 'unknown';

export interface DistillationLabel {
  id: string;
  classId: string;
  classIndex: number;
  box: [number, number, number, number]; // normalized center x, center y, width, height
  source: {
    kind: 'manual' | 'imported-prediction' | 'model-prediction';
    provider?: TeacherProvider;
    profileId?: string;
    modelName?: string;
    modelVersion?: string;
    originalConfidence?: number;
  };
}

export interface DistillationManifestV1 {
  schemaVersion: '1.0';
  task: 'image-detection';
  datasetId: string;
  exportedAt: string;
  selection: 'reviewed-only';
  coordinates: 'xywh-center-normalized';
  classes: Array<{ index: number; id: string }>;
  samples: Array<{
    imageKey: string; // basename in the image set registered with the training service
    review: 'confirmed';
    labels: DistillationLabel[]; // empty array is a confirmed negative image
  }>;
}

function labelSource(box: ReviewBox, profiles: Map<string, ModelProfile>): DistillationLabel['source'] {
  if (box.origin === 'manual') return { kind: 'manual' };
  if (!box.modelId) return { kind: 'imported-prediction' };
  const profile = profiles.get(box.modelId);
  const provider: TeacherProvider = profile?.adapter === 'qwen-vl-v1' ? 'qwen'
    : profile?.adapter === 'deepseek-vision-v1' ? 'deepseek'
      : profile ? 'http' : 'unknown';
  return {
    kind: 'model-prediction', provider, profileId: box.modelId,
    ...(profile?.modelName ? { modelName: profile.modelName } : {}),
    ...(box.modelVersion ? { modelVersion: box.modelVersion } : {}),
    ...(box.confidence !== undefined ? { originalConfidence: box.confidence } : {}),
  };
}

function checkedBox(box: ReviewBox, imageName: string): [number, number, number, number] {
  const { x, y, w, h, classId } = box;
  const values = [x, y, w, h];
  if (!Number.isInteger(classId) || classId < 0 || classId >= ROAD_CLASSES.length ||
    values.some((value) => !Number.isFinite(value)) || w <= 0 || h <= 0 ||
    x - w / 2 < -1e-6 || x + w / 2 > 1 + 1e-6 ||
    y - h / 2 < -1e-6 || y + h / 2 > 1 + 1e-6 ||
    (box.confidence !== undefined && (!Number.isFinite(box.confidence) ||
      box.confidence < 0 || box.confidence > 1))) {
    throw new Error(`${imageName} 包含越界或无效框，请先修正再导出`);
  }
  return [x, y, w, h];
}

export function buildDistillationManifest(datasetId: string, items: ReviewTask[], profiles: ModelProfile[],
  exportedAt = new Date().toISOString()): DistillationManifestV1 {
  if (!datasetId.trim()) throw new Error('数据集 ID 不能为空');
  const reviewed = items.filter((item) => item.reviewed);
  if (!reviewed.length) throw new Error('请先确认至少一张图片');
  const seen = new Set<string>();
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const samples = reviewed.map((item) => {
    const nameKey = item.name.toLowerCase();
    if (!item.name || item.name.includes('/') || item.name.includes('\\') || seen.has(nameKey)) {
      throw new Error(`图片名称无效或重复：${item.name}`);
    }
    seen.add(nameKey);
    return {
      imageKey: item.name,
      review: 'confirmed' as const,
      labels: item.boxes.map((box): DistillationLabel => ({
        id: box.id,
        classId: ROAD_CLASSES[box.classId]?.id ?? '',
        classIndex: box.classId,
        box: checkedBox(box, item.name),
        source: labelSource(box, profilesById),
      })),
    };
  });
  return {
    schemaVersion: '1.0', task: 'image-detection', datasetId: datasetId.trim(), exportedAt,
    selection: 'reviewed-only', coordinates: 'xywh-center-normalized',
    classes: ROAD_CLASSES.map((entry, index) => ({ index, id: entry.id })), samples,
  };
}
