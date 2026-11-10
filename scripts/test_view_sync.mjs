import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';
const directory = await mkdtemp(join(tmpdir(), 'scri-view-sync-'));
try {
  const file = join(directory, 'sync.mjs');
  await build({ entryPoints: [resolve('src/viewSync.ts')], outfile: file, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { ViewSync, panoramaOrientation, dragOrientation } = await import(pathToFileURL(file));
  const geometryFile = join(directory, 'geometry.mjs');
  await build({ entryPoints: [resolve('src/geometry.ts')], outfile: geometryFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { registrationQuaternion } = await import(pathToFileURL(geometryFile));
  const sync = new ViewSync();
  let calls = 0, left, right;
  const stopLeft = sync.subscribe((v) => { left = v; calls++; });
  const stopRight = sync.subscribe((v) => { right = v; calls++; });
  const frames = [
    { position: [0,0,0], rotation: [0,0,0] },
    { position: [13,-1,7], rotation: [169,12,-7] },
    { position: [-4,3,22], rotation: [-178,-19,14] },
  ];
  let world = registrationQuaternion({ position: [0,0,0], rotation: [178,30,6] });
  for (let i=0; i<40; i++) {
    world = dragOrientation(world, 6, -2, 72);
    sync.set(world, 68);
    assert(left.quaternion.angleTo(right.quaternion)<1e-7);
    assert.equal(left.fov, right.fov);
    for (const frame of frames) {
      const local = panoramaOrientation(world, frame);
      assert(registrationQuaternion(frame).multiply(local).angleTo(world)<1e-7, 'local panorama camera must reconstruct the same world orientation, including roll');
      assert(sync.snapshot.quaternion.angleTo(world)<1e-7, 'frame changes must preserve observed world heading');
    }
  }
  assert.equal(calls, 82, 'one delivery per subscriber, without feedback loops');
  left.quaternion.identity();
  assert(sync.snapshot.quaternion.angleTo(world)<1e-7, 'subscriber snapshots must not mutate shared camera state');
  stopLeft(); stopRight(); sync.set(world, 200); assert.equal(sync.snapshot.fov,95);
  sync.set(world,1); assert.equal(sync.snapshot.fov,28);
  const colorFile = join(directory, 'autoYaw.mjs');
  await build({ entryPoints: [resolve('src/autoYaw.ts')], outfile: colorFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { hasUsableRgb } = await import(pathToFileURL(colorFile));
  const gray = { count: 3000, getX: () => .2, getY: () => .2, getZ: () => .2 };
  const vivid = { count: 3000, getX: () => .8, getY: () => .1, getZ: () => .1 };
  let raw = gray;
  const cloud = { getAttribute: (name) => name === 'position' ? { count:3000 } : name === 'sourceColor' ? raw : vivid };
  assert.equal(hasUsableRgb(cloud),false,'display coloring must not qualify grayscale source data for RGB registration');
  raw = vivid; assert.equal(hasUsableRgb(cloud),true,'genuine source RGB remains available');
  cloud.userData = { generatedColors: true };
  assert.equal(hasUsableRgb(cloud),false,'generated colors on a cloud without source RGB must never qualify');
  const orbitFile = join(directory, 'orbit.mjs');
  await build({ entryPoints:[resolve('src/cameraOrbit.ts')], outfile:orbitFile, bundle:true, format:'esm', platform:'node', logLevel:'silent' });
  const { createOrbitFromCamera, observationOrbitTarget } = await import(pathToFileURL(orbitFile));
  const root = {addEventListener(){},removeEventListener(){}};
  const element = {style:{},addEventListener(){},removeEventListener(){},getRootNode:()=>root};
  for (const rotation of [[.3,1.8,.4],[-.9,-2.1,-.6],[1.4,.3,1.2]]) {
    const camera = new THREE.PerspectiveCamera(63,1.7,.1,5000);
    camera.position.set(12,-3,8); camera.zoom=1.2;
    camera.quaternion.setFromEuler(new THREE.Euler(...rotation,'YXZ'));
    const position=camera.position.clone(), orientation=camera.quaternion.clone();
    const pivot=observationOrbitTarget(camera);
    assert(Math.abs(pivot.distanceTo(position)-10)<1e-9);
    const controls=createOrbitFromCamera(camera,element,pivot,()=>{});
    for(let i=0;i<60;i++)controls.update();
    assert(camera.position.distanceTo(position)<1e-9,'free orbit must retain the synced camera position without update drift');
    assert(camera.quaternion.angleTo(orientation)<1e-7,'preserve yaw, pitch and roll after repeated real OrbitControls updates');
    assert.equal(camera.fov,63);assert.equal(camera.zoom,1.2);
    controls.dispose();
  }
  console.log('World/local camera transforms, frame heading continuity, bidirectional bus and FOV bounds passed');
  console.log('Synced-to-free OrbitControls handoff preserves position, full orientation, FOV and zoom');
} finally {
  const target = resolve(directory); assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target, { recursive: true, force: true });
}
