import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleLlmPredict } from './llmGateway.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

const seen = [];
const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  seen.push({ model: body.model, key: request.headers.authorization, image: body.messages[1].content[1].image_url.url });
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: body.model === 'qwen-bad'
    ? '{"boxes":[{"classId":"unknown","x":0.5,"y":0.5,"w":0.2,"h":0.2}]}'
    : '{"boxes":[{"classId":"sign","x":0.5,"y":0.5,"w":0.2,"h":0.2}]}' } }] }));
});
const gateway = createServer((request, response) => { void handleLlmPredict(request, response); });
try {
  const upstreamPort = await listen(upstream);
  const gatewayPort = await listen(gateway);
  process.env.ATLAS_LLM_ALLOW_LOCAL_HTTP = '1';
  process.env.ATLAS_LLM_BASE_URL = `http://127.0.0.1:${upstreamPort}/v1`;
  process.env.ATLAS_DEEPSEEK_BASE_URL = `http://127.0.0.1:${upstreamPort}/v1`;
  process.env.DASHSCOPE_API_KEY = 'qwen-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.ATLAS_LLM_MODELS = 'qwen3-vl-plus,qwen-bad';
  process.env.ATLAS_DEEPSEEK_MODELS = 'deepseek-flash';
  const origin = `http://127.0.0.1:${gatewayPort}`;
  async function predict(provider, modelName, requestOrigin = origin) {
    const response = await fetch(`${origin}/api/llm/predict`, {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, modelName, kind: 'image2d',
        imageDataUrl: 'data:image/jpeg;base64,aGVsbG8=', classes: [{ id: 'sign', name: '标志' }] }),
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await predict('qwen', 'qwen3-vl-plus')).body.boxes.length, 1);
  assert.equal((await predict('deepseek', 'deepseek-flash')).body.boxes.length, 1);
  assert.deepEqual(seen.map((item) => [item.model, item.key]), [
    ['qwen3-vl-plus', 'Bearer qwen-test-key'], ['deepseek-flash', 'Bearer deepseek-test-key'],
  ]);
  assert.ok(seen.every((item) => item.image.startsWith('data:image/jpeg;base64,')));
  assert.equal((await predict('deepseek', 'qwen3-vl-plus')).status, 400);
  assert.equal((await predict('qwen', 'qwen-bad')).status, 502);
  assert.equal((await predict('qwen', 'qwen3-vl-plus', 'http://example.invalid')).status, 403);
  assert.equal(seen.length, 3);
  process.stdout.write('LLM gateway: Qwen, DeepSeek, key isolation, invalid output and origin checks passed.\n');
} finally {
  upstream.close();
  gateway.close();
}
