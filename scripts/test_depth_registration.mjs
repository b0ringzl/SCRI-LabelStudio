import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import * as THREE from 'three';
import { validateDepthRequest, depthStatus, handleDepth } from './depthGateway.mjs';

const directory = await mkdtemp(join(tmpdir(), 'scri-depth-'));
try {
  const bundle=join(directory,'depth.mjs');
  await build({entryPoints:[resolve('src/depthRegistration.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const {depthInput,validateDepthCandidate}=await import(pathToFileURL(bundle).href);
  const prior={position:[0,0,0],rotation:[0,0,0]};
  const positions=Array.from({length:3000},(_,i)=>[Math.sin(i)*8,Math.cos(i*2)*3,Math.cos(i)*8]).flat();
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  assert(depthInput(geometry,prior).points.length>=1000,'XYZ-only clouds do not require intensity');
  const body={schemaVersion:'registration-depth/1.0',frameId:'frame',prior,...depthInput(geometry,prior),imageDataUrl:'data:image/jpeg;base64,/9j/'};
  assert.equal(validateDepthRequest(body),body);
  for(const invalid of [{...body,points:[[NaN,0,0]]},{...body,prior:{position:[0,0,0],rotation:[0,Infinity,0]}},
    {...body,imageDataUrl:'https://example.com/image.jpg'},{...body,frameId:''}])assert.throws(()=>validateDepthRequest(invalid));
  const result={schemaVersion:'registration-depth/1.0',frameId:'frame',status:'candidate',algorithmVersion:'da2-radial-depth/1.0',
    signal:'predicted-radial-depth',registration:{position:[.1,0,0],rotation:[1,0,0]},metrics:{depthBefore:.15,depthAfter:.1,
      holdoutBefore:.16,holdoutAfter:.12,holdoutP75Before:.25,holdoutP75After:.22,scaleBefore:20,scaleAfter:20.1,
      visiblePoints:2000,holdoutPoints:400,rotationChangeDeg:1,positionChangeM:.1,durationSeconds:2,starts:3,contrast:.08,boundaryReached:0}};
  assert.equal(validateDepthCandidate(result,prior).method,'da2');
  assert.throws(()=>validateDepthCandidate({...result,status:'rejected'},prior));
  assert.throws(()=>validateDepthCandidate({...result,registration:{position:[2,0,0],rotation:[0,0,0]}},prior));
  for(const patch of [{holdoutAfter:.19},{holdoutP75After:.3},{boundaryReached:1},{scaleAfter:50},{depthBefore:NaN},{visiblePoints:20}])
    assert.throws(()=>validateDepthCandidate({...result,metrics:{...result.metrics,...patch}},prior));
  const original=process.env.ATLAS_DEPTH_PYTHON;
  process.env.ATLAS_DEPTH_PYTHON=join(directory,'missing-python');
  assert.equal((await depthStatus()).configured,false);
  if(original===undefined)delete process.env.ATLAS_DEPTH_PYTHON;else process.env.ATLAS_DEPTH_PYTHON=original;
  const server=createServer((request,response)=>void handleDepth(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url,{method:'DELETE'})).status,405);
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
    const headers={'Content-Type':'application/json',Origin:url};
    const invalid=await fetch(url,{method:'POST',headers,body:'{}'});
    assert([422,503].includes(invalid.status));
    if(process.env.ATLAS_TEST_DA2==='1') {
      const environment=resolve('.venv-da2');
      const python=process.env.ATLAS_DEPTH_PYTHON??(existsSync(join(environment,'conda-meta'))?
        join(environment,process.platform==='win32'?'python.exe':'bin/python'):
        join(environment,process.platform==='win32'?'Scripts/python.exe':'bin/python'));
      const fixture=spawnSync(python,['scripts/validate_depth_registration.py','--scene','floor6','--frame','76.jpg','--fixture'],
        {encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024,env:{...process.env,PYTHONUTF8:'1'}});
      assert.equal(fixture.status,0,fixture.stderr);
      const response=await fetch(url,{method:'POST',headers,body:fixture.stdout});
      const payload=await response.json();
      assert.equal(response.status,200,JSON.stringify(payload));
      assert.equal(payload.frameId,'76.jpg');assert.equal(payload.depthIsMetric,false);
      assert.equal(payload.inference.device,'cuda');assert(payload.inference.inferenceSeconds>0);
      const jpeg=Buffer.from(payload.depthPreviewDataUrl.split(',')[1],'base64');
      assert.equal(jpeg.subarray(0,2).toString('hex'),'ffd8');
      assert.equal(payload.independentlyVerified,false);
      if(payload.status==='candidate')validateDepthCandidate(payload,JSON.parse(fixture.stdout).prior);
      console.log('Real HTTP → official DA2 weights → depth → geometric checks:',payload.status,payload.inference);
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
  console.log('Depth API, XYZ-only input and candidate rejection gates passed');
} finally {
  const target=resolve(directory);assert(target.startsWith(resolve(tmpdir())+sep));await rm(target,{recursive:true,force:true});
}
