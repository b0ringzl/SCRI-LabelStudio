import { readFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { createLocalSceneGateway } from './localSceneGateway.mjs';

export async function createSceneGateway(directory) {
  const root = await realpath(directory);
  let catalog;
  try { catalog = JSON.parse(await readFile(join(root, 'scene-catalog.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return createLocalSceneGateway(root); throw error; }
  if (catalog.schemaVersion !== 'scene-catalog/1.0' || !Array.isArray(catalog.scenes) || !catalog.scenes.length || catalog.scenes.length > 100)
    throw new Error('Invalid scene catalog');
  const scenes = new Map();
  for (const entry of catalog.scenes) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.key) || scenes.has(entry.key) || typeof entry.directory !== 'string') throw new Error('Invalid/duplicate scene key');
    const path = await realpath(join(root, entry.directory));
    const rel = relative(root,path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Catalog scene must be inside the configured root');
    scenes.set(entry.key, { gateway: await createLocalSceneGateway(path), name: entry.name });
  }
  const options = [...scenes].map(([key, value]) => ({ key, name: value.name ?? value.gateway.manifest.name }));
  const defaultKey = scenes.has(catalog.defaultSceneKey) ? catalog.defaultSceneKey : options[0].key;
  function manifest(key) {
    const original = scenes.get(key).gateway.manifest;
    const suffix = `?scene=${encodeURIComponent(key)}`;
    return { ...original, sceneKey: key, scenes: options,
      pointCloudUrl: original.pointCloudUrl + suffix,
      frames: original.frames.map((f) => ({ ...f, url: f.url + suffix })) };
  }
  return { manifest: manifest(defaultKey), async handle(request,response,pathname) {
    const key = new URL(request.url,'http://localhost').searchParams.get('scene') ?? defaultKey;
    if (!scenes.has(key)) { response.writeHead(404); response.end(); return; }
    if (pathname === '/api/local-scene/manifest') {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405,{Allow:'GET, HEAD'}); response.end(); return; }
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      response.end(request.method==='HEAD' ? undefined : JSON.stringify(manifest(key))); return;
    }
    return scenes.get(key).gateway.handle(request,response,pathname);
  } };
}
