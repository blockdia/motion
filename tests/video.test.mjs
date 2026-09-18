import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameCache } from '../packages/renderer-video/dist/cache.js';
import { exportVideo } from '../packages/renderer-video/dist/index.js';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/basic-editing/tutorial.ts';
import { BitmapCache, blit, createBitmap } from '../packages/renderer-video/dist/bitmap.js';

function solid(width, height, color) {
  const bitmap = createBitmap(width, height);
  const ctx = bitmap.surface.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return bitmap;
}
test('native composition handles alpha, clipping, subpixels, rotation and independent frame readback', () => {
  const red = solid(1, 1, '#ff000080');
  const blue = solid(1, 1, 'blue').surface;
  blit(blue, 1, 1, red, 0, 0);
  assert.deepEqual([...blue.data()], [128, 0, 127, 255]);
  const half = solid(1, 1, 'blue').surface;
  blit(half, 1, 1, red, 0, 0, undefined, 0.5);
  assert.deepEqual([...half.data()], [64, 0, 191, 255]);
  // Production sprites have transparent padding; test interpolation away from texture edges.
  const opaque = createBitmap(3, 1);
  opaque.surface.getContext('2d').fillStyle = 'red';
  opaque.surface.getContext('2d').fillRect(1, 0, 1, 1);
  const translated = solid(4, 1, 'white').surface;
  blit(translated, 4, 1, opaque, 0.5, 0);
  const expected = [255, 255, 255, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255, 255, 255, 255];
  const interpolated = translated.data();
  for (let i = 0; i < expected.length; i++)
    assert.ok(Math.abs(interpolated[i] - expected[i]) <= 1, 'half-pixel interpolation');
  const pair = solid(2, 1, 'red');
  pair.surface.getContext('2d').fillStyle = 'blue';
  pair.surface.getContext('2d').fillRect(1, 0, 1, 1);
  const clipped = solid(2, 1, 'white').surface;
  blit(clipped, 2, 1, pair, 0, 0, { x: 1, y: 0, width: 1, height: 1 });
  assert.deepEqual([...clipped.data()], [255, 255, 255, 255, 0, 0, 255, 255]);
  const rotated = solid(1, 2, 'white').surface;
  blit(rotated, 1, 2, pair, 1, 0, undefined, 1, 90);
  assert.deepEqual([...rotated.data()], [255, 0, 0, 255, 0, 0, 255, 255]);
  const previous = rotated.data();
  rotated.getContext('2d').fillStyle = 'white';
  rotated.getContext('2d').fillRect(0, 0, 1, 2);
  assert.deepEqual([...previous], [255, 0, 0, 255, 0, 0, 255, 255]);
});

test('bitmap LRU counts actual RGBA bytes, promotes hits and bounds eviction', () => {
  const cache = new BitmapCache(8);
  const pixel = createBitmap(1, 1);
  cache.set('a', pixel);
  cache.set('b', pixel);
  cache.get('a');
  cache.set('c', pixel);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.evictions, 1);
  assert.equal(cache.bytes, 8);
  cache.set('large', createBitmap(3, 1));
  assert.equal(cache.get('large'), undefined);
  assert.equal(cache.peakBytes, 8);
  cache.clear();
  assert.equal(cache.bytes, 0);
});

test('byte-limited PNG LRU evicts least recently used frames and rejects oversized entries', () => {
  const c = new FrameCache(10);
  c.set('a', Buffer.alloc(4));
  c.set('b', Buffer.alloc(4));
  assert.ok(c.get('a'));
  c.set('c', Buffer.alloc(4));
  assert.equal(c.get('b'), undefined);
  assert.ok(c.get('a'));
  c.set('a', Buffer.alloc(6));
  assert.equal(c.bytes, 10);
  c.set('large', Buffer.alloc(11));
  assert.equal(c.get('large'), undefined);
  assert.equal(c.peakBytes, 10);
  c.clear();
  assert.equal(c.bytes, 0);
  const disabled = new FrameCache(0);
  disabled.set('x', Buffer.from('x'));
  assert.equal(disabled.get('x'), undefined);
});

test('export rejects invalid budgets, resolution and cancellation before starting a browser', async () => {
  const b = await bundleTutorial(tutorial);
  for (const config of [
    { concurrency: 0 },
    { concurrency: 5 },
    { concurrency: 1.5 },
    { cacheBytes: -1 },
    { cacheBytes: Infinity },
    { cacheBytes: 257 * 1024 * 1024 },
    { width: 641, height: 360 },
    { width: 640, height: 480 },
    { width: 7680, height: 4320 },
    { fps: 0 },
    { encoderThreads: 0 },
    { backend: 'unknown' },
  ])
    await assert.rejects(exportVideo(b, { output: 'unused.mp4', font: 'unused.ttf', ...config }));
  const controller = new AbortController();
  const reason = new Error('already cancelled');
  controller.abort(reason);
  await assert.rejects(
    exportVideo(b, { output: 'unused.mp4', font: 'unused.ttf', signal: controller.signal }),
    (error) => error === reason,
  );
});
