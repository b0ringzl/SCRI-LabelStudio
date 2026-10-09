const MAX_BODY_BYTES = 10 * 1024 * 1024;

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('当前图片超过 10 MB 请求限制');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseModelOutput(content, allowedClasses) {
  if (typeof content !== 'string') throw new Error('模型没有返回文本 JSON');
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.boxes) || parsed.boxes.length > 100) throw new Error('模型输出缺少 boxes 数组或候选过多');
  const valid = new Set(allowedClasses.map((entry) => entry.id));
  return parsed.boxes.map((box) => {
    if (!box || !valid.has(box.classId) || ![box.x, box.y, box.w, box.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      box.w <= 0 || box.h <= 0 || box.x - box.w / 2 < 0 || box.y - box.h / 2 < 0 ||
      box.x + box.w / 2 > 1 || box.y + box.h / 2 > 1) throw new Error('模型输出包含无效类别或归一化框');
    return { classId: box.classId, x: box.x, y: box.y, w: box.w, h: box.h };
  });
}

export async function handleLlmPredict(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: '仅支持 POST' });
  const host = request.headers.host ?? '';
  const origin = request.headers.origin ?? '';
  if (!/^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) return send(response, 403, { error: '仅允许本机同源请求' });
  try {
    const input = await readBody(request);
    if (!input || typeof input !== 'object' || !['qwen', 'deepseek'].includes(input.provider) ||
      typeof input.imageDataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(input.imageDataUrl) ||
      !Array.isArray(input.classes) || input.classes.length < 1 || input.classes.length > 100 ||
      input.classes.some((entry) => typeof entry?.id !== 'string' || !/^[\w.-]{1,64}$/.test(entry.id) ||
        typeof entry?.name !== 'string' || entry.name.length > 80) ||
      !['image2d', 'panorama'].includes(input.kind)) return send(response, 400, { error: '预测输入无效' });
    const isQwen = input.provider === 'qwen';
    const base = isQwen ? process.env.ATLAS_LLM_BASE_URL : process.env.ATLAS_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const key = isQwen ? process.env.DASHSCOPE_API_KEY || process.env.ATLAS_LLM_API_KEY : process.env.DEEPSEEK_API_KEY;
    const models = (isQwen ? process.env.ATLAS_LLM_MODELS : process.env.ATLAS_DEEPSEEK_MODELS ?? 'deepseek-flash')
      ?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    if (!base || !key || !models.length) return send(response, 503, { error: isQwen
      ? '请设置 ATLAS_LLM_BASE_URL、DASHSCOPE_API_KEY 和 ATLAS_LLM_MODELS'
      : '请设置 DEEPSEEK_API_KEY 与 ATLAS_DEEPSEEK_MODELS' });
    if (!models.includes(input.modelName) ||
      !(isQwen ? /^qwen[\w.-]{1,80}$/i : /^deepseek[\w.-]{1,80}$/i).test(input.modelName))
      return send(response, 400, { error: '模型未在对应提供方的允许列表中' });
    let upstream;
    try {
      upstream = new URL(base.replace(/\/+$/, '') + '/chat/completions');
      if (upstream.username || upstream.password || upstream.search || upstream.hash ||
        (upstream.protocol !== 'https:' && !(process.env.ATLAS_LLM_ALLOW_LOCAL_HTTP === '1' && upstream.protocol === 'http:' && upstream.hostname === '127.0.0.1'))) throw new Error('网关地址必须为 HTTPS');
    } catch { return send(response, 503, { error: '本机 LLM 网关地址配置无效' }); }
    const instruction = `你是建筑组件和标志地物标注助手。只返回一个 JSON 对象，格式为 {"boxes":[{"classId":"类别ID","x":0.5,"y":0.5,"w":0.2,"h":0.2}]}。x/y 是框中心，w/h 是宽高，均归一化到原图 [0,1]，框必须完整落在图内。只使用以下类别 ID：${JSON.stringify(input.classes)}。不确定时返回空 boxes，不要猜测。${input.kind === 'panorama' ? '输入是 2:1 等距柱状全景；只标可见影像区域，不推断点云三维坐标。' : ''}不要输出 Markdown 或其他文字。`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let remote;
    try {
      remote = await fetch(upstream, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: input.modelName, messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: [{ type: 'text', text: '识别图中符合类别表的对象并返回标注候选。' },
            { type: 'image_url', image_url: { url: input.imageDataUrl } }] },
        ] }),
      });
    } finally { clearTimeout(timeout); }
    if (!remote.ok) return send(response, 502, { error: `上游模型服务返回 HTTP ${remote.status}` });
    const result = await remote.json();
    const boxes = parseModelOutput(result?.choices?.[0]?.message?.content, input.classes);
    return send(response, 200, { schemaVersion: '1.0', modelVersion: input.modelName, boxes });
  } catch (error) {
    return send(response, 502, { error: error instanceof SyntaxError ? '模型未返回有效 JSON' :
      error?.name === 'AbortError' ? '模型请求超时' : error?.message ?? '模型请求失败' });
  }
}
