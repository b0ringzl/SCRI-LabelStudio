import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
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
console.log('仅本机可访问；按 Ctrl+C 停止。');
if (!noOpen) openBrowser(url);
