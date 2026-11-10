import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {validateRegistrationRequest,registrationStatus,handleRegistration} from './registrationGateway.mjs';

const dir=await mkdtemp(join(tmpdir(),'scri-automatic-'));
try {
  const out=join(dir,'adapter.mjs');await build({entryPoints:[resolve('src/automaticRegistration.ts')],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const {validateCandidate}=await import(pathToFileURL(out).href);
  const prior={position:[0,0,0],rotation:[0,0,0]};
  const body={schemaVersion:'registration/2.0',frameId:'frame',prior,signal:'intensity',imageDataUrl:'data:image/jpeg;base64,/9j/',
    points:Array.from({length:1000},()=>[0,0,-5]),values:Array.from({length:1000},(_,i)=>i)};
  assert.equal(validateRegistrationRequest(body),body);
  for(const invalid of [{...body,prior:{position:[0,0,0],rotation:[0,NaN,0]}},{...body,signal:'pseudo-color'},
    {...body,values:[]},{...body,points:[[0,0,NaN]]},{...body,imageDataUrl:'http://untrusted/image'}])
    assert.throws(()=>validateRegistrationRequest(invalid));
  const payload={schemaVersion:'registration/2.0',status:'candidate',registration:{position:[.1,0,0],rotation:[1,0,0]},
    algorithmVersion:'spherical-nid/1.0',signal:'intensity',metrics:{nidBefore:.9,nidAfter:.8,holdoutBefore:.9,holdoutAfter:.8,visiblePoints:1500,
      rotationChangeDeg:1,positionChangeM:.1,durationSeconds:5,starts:3,controlNid:.94,contrast:.14}};
  assert.equal(validateCandidate(payload,prior).algorithmVersion,'spherical-nid/1.0');
  assert.throws(()=>validateCandidate({...payload,status:'rejected'},prior));
  assert.throws(()=>validateCandidate({...payload,registration:{position:[3,0,0],rotation:[0,0,0]}},prior));
  assert.throws(()=>validateCandidate({...payload,metrics:{...payload.metrics,holdoutAfter:.95}},prior));
  assert.throws(()=>validateCandidate({...payload,metrics:{nidBefore:.9}},prior));
  const original=process.env.ATLAS_REGISTRATION_PYTHON;process.env.ATLAS_REGISTRATION_PYTHON=join(dir,'missing-python');
  assert.equal((await registrationStatus()).configured,false);
  if(original===undefined)delete process.env.ATLAS_REGISTRATION_PYTHON;else process.env.ATLAS_REGISTRATION_PYTHON=original;
  const python=process.env.ATLAS_REGISTRATION_PYTHON??resolve('.venv-registration',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(existsSync(python)) {
    assert.equal((await registrationStatus()).configured,true);
    const fixture=spawnSync(python,['scripts/test_registration_worker.py','--fixture'],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
    assert.equal(fixture.status,0,fixture.stderr);
    const server=createServer((req,res)=>void handleRegistration(req,res));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const url=`http://127.0.0.1:${server.address().port}`;
      const headers={'Content-Type':'application/json',Origin:url};
      assert.equal((await fetch(url,{method:'DELETE'})).status,405);
      assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
      assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,422);
      const response=await fetch(url,{method:'POST',headers,body:fixture.stdout});
      assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.status,'candidate');assert.equal(result.frameId,'known-pose');
      validateCandidate(result,JSON.parse(fixture.stdout).prior);
      console.log('Real HTTP gateway → isolated Python optimizer → frontend candidate validation passed');
    } finally {await new Promise(resolve=>server.close(resolve));}
  }
  console.log('Automatic registration schema, candidate gates and missing-environment status passed');
} finally {
  const target=resolve(dir);assert(target.startsWith(resolve(tmpdir())+sep));await rm(target,{recursive:true,force:true});
}
