import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createLocalSceneGateway } from './localSceneGateway.mjs';

const directory = await mkdtemp(join(tmpdir(), 'scri-local-scene-'));
let server;
try {
  await mkdir(join(directory, 'panoramas'));
  await writeFile(join(directory, 'scene-cloud.pcd'), 'test cloud');
  await writeFile(join(directory, 'panoramas', 'frame_1.jpg'), 'test image');
  const calibration = { frames: [{ image: 'frame_1.jpg', cameraToCloud: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }] };
  await writeFile(join(directory, 'registration.json'), JSON.stringify(calibration));
  const gateway = await createLocalSceneGateway(directory);
  assert.equal(gateway.manifest.id, (await createLocalSceneGateway(directory)).manifest.id, 'unchanged data must retain saved annotation identity');
  server = createServer((request, response) => { void gateway.handle(request, response, new URL(request.url, 'http://localhost').pathname); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = await (await fetch(`${base}/api/local-scene/manifest`)).json();
  assert.equal(manifest.frames.length, 1);
  assert(!JSON.stringify(manifest).includes(directory), 'manifest must not expose local paths');
  assert.equal(await (await fetch(base+manifest.pointCloudUrl)).text(), 'test cloud');
  assert.equal((await fetch(base+manifest.frames[0].url, { method: 'HEAD' })).headers.get('content-length'), '10');
  assert.equal((await fetch(base+'/api/local-scene/asset/unknown')).status, 404);
  assert.equal((await fetch(base+'/api/local-scene/manifest', { method: 'POST' })).status, 405);
  await writeFile(join(directory, 'scene-cloud.pcd'), 'different point indices');
  assert.notEqual(gateway.manifest.id, (await createLocalSceneGateway(directory)).manifest.id, 'changed data must isolate point labels');
  await writeFile(join(directory, 'registration.json'), JSON.stringify({ frames: [{ image: '../outside.jpg' }] }));
  await assert.rejects(() => createLocalSceneGateway(directory), /文件名/);
  console.log('Local scene HTTP, read-only methods, asset whitelist, and data identity passed');
} finally {
  if (server) await new Promise((done) => server.close(done));
  const target = resolve(directory);
  assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target, { recursive: true, force: true });
}
