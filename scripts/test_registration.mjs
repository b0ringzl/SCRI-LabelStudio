import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'scri-registration-'));
try {
  const output = join(directory, 'registration.mjs');
  await build({ entryPoints: [resolve('src/registrationMath.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { parsePose, solveTiePoints, triangulateTarget, rectangleCenter } = await import(pathToFileURL(output).href);
  const ioOutput = join(directory, 'registrationIO.mjs');
  await build({ entryPoints: [resolve('src/registrationIO.ts')], outfile: ioOutput,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { parseCalibrationDocument } = await import(pathToFileURL(ioOutput).href);
  // Published handbook examples and the recovery utility must match the real parser.
  const handbook = await readFile(resolve('docs/REGISTRATION_MANUAL.md'), 'utf8');
  const jsonExamples = [...handbook.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match => JSON.parse(match[1]));
  assert.equal(jsonExamples.length, 4);
  for (const example of jsonExamples) assert(parseCalibrationDocument(example, ['1.jpg', '2.jpg']).frames['1.jpg']);
  const fixture = JSON.parse(await readFile(resolve('examples/registration/poses-two-frames.json'), 'utf8'));
  assert.deepEqual(parseCalibrationDocument(fixture, ['1.jpg', '2.jpg']).frames['2.jpg'].registration.position, [1, 1.6, 0]);
  const exported = {schemaVersion:'0.2',frames:[{id:'f1',name:'1.jpg'},{id:'f2',name:'2.jpg',utcSeconds:2}],
    frameRegistrations:{f1:{position:[0,1.6,0],rotation:[20,-2,1]},f2:{position:[1,1.6,0],rotation:[22,-2,1]}}};
  const exportPath=join(directory,'export.json'), restoredPath=join(directory,'restored.json');
  await writeFile(exportPath,JSON.stringify(exported));
  execFileSync(process.env.PYTHON ?? 'python',[resolve('scripts/extract_registration_poses.py'),exportPath,'--output',restoredPath]);
  const restored=parseCalibrationDocument(JSON.parse(await readFile(restoredPath,'utf8')),['1.jpg','2.jpg']);
  assert.deepEqual(restored.frames['2.jpg'].registration,exported.frameRegistrations.f2);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const parsedIdentity = parsePose({ cameraToCloud: identity });
  assert(parsedIdentity.position.every((value) => Math.abs(value) < 1e-10));
  assert(parsedIdentity.rotation.every((value) => Math.abs(value) < 1e-10));
  const translated = [...identity]; translated[3] = 2; translated[7] = -1;
  assert.deepEqual(parsePose({ bodyToCloud: translated, cameraToBody: identity }).position, [2, -1, 0]);
  const turned = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
  assert(Math.abs(parsePose({ cameraToCloud: turned }).rotation[0] - 90) < 1e-8);
  const imported = parseCalibrationDocument({ hardware: { cameraToBody: identity }, frames: [
    { image: 'pano_001.jpg', utcSeconds: 1, bodyToCloud: identity },
    { image: 'pano_002.jpg', utcSeconds: 2, bodyToCloud: translated },
  ] }, ['pano_001.jpg', 'pano_002.jpg']);
  assert.deepEqual(imported.frames['pano_002.jpg'].registration.position, [2, -1, 0]);
  assert.throws(() => parseCalibrationDocument({ frames: [{ image: 'missing.jpg', cameraToCloud: identity }] }, ['pano_001.jpg']), /未被选中/);
  assert.throws(() => parsePose({ cameraToCloud: identity.map((value, index) => index === 0 ? 2 : value) }), /正交/);
  assert(Math.abs(rectangleCenter([0.98, 0.4], [0.02, 0.6])[0]) < 1e-8);

  const { pointToPanorama } = await import(pathToFileURL(output).href).then(async () => {
    const geomFile = join(directory, 'geometry.mjs');
    await build({ entryPoints: [resolve('src/geometry.ts')], outfile: geomFile,
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    return import(pathToFileURL(geomFile).href);
  });
  const actual = { position: [1.5, 0.8, -0.4], rotation: [22, -4, 3] };
  const landmarks = [[-6, 2, -12], [5, 3, -18], [10, -2, -5], [-8, 5, 5], [2, -4, 11], [3, 6, -8]];
  const pairs = landmarks.map((cloud, index) => ({ id: String(index), frameId: 'a', cloud, uv: pointToPanorama(cloud, actual) }));
  const solved = solveTiePoints({ position: [1.2, 0.5, -0.2], rotation: [18, -2, 1] }, pairs);
  assert(solved.medianErrorDeg < 0.01, `tie point median ${solved.medianErrorDeg}`);
  assert(Math.hypot(...solved.registration.position.map((value, index) => value - actual.position[index])) < 0.02);
  const solvedFromZero = solveTiePoints({ position: [0, 0, 0], rotation: [0, 0, 0] }, pairs);
  assert(solvedFromZero.medianErrorDeg < 0.05, `tie point zero-seed median ${solvedFromZero.medianErrorDeg}`);

  const poseA = { position: [0, 0, 0], rotation: [0, 0, 0] };
  const poseB = { position: [4, 0, 0], rotation: [0, 0, 0] };
  const target = [1, 1, -12];
  const observation = (frameId, pose) => {
    const [u, v] = pointToPanorama(target, pose);
    return { frameId, center: [u, v], bounds: [u - 0.01, v - 0.01, u + 0.01, v + 0.01] };
  };
  const observations = [observation('a', poseA), observation('b', poseB)];
  const result = triangulateTarget(observations, { a: poseA, b: poseB });
  assert(Math.hypot(...result.cuboid.center.map((value, index) => value - target[index])) < 1e-6);
  assert(result.maxRayAngleDeg > 1.5);
  assert.throws(() => triangulateTarget(observations, { a: poseA, b: poseA }), /基线/);
  console.log('Registration matrix, tie point solve, seam center, and multiview triangulation passed');
} finally {
  const target=resolve(directory);assert(target.startsWith(resolve(tmpdir())+sep));
  await rm(target, { recursive: true, force: true });
}
