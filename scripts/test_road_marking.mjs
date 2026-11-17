import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { BufferGeometry, Float32BufferAttribute } from 'three';

const { outputFiles } = await build({ entryPoints: ['src/roadMarking.ts'], bundle: true, format: 'esm', write: false });
const { footprintCorners, indexGround, placeFootprint, resizeFootprint } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`,
);

const footprint = { center: [0, 0], size: [2, 4], yaw: 90 };
const corners = footprintCorners(footprint);
assert(corners[0][0] > 1.99 && corners[0][1] < -.99, 'positive yaw points the long axis clockwise from -Z');
const resized = resizeFootprint(footprint, 0, [3, -2]);
const unchangedCorner = footprintCorners(resized)[2];
assert(Math.hypot(unchangedCorner[0] - corners[2][0], unchangedCorner[1] - corners[2][1]) < 1e-8,
  'resizing rotated boxes preserves the diagonal anchor');

const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([
  0, 4, 0, 0, -2, 0, 2, -1.8, -1, -2, -2.1, 1,
], 3));
const ground = indexGround(geometry);
const marking = placeFootprint(footprint, 'crosswalk', ground);
assert.deepEqual(marking.center, [0, -2, 0], 'foreground objects must not set the marking height');
assert.equal(marking.corners.length, 4);
assert.equal(marking.type, 'crosswalk');
assert.equal(placeFootprint({ ...footprint, center: [20, 20] }, 'crosswalk', ground), undefined,
  'a box over an empty area should not receive a fabricated center height');
console.log('Road marking rotation, corner resize, local ground and empty area checks passed');
