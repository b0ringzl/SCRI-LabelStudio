import type { PredictionRequest, PredictionResponse } from './types';

/** Interchangeable paired point-cloud/panorama model adapter. */
export interface PrelabelProvider {
  id: string;
  label: string;
  predict(request: PredictionRequest, signal?: AbortSignal): Promise<PredictionResponse>;
}

const PREDICT_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 300_000;

function serviceUrl(endpoint: string, path: string): string {
  const parsed = new URL(endpoint.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('模型服务地址必须是 http(s) URL');
  if (parsed.search || parsed.hash) throw new Error('模型服务根地址不能包含查询参数或锚点');
  return `${parsed.href.replace(/\/+$/, '')}/${path}`;
}

export async function requestWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) controller.abort();
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Upload must happen before predict: browser blob: URLs cannot be read by a server. */
export async function uploadPrelabelAsset(
  endpoint: string,
  file: File,
  kind: 'pointCloud' | 'panorama',
  signal?: AbortSignal,
): Promise<string> {
  const body = new FormData();
  body.set('kind', kind);
  body.set('file', file);
  const response = await requestWithTimeout(serviceUrl(endpoint, 'assets'), { method: 'POST', body }, UPLOAD_TIMEOUT_MS, signal);
  if (!response.ok) throw new Error(`资产上传失败：HTTP ${response.status}`);
  const payload = await response.json() as { assetId?: unknown };
  if (typeof payload.assetId !== 'string' || !payload.assetId) throw new Error('资产上传响应缺少 assetId');
  return payload.assetId;
}

export function createHttpPrelabelProvider(endpoint: string): PrelabelProvider {
  return {
    id: 'http',
    label: endpoint,
    async predict(request, signal) {
      if (request.schemaVersion !== '0.2' || !request.pointCloudAssetId || !request.panoramaAssetId) {
        throw new Error('预标注请求缺少协议版本或已上传的资产 ID');
      }
      const response = await requestWithTimeout(serviceUrl(endpoint, 'predict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }, PREDICT_TIMEOUT_MS, signal);
      if (!response.ok) throw new Error(`预标注接口返回 HTTP ${response.status}`);
      const payload = await response.json() as Partial<PredictionResponse>;
      if (payload.schemaVersion !== '0.2' || !Array.isArray(payload.annotations) ||
        (payload.semanticPointLabels !== undefined && !Array.isArray(payload.semanticPointLabels))) {
        throw new Error('预标注响应格式不符合 v0.2 契约');
      }
      return payload as PredictionResponse;
    },
  };
}
