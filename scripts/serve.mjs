import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleLlmPredict } from './llmGateway.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const projectRoot = resolve(root, '..');
const host = '127.0.0.1';
const argumentsList = process.argv.slice(2);
const noOpen = argumentsList.includes('--no-open');
const portFlag = argumentsList.indexOf('--port');
const requestedPort = portFlag >= 0 ? Number(argumentsList[portFlag + 1]) : Number(process.env.ATLAS_STUDIO_PORT ?? 43127);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pcd': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  '.ico': 'image/x-icon',
};

async function findReviewDataRoot() {
  let configured = process.env.ATLAS_REVIEW_DATA_DIR;
  if (!configured) {
    try {
      const settings = JSON.parse(await readFile(join(projectRoot, '.atlas-local-data.json'), 'utf8'));
      configured = settings.reviewDataDir;
    } catch { /* Folder import remains available without local configuration. */ }
  }
  if (typeof configured !== 'string' || !configured.trim()) return null;
  const directory = resolve(configured);
  try {
    if (!(await stat(join(directory, 'images'))).isDirectory() ||
        !(await stat(join(directory, 'labels'))).isDirectory() ||
        !(await stat(join(directory, 'class.txt'))).isFile()) return null;
    return directory;
  } catch { return null; }
}

const reviewDataRoot = await findReviewDataRoot();

async function serveReviewManifest(request, response) {
  if (!reviewDataRoot) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const classes = (await readFile(join(reviewDataRoot, 'class.txt'), 'utf8')).trim().split(/\r?\n/);
    const names = (await readdir(join(reviewDataRoot, 'images')))
      .filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
    const items = await Promise.all(names.map(async (name) => {
      const stem = name.replace(/\.[^.]+$/, '');
      let labelText = '';
      try { labelText = await readFile(join(reviewDataRoot, 'labels', `${stem}.txt`), 'utf8'); }
      catch { /* Missing label files are shown as empty tasks. */ }
      return { name, imageUrl: `/api/review-image/${encodeURIComponent(name)}`, labelText };
    }));
    const body = JSON.stringify({ datasetId: basename(reviewDataRoot), classes, items });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500); response.end();
  }
}

async function serveReviewImage(request, response, pathname) {
  if (!reviewDataRoot) { response.writeHead(404); response.end(); return; }
  const name = pathname.slice('/api/review-image/'.length);
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' ||
      !/\.(jpe?g|png)$/i.test(name)) { response.writeHead(400); response.end(); return; }
  const file = join(reviewDataRoot, 'images', name);
  try { if (!(await stat(file)).isFile()) throw new Error('missing'); }
  catch { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()], 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error('无效端口。请使用 --port 1..65535 或 ATLAS_STUDIO_PORT。');
  process.exit(1);
}

try {
  const index = await stat(join(root, 'index.html'));
  if (!index.isFile()) throw new Error('index.html is not a file');
} catch {
  console.error(`未找到构建结果：${root}\n请先执行 npm run build。`);
  process.exit(1);
}

async function serveFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}`).pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (pathname.includes('\0')) {
    response.writeHead(400);
    response.end();
    return;
  }
  if (pathname === '/api/review-manifest') {
    await serveReviewManifest(request, response);
    return;
  }
  if (pathname === '/api/llm/predict') {
    await handleLlmPredict(request, response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  if (pathname.startsWith('/api/review-image/')) {
    await serveReviewImage(request, response, pathname);
    return;
  }
  const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const subpath = relative(root, target);
  if (subpath.startsWith('..') || isAbsolute(subpath)) {
    response.writeHead(403);
    response.end();
    return;
  }
  let file = target;
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    if (extname(pathname)) {
      response.writeHead(404);
      response.end();
      return;
    }
    file = join(root, 'index.html');
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`请手动打开 ${url}`));
  child.unref();
}

function listen(port) {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer((request, response) => { void serveFile(request, response); });
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.removeAllListeners('error');
      resolveListen(server);
    });
  });
}

let server;
let usedPort;
for (const port of [...Array.from({ length: 11 }, (_, index) => requestedPort + index).filter((value) => value <= 65535), 0]) {
  try {
    server = await listen(port);
    usedPort = server.address().port;
    break;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
  }
}

const url = `http://${host}:${usedPort}/`;
console.log(`Atlas Studio 已启动：${url}`);
if (reviewDataRoot) console.log('本地道路设施复核数据集已就绪。');
console.log('仅本机可访问；按 Ctrl+C 停止。');
if (!noOpen) openBrowser(url);
