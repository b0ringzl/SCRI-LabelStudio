/** Local protocol fixture for testing model switching. No files are saved. */
import { createServer } from 'node:http';

const port = Number(process.env.ATLAS_MOCK_MODEL_PORT ?? 43251);
const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  const route = request.url ?? '';
  if (request.method !== 'POST' || !/^\/(image-a|image-b|paired)\/(assets|predict)$/.test(route)) {
    response.writeHead(404); response.end(); return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (route.endsWith('/assets')) {
    response.end(JSON.stringify({ assetId: `mock-${Date.now()}` }));
    return;
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (route.startsWith('/paired/')) {
    response.end(JSON.stringify({ schemaVersion: '0.2', modelVersion: 'mock-paired-1',
      annotations: [{ id: 'mock-object', classId: body.classes[0]?.id, name: '模拟候选框', visible: true,
        origin: 'prediction', confidence: 0.87,
        pointCloud: { kind: 'cuboid', center: [0, 1, -5], size: [1, 1, 1], yaw: 0 },
        panorama: { kind: 'point', uv: [0.5, 0.45] } }],
      semanticPointLabels: [{ pointIndex: 0, classId: body.classes[0]?.id, confidence: 0.76 }] }));
    return;
  }
  response.end(JSON.stringify({ schemaVersion: '1.0', modelVersion: route.startsWith('/image-a/') ? 'mock-image-a-1' : 'mock-image-b-1',
    boxes: route.startsWith('/image-a/')
      ? [{ classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.91 }]
      : [{ classId: 2, x: 0.35, y: 0.6, w: 0.3, h: 0.15, confidence: 0.83 }] }));
});

server.listen(port, '127.0.0.1', () => console.log(`模拟模型服务：http://127.0.0.1:${port}/image-a`));
