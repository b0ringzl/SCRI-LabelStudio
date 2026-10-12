import type {
  DistillationDatasetCreateV1, DistillationDatasetV1, DistillationImageSetV1,
  DistillationJobCreateV1, DistillationJobV1,
} from './distillationContract';
import { normalizeEndpoint } from './modelRegistry';

function serviceRoot(endpoint: string): string {
  const root = normalizeEndpoint(endpoint);
  const url = new URL(root);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('蒸馏训练服务须使用 HTTPS，或运行在本机');
  }
  return root;
}

async function requestJson(root: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${root}${path}`, { ...init, signal, credentials: 'same-origin' });
  if (!response.ok) {
    let detail = '';
    try { detail = String((await response.json() as { error?: { message?: string } }).error?.message ?? ''); }
    catch { /* Keep the HTTP status when the service did not return JSON. */ }
    throw new Error(`训练服务 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return response.json() as Promise<unknown>;
}

function datasetResponse(value: unknown): DistillationDatasetV1 {
  if (!value || typeof value !== 'object' ||
    (value as Partial<DistillationDatasetV1>).schemaVersion !== '1.0' ||
    typeof (value as Partial<DistillationDatasetV1>).datasetId !== 'string' ||
    !['validating', 'ready', 'rejected'].includes(String((value as Partial<DistillationDatasetV1>).state))) {
    throw new Error('训练服务返回了无效的数据集响应');
  }
  return value as DistillationDatasetV1;
}

function imageSetResponse(value: unknown): DistillationImageSetV1 {
  if (!value || typeof value !== 'object' ||
    (value as Partial<DistillationImageSetV1>).schemaVersion !== '1.0' ||
    typeof (value as Partial<DistillationImageSetV1>).imageSetId !== 'string' ||
    !['validating', 'ready', 'rejected'].includes(String((value as Partial<DistillationImageSetV1>).state))) {
    throw new Error('训练服务返回了无效的影像集响应');
  }
  return value as DistillationImageSetV1;
}

function jobResponse(value: unknown): DistillationJobV1 {
  if (!value || typeof value !== 'object' ||
    (value as Partial<DistillationJobV1>).schemaVersion !== '1.0' ||
    typeof (value as Partial<DistillationJobV1>).jobId !== 'string' ||
    !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(String((value as Partial<DistillationJobV1>).state))) {
    throw new Error('训练服务返回了无效的任务响应');
  }
  return value as DistillationJobV1;
}

export function createDistillationClient(endpoint: string) {
  const root = serviceRoot(endpoint);
  return {
    async uploadImageSet(archive: File, idempotencyKey: string,
      signal?: AbortSignal): Promise<DistillationImageSetV1> {
      if (!idempotencyKey.trim()) throw new Error('上传影像集需要幂等键');
      const body = new FormData();
      body.append('file', archive);
      return imageSetResponse(await requestJson(root, '/v1/distillation/image-sets', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body,
      }, signal));
    },
    async getImageSet(imageSetId: string, signal?: AbortSignal): Promise<DistillationImageSetV1> {
      return imageSetResponse(await requestJson(root,
        `/v1/distillation/image-sets/${encodeURIComponent(imageSetId)}`, { method: 'GET' }, signal));
    },
    async registerDataset(request: DistillationDatasetCreateV1, signal?: AbortSignal): Promise<DistillationDatasetV1> {
      return datasetResponse(await requestJson(root, '/v1/distillation/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      }, signal));
    },
    async getDataset(datasetId: string, signal?: AbortSignal): Promise<DistillationDatasetV1> {
      return datasetResponse(await requestJson(root,
        `/v1/distillation/datasets/${encodeURIComponent(datasetId)}`, { method: 'GET' }, signal));
    },
    async createJob(request: DistillationJobCreateV1, idempotencyKey: string,
      signal?: AbortSignal): Promise<DistillationJobV1> {
      if (!idempotencyKey.trim()) throw new Error('创建训练任务需要幂等键');
      return jobResponse(await requestJson(root, '/v1/distillation/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(request),
      }, signal));
    },
    async getJob(jobId: string, signal?: AbortSignal): Promise<DistillationJobV1> {
      return jobResponse(await requestJson(root,
        `/v1/distillation/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal));
    },
    async cancelJob(jobId: string, signal?: AbortSignal): Promise<DistillationJobV1> {
      return jobResponse(await requestJson(root,
        `/v1/distillation/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }, signal));
    },
  };
}
