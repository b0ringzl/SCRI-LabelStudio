export type ModelModality = 'image2d' | 'paired3d';
export type ModelAdapterId = 'atlas-image-v1' | 'atlas-paired-v0.2' | 'qwen-vl-v1' | 'deepseek-vision-v1';

export interface ModelProfile {
  id: string;
  name: string;
  modality: ModelModality;
  adapter: ModelAdapterId;
  endpoint: string;
  modelName?: string;
}

export const MODEL_STORAGE_KEY = 'atlas-model-profiles-v1';
export const MODEL_SELECTION_KEY = 'atlas-selected-models-v1';

export function adapterFor(modality: ModelModality): ModelAdapterId {
  return modality === 'image2d' ? 'atlas-image-v1' : 'atlas-paired-v0.2';
}

export function supportsAdapter(modality: ModelModality, adapter: ModelAdapterId): boolean {
  return adapter === adapterFor(modality) || adapter === 'qwen-vl-v1' || adapter === 'deepseek-vision-v1';
}

export function normalizeEndpoint(value: string): string {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('请填写不含账号、查询参数或锚点的 HTTP(S) 服务根地址');
  }
  return parsed.href.replace(/\/+$/, '');
}

export function loadModelProfiles(): ModelProfile[] {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!stored) {
      const legacy = localStorage.getItem('atlas-model-endpoint');
      if (legacy) return [{ id: 'legacy-http', name: '原有 HTTP 服务', modality: 'paired3d',
        adapter: 'atlas-paired-v0.2', endpoint: normalizeEndpoint(legacy) }];
    }
    const saved = JSON.parse(stored ?? '[]') as unknown;
    if (Array.isArray(saved)) return saved.filter((item): item is ModelProfile => {
      if (!item || typeof item !== 'object') return false;
      const profile = item as Partial<ModelProfile>;
      return typeof profile.id === 'string' && typeof profile.name === 'string' &&
        typeof profile.endpoint === 'string' &&
        (profile.modality === 'image2d' || profile.modality === 'paired3d') &&
        typeof profile.adapter === 'string' && supportsAdapter(profile.modality, profile.adapter) &&
        (!['qwen-vl-v1', 'deepseek-vision-v1'].includes(profile.adapter) || typeof profile.modelName === 'string');
    });
  } catch { /* Ignore stale settings. */ }
  return [];
}

export function loadModelSelection(): Record<ModelModality, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_SELECTION_KEY) ?? '{}') as Record<string, unknown>;
    return { image2d: typeof saved.image2d === 'string' ? saved.image2d : '',
      paired3d: typeof saved.paired3d === 'string' ? saved.paired3d : localStorage.getItem('atlas-model-endpoint') ? 'legacy-http' : '' };
  } catch { return { image2d: '', paired3d: '' }; }
}
