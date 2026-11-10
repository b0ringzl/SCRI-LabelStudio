import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createSceneGateway } from './sceneCatalogGateway.mjs';

const dir = await mkdtemp(join(tmpdir(), 'scri-catalog-'));
let server;
try {
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(dir, name, 'panoramas'), { recursive: true });
    await writeFile(join(dir, name, 'scene-cloud.pcd'), name);
    await writeFile(join(dir, name, 'panoramas', '1.jpg'), name+'-image');
    await writeFile(join(dir, name, 'registration.json'), JSON.stringify({ source: 'Source pose initialization', frames: [{ image: '1.jpg', cameraToCloud: [1,0,0,3,0,1,0,4,0,0,1,5,0,0,0,1] }] }));
    await writeFile(join(dir, name, 'source-metadata.json'), JSON.stringify({ sceneName: name, registrationSource: name === 'alpha' ? 'imported' : 'ins-approximate', fullMapCoverage: true }));
  }
  const catalog = { schemaVersion: 'scene-catalog/1.0', defaultSceneKey: 'beta', scenes: [{ key:'alpha', directory:'alpha' }, { key:'beta', directory:'beta' }] };
  await writeFile(join(dir, 'scene-catalog.json'), JSON.stringify(catalog));
  const gateway = await createSceneGateway(dir);
  server = createServer((req, res) => void gateway.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const alpha = await (await fetch(base+'/api/local-scene/manifest?scene=alpha')).json();
  const beta = await (await fetch(base+'/api/local-scene/manifest')).json();
  assert.equal(beta.sceneKey, 'beta');
  assert.notEqual(alpha.id, beta.id, 'labels must be isolated by actual scene assets');
  assert.equal(alpha.registrationSource, 'imported');
  assert.equal(beta.registrationSource, 'ins-approximate');
  assert(!JSON.stringify(alpha).includes(dir));
  for (const manifest of [alpha, beta]) {
    assert.equal(await (await fetch(base+manifest.pointCloudUrl)).text(), manifest.sceneKey);
    assert.equal(await (await fetch(base+manifest.frames[0].url)).text(), manifest.sceneKey+'-image');
  }
  assert.equal((await fetch(base+'/api/local-scene/manifest?scene=unknown')).status, 404);
  assert.equal((await fetch(base+'/api/local-scene/manifest?scene=alpha', {method:'POST'})).status, 405);
  assert.equal((await fetch(base+'/api/local-scene/asset/../../secret?scene=alpha')).status, 404);
  const out = join(dir, 'adapter.mjs');
  await build({ entryPoints:[resolve('src/sceneImport.ts')], outfile:out, bundle:true, format:'esm', platform:'node', logLevel:'silent' });
  const { prepareLocalScene, frameHasPose } = await import(pathToFileURL(out));
  const adapted = prepareLocalScene(alpha);
  assert.equal(adapted.task.initialPoseSource, 'imported');
  assert.deepEqual(adapted.frames[0].initialRegistration.position, [3,4,5]);
  assert.equal(adapted.evidence[adapted.frames[0].id].source, 'imported');
  const partial = prepareLocalScene({ ...alpha, frames:[...alpha.frames, {name:'missing.jpg',url:'local'}] });
  assert.match(partial.warning, /缺少位姿/);
  assert.equal(frameHasPose(partial.frames[1]), false, 'missing pose must disable synchronized observation');
  assert.equal(frameHasPose(partial.frames[1], adapted.frames[0].initialRegistration), true);
  const displayFile = join(dir, 'display.mjs');
  await build({ entryPoints:[resolve('src/cloudDisplay.ts')], outfile:displayFile, bundle:true, format:'esm', platform:'node', logLevel:'silent' });
  const { displaySpacing, intensityLimits } = await import(pathToFileURL(displayFile));
  assert.deepEqual([...displaySpacing(3,[{start:0,count:2,spacing:.1},{start:2,count:1,spacing:1}])].map(x=>Math.round(x*10)), [1,1,10]);
  for(const ranges of [[{start:1,count:3,spacing:1}],[{start:0,count:2,spacing:1}],[{start:0,count:3,spacing:NaN}]]) assert.equal(displaySpacing(3,ranges), null);
  assert.deepEqual(intensityLimits({count:3,getX:()=>-4}), [-5,-3]);
  assert.deepEqual(intensityLimits({count:3,getX:()=>NaN}), [0,1]);
  const limits = intensityLimits({count:1000,getX:i=>i===999 ? 10000000 : i-500});
  assert(limits[0]<0 && limits[1]<1000, 'robust intensity display must handle negative values and outliers');
  catalog.scenes[0].directory = '..';
  await writeFile(join(dir, 'scene-catalog.json'), JSON.stringify(catalog));
  await assert.rejects(()=>createSceneGateway(dir), /inside/);
  console.log('Catalog routing, scene identity, coordinate adapter, missing-pose gating and display integrity passed');
} finally {
  if (server) await new Promise(done => server.close(done));
  const target = resolve(dir); assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target, { recursive:true, force:true });
}
