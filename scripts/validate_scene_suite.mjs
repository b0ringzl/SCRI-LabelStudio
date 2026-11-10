// Repeatable real-data integration check; no survey assets or absolute paths are logged.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createSceneGateway } from './sceneCatalogGateway.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/validate_scene_suite.mjs PREPARED_CATALOG_FOLDER');
const root = resolve(process.argv[2]);
const catalog = JSON.parse(await readFile(join(root,'scene-catalog.json'),'utf8'));
const temp = await mkdtemp(join(tmpdir(),'scri-suite-'));
let server;
try {
  const module = join(temp,'adapter.mjs');
  await build({entryPoints:[resolve('src/sceneImport.ts')],outfile:module,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const { prepareLocalScene, frameHasPose } = await import(pathToFileURL(module));
  const gateway = await createSceneGateway(root);
  server = createServer((req,res)=>void gateway.handle(req,res,new URL(req.url,'http://localhost').pathname));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = new Set(); let totalFrames=0;
  for(const scene of catalog.scenes) {
    const meta = JSON.parse(await readFile(join(root,scene.directory,'source-metadata.json'),'utf8'));
    const manifest = await (await fetch(`${base}/api/local-scene/manifest?scene=${scene.key}`)).json();
    const prepared = prepareLocalScene(manifest);
    assert(!ids.has(prepared.task.id)); ids.add(prepared.task.id);
    assert.equal(prepared.frames.length,meta.imageCount);
    assert.equal((await fetch(base+manifest.pointCloudUrl,{method:'HEAD'})).status,200);
    for(const [i,frame] of prepared.frames.entries()) {
      assert(frameHasPose(frame));
      const matrix = manifest.registration.frames[i].cameraToCloud;
      frame.initialRegistration.position.forEach((value,j)=>assert(Math.abs(value-matrix[j*4+3])<1e-9));
      assert.equal((await fetch(base+frame.url,{method:'HEAD'})).status,200);
    }
    assert(meta.fullMapCoverage);
    if(meta.sourceBounds && meta.sampleBounds) assert.deepEqual(meta.sourceBounds,meta.sampleBounds);
    if(meta.coordinateProfile) {
      assert.equal(prepared.task.initialPoseSource,'imported');
      assert.equal(meta.panoramaYawOffsetDeg,undefined);
      assert.equal(meta.matchedPoseCount,meta.sourceImageCount);
    }
    totalFrames+=prepared.frames.length;
    console.log(JSON.stringify({scene:scene.key,frames:prepared.frames.length,sourceMatched:meta.matchedPoseCount,points:meta.sampledPointCount,import:'PASS'}));
  }
  console.log(`PASS: ${ids.size} independent scenes, ${totalFrames} frames; this checks ingestion, not physical registration accuracy.`);
} finally {
  if(server)await new Promise(done=>server.close(done));
  const target=resolve(temp);assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target,{recursive:true,force:true});
}
