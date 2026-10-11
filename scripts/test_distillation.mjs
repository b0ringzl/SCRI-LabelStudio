import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const entry = fileURLToPath(new URL('../src/distillation.ts', import.meta.url));
const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'neutral', format: 'esm',
  write: false, logLevel: 'silent' });
const { buildDistillationManifest } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const profiles = [
  { id: 'qwen-1', name: 'Qwen', modality: 'image2d', adapter: 'qwen-vl-v1', endpoint: '', modelName: 'qwen3-vl-plus' },
  { id: 'deepseek-1', name: 'DeepSeek', modality: 'image2d', adapter: 'deepseek-vision-v1', endpoint: '', modelName: 'deepseek-flash' },
];
const box = (id, modelId) => ({ id, classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2,
  origin: 'prediction', modelId });
const items = [
  { name: 'qwen.jpg', reviewed: true, boxes: [box('q', 'qwen-1')] },
  { name: 'deepseek.jpg', reviewed: true, boxes: [box('d', 'deepseek-1')] },
  { name: 'unreviewed.jpg', reviewed: false, boxes: [box('u', 'qwen-1')] },
  { name: 'negative.jpg', reviewed: true, boxes: [] },
];
const manifest = buildDistillationManifest('road', items, profiles, '2026-10-11T00:00:00.000Z');
assert.equal(manifest.samples.length, 3, 'unreviewed images must not enter training data');
assert.deepEqual(manifest.samples.map((sample) => sample.imageKey), ['qwen.jpg', 'deepseek.jpg', 'negative.jpg']);
assert.equal(manifest.samples[0].labels[0].source.provider, 'qwen');
assert.equal(manifest.samples[1].labels[0].source.provider, 'deepseek');
assert.equal(manifest.samples[2].labels.length, 0, 'confirmed empty images remain negative samples');
assert.equal(manifest.samples[0].labels[0].source.originalConfidence, undefined);
assert.throws(() => buildDistillationManifest('road', [{ name: 'bad.jpg', reviewed: true,
  boxes: [{ ...box('bad', 'qwen-1'), x: 0.95, w: 0.2 }] }], profiles), /越界/);
assert.throws(() => buildDistillationManifest('road', [{ name: 'bad-score.jpg', reviewed: true,
  boxes: [{ ...box('bad-score', 'qwen-1'), confidence: 2 }] }], profiles), /无效框/);
assert.throws(() => buildDistillationManifest('road', [items[0], items[0]], profiles), /重复/);
console.log('distillation manifest checks passed');
