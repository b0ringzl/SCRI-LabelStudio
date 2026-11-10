import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative } from 'node:path';

export async function createLocalSceneGateway(directory) {
  const root = await realpath(directory);
  async function asset(path) {
    const file = await realpath(path);
    const rel = relative(root, file);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('场景资产必须位于配置的场景目录内');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('场景资产不是普通文件');
    return { file, size: info.size };
  }
  const registrationText = await readFile((await asset(join(root, 'registration.json'))).file, 'utf8');
  const registration = JSON.parse(registrationText);
  if (!Array.isArray(registration.frames) || !registration.frames.length || registration.frames.length > 1000)
    throw new Error('场景 registration.json 需要 1–1000 帧');
  let metadata = {};
  try { metadata = JSON.parse(await readFile((await asset(join(root, 'source-metadata.json'))).file, 'utf8')); } catch { /* Optional. */ }
  const assets = new Map();
  const cloud = await asset(join(root, 'scene-cloud.pcd'));
  if (cloud.size > 150*1024*1024) throw new Error('场景点云超过当前浏览器的 150 MB 上限');
  assets.set('cloud', { ...cloud, mime: 'application/octet-stream' });
  const names = new Set();
  const frames = [];
  for (const [i, frame] of registration.frames.entries()) {
    if (typeof frame.image !== 'string' || basename(frame.image) !== frame.image || frame.image.includes('\\') || !/\.(jpg|jpeg|png)$/i.test(frame.image) || names.has(frame.image))
      throw new Error('场景全景文件名无效或重复');
    names.add(frame.image);
    const key = `panorama-${i}`;
    assets.set(key, { ...await asset(join(root, 'panoramas', frame.image)), mime: /\.png$/i.test(frame.image) ? 'image/png' : 'image/jpeg' });
    frames.push({ name: frame.image, url: `/api/local-scene/asset/${key}` });
  }
  const hash = createHash('sha256').update(registrationText);
  for (const [key, value] of assets) {
    hash.update(key);
    for await (const chunk of createReadStream(value.file)) hash.update(chunk);
  }
  const id = `local-scene-${hash.digest('hex').slice(0, 16)}`;
  const registrationSource = metadata.registrationSource === 'imported' ? 'imported'
    : metadata.registrationSource === 'ins-approximate' || /\bINS\b/i.test(registration.source ?? '') ? 'ins-approximate' : 'imported';
  const manifest = { schemaVersion: 'local-scene/1.0', id,
    name: `${typeof metadata.sceneName === 'string' ? metadata.sceneName : basename(root)} · ${frames.length} 帧 · ${metadata.pointFormat === 'XYZI' ? '强度点云' : '点云'}`,
    location: metadata.registrationSummary ?? (registrationSource === 'imported' ? '导入位姿初值 · 坐标约定待投影核验' : metadata.panoramaYawOffsetDeg ? `本机场景 · INS + ${metadata.panoramaYawOffsetDeg}° 朝向粗初值，待精调` : '本机场景 · INS 粗配准，外参待核验'),
    registrationSource, coverage: metadata.coverage ?? { fullMapCoverage: Boolean(metadata.fullMapCoverage),
      summary: metadata.fullMapCoverage ? '全地图降采样 · 无空间裁剪' : metadata.radiusMeters ? `局部 ${metadata.radiusMeters}m · 单分块细节` : '覆盖范围未提供' },
    pointDisplayRanges: metadata.pointDisplayRanges ?? (metadata.voxelSizeMeters > 0 && metadata.sampledPointCount > 0
      ? [{start:0,count:metadata.sampledPointCount,spacing:metadata.voxelSizeMeters}] : undefined),
    pointCloudName: 'scene-cloud.pcd', pointCloudUrl: '/api/local-scene/asset/cloud', frames,
    registration, baseFrameName: metadata.baseFrameName ?? (metadata.baseFrame ? `frame_${metadata.baseFrame}.jpg` : frames[0].name),
    createdAt: new Date().toISOString().slice(0, 10) };
  return { manifest, async handle(request, response, pathname) {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    if (pathname === '/api/local-scene/manifest') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(manifest)); return;
    }
    const key = pathname.startsWith('/api/local-scene/asset/') ? pathname.slice('/api/local-scene/asset/'.length) : '';
    const value = assets.get(key);
    if (!value) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': value.mime, 'Content-Length': value.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(value.file).on('error', () => response.destroy()).pipe(response);
  } };
}
