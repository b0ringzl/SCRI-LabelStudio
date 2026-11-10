import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = join(root, 'scripts', 'depth_worker.py');
let busy = false;
let cachedStatus = null;
function pythonPath() {
  if (process.env.ATLAS_DEPTH_PYTHON?.trim()) return process.env.ATLAS_DEPTH_PYTHON.trim();
  const environment = join(root, '.venv-da2');
  const conda = join(environment, process.platform === 'win32' ? 'python.exe' : 'bin/python');
  return existsSync(join(environment, 'conda-meta')) ? conda :
    join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
function send(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function execute(args, payload, response) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [worker, ...args], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1' },
    });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); response?.off('close', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { if (!response.writableFinished) { child.kill(); finish(new Error('深度配准已取消')); } };
    const timer = setTimeout(() => { child.kill(); finish(new Error('DA2 超时，原位姿保留；可降低负载后重试')); }, args.length ? 20000 : 300000);
    response?.once('close', abort);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 4*1024*1024) { child.kill(); finish(new Error('Depth response exceeds limit')); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr+chunk).slice(-4000); });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) { finish(new Error(stderr.trim() || 'DA2 推理未完成')); return; }
      try { finish(null, JSON.parse(stdout)); } catch { finish(new Error('Invalid DA2 response JSON')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(payload ? JSON.stringify(payload) : '');
  });
}
export async function depthStatus() {
  if (!existsSync(pythonPath())) return { configured: false, weightsRequired: true, reason: '请运行 Setup-Depth 安装独立 DA2 环境和权重' };
  if (cachedStatus && cachedStatus.until > Date.now()) return cachedStatus.value;
  let value;
  try { value = await execute(['--check']); }
  catch { value = { configured: false, weightsRequired: true, reason: 'DA2 依赖未就绪，请运行 Setup-Depth' }; }
  cachedStatus = { value, until: Date.now() + (value.configured ? 30000 : 3000) };
  return value;
}
export function validateDepthRequest(body) {
  const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e8);
  if (!body || body.schemaVersion !== 'registration-depth/1.0' ||
      typeof body.frameId !== 'string' || !body.frameId || body.frameId.length > 256 ||
      !body.prior || !vector(body.prior.position, 3) || !vector(body.prior.rotation, 3) ||
      typeof body.imageDataUrl !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.imageDataUrl) ||
      !Array.isArray(body.points) || body.points.length < 1000 || body.points.length > 40000 ||
      body.points.some(point => !vector(point, 3)))
    throw new Error('深度配准需要粗位姿、2:1 全景及 1000–40000 个有效 XYZ 点；不要求强度或颜色');
  return body;
}
export async function handleDepth(request, response) {
  if (request.method === 'GET') { send(response, 200, await depthStatus()); return; }
  if (request.method !== 'POST') { response.writeHead(405, { Allow: 'GET, POST' }); response.end(); return; }
  const host = request.headers.host ?? '';
  if (!/^127\.0\.0\.1:\d+$/.test(host) || request.headers.origin !== `http://${host}`) {
    send(response, 403, { error: '仅允许本机同源请求' }); return;
  }
  if (busy) { send(response, 409, { error: 'DA2 正在处理另一帧，请稍后重试' }); return; }
  busy = true;
  try {
    if (!existsSync(pythonPath())) { send(response, 503, { error: '请先运行 Setup-Depth 启动器' }); return; }
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 12*1024*1024) throw new Error('深度请求超过 12 MiB');
      chunks.push(chunk);
    }
    const body = validateDepthRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    send(response, 200, await execute([], body, response));
  } catch (error) { send(response, 422, { error: error instanceof Error ? error.message : 'DA2 推理失败' }); }
  finally { busy = false; }
}
