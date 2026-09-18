import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import { exportVideo } from '../../packages/renderer-video/dist/index.js';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
const font = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const out = 'artifacts/export-tests';
const spec = {
  ...tutorial,
  steps: [
    {
      op: 'create',
      blocks: [
        {
          id: 'say',
          opcode: 'looks_say',
          inputs: {
            MESSAGE: { shadow: { id: 'text', opcode: 'text', fields: { TEXT: '导出 中文' } } },
          },
        },
      ],
      to: { kind: 'workspaceSlot', name: 'main' },
      duration: 0.1,
    },
    { op: 'move', id: 'say', to: { kind: 'workspaceSlot', name: 'lower' }, duration: 0.4 },
    { op: 'wait', duration: 0.31 },
  ],
};
function rgb(file, frame = 0) {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${frame})`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}
function comparison(a, b) {
  assert.equal(a.length, b.length);
  let sum = 0,
    changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum += d;
      max = Math.max(max, d);
    }
    if (max > 32) changed++;
  }
  return { mean: sum / a.length, changed: changed / (a.length / 3) };
}
test(
  'ordered parallel export matches serial pixels, browser keyframes and half-open frame count',
  { timeout: 90000 },
  async () => {
    await mkdir(out, { recursive: true });
    const b = await bundleTutorial(spec);
    const serial = await exportVideo(b, {
      output: `${out}/serial.mp4`,
      font,
      fps: 10,
      width: 640,
      height: 360,
      cacheBytes: 0,
      backend: 'screenshot',
    });
    const parallel = await exportVideo(b, {
      output: `${out}/parallel.mp4`,
      font,
      fps: 10,
      width: 640,
      height: 360,
      concurrency: 2,
      backend: 'screenshot',
    });
    assert.equal(serial.frames, 11);
    assert.equal(parallel.frames, serial.frames);
    assert.ok(parallel.queue.peakFrames <= 2);
    assert.ok(parallel.cache.peakBytes <= parallel.cache.limitBytes);
    assert.ok(parallel.cache.hits > 0);
    assert.ok(parallel.preparation[0].resources > 150);
    for (const concurrency of [1, 2]) {
      const composite = await exportVideo(b, {
        output: `${out}/composite-${concurrency}.mp4`,
        font,
        fps: 10,
        width: 640,
        height: 360,
        concurrency,
      });
      assert.equal(composite.backend, 'composite');
      assert.equal(composite.frames, serial.frames);
      assert.equal(composite.cache.screenshots, 0);
      assert.ok(composite.layers.svgRasterizations > 0);
      assert.ok(composite.cache.peakBytes <= composite.cache.limitBytes);
      assert.ok(composite.fixedLayerBytes > 640 * 360 * 4);
      assert.ok(composite.queue.peakFrames <= concurrency);
      assert.ok(composite.layers.surfacePoolPeakFrames <= concurrency);
      assert.equal(
        composite.layers.surfacePoolPeakBytes,
        composite.layers.surfacePoolPeakFrames * 640 * 360 * 4,
      );
    }
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'quiet', '-count_frames', '-show_streams', '-of', 'json', `${out}/parallel.mp4`],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(probe.streams.length, 1);
    assert.equal(probe.streams[0].width, 640);
    assert.equal(probe.streams[0].height, 360);
    assert.equal(Number(probe.streams[0].nb_read_frames), 11);
    assert.equal(Number(probe.streams[0].duration), 1.1);
    const h = await openBrowser({ font });
    const metrics = [];
    try {
      await h.page.setViewportSize({ width: 640, height: 360 });
      await h.page.goto(h.runtimeUrl + 'player.html');
      await h.page.evaluate(
        async ({ b, url }) => {
          document.getElementById('player').style.width = '640px';
          await window.mountTutorial(b, { font: { family: 'Motion Export', url } });
        },
        { b, url: h.server.url + '/font.ttf' },
      );
      // Shuffled exact samples cover motion and the cached static tail.
      for (const frame of [10, 2, 0, 4]) {
        const a = rgb(`${out}/serial.mp4`, frame),
          p = rgb(`${out}/parallel.mp4`, frame);
        assert.deepEqual(p, a, `frame ${frame} changed with parallelism/cache`);
        const composite = rgb(`${out}/composite-1.mp4`, frame);
        assert.deepEqual(
          rgb(`${out}/composite-2.mp4`, frame),
          composite,
          `composite frame ${frame} changed with parallelism`,
        );
        const layeredError = comparison(p, composite);
        assert.ok(
          layeredError.mean <= 3 && layeredError.changed <= 0.025,
          JSON.stringify(layeredError),
        );
        await h.page.evaluate((t) => window.player.renderAt(t), frame / 10);
        const image = `${out}/browser-${frame}.png`;
        await h.page.locator('.motion-scene').screenshot({ path: image, animations: 'disabled' });
        const result = comparison(rgb(image), p);
        const regression = comparison(
          rgb(`tests/fixtures/export/browser-${frame}.png`),
          rgb(image),
        );
        assert.ok(
          regression.mean <= 3 && regression.changed <= 0.025,
          `keyframe regression: ${JSON.stringify(regression)}`,
        );
        metrics.push({ frame, ...result });
        assert.ok(result.mean <= 3 && result.changed <= 0.025, JSON.stringify(result));
      }
    } finally {
      await h.close();
    }
    await writeFile(`${out}/keyframes.json`, JSON.stringify(metrics, null, 2));
  },
);

test(
  'cancel during preparation and after frame submission preserves output and removes temporary files',
  { timeout: 60000 },
  async () => {
    await mkdir(out, { recursive: true });
    const b = await bundleTutorial({ ...tutorial, steps: [{ op: 'wait', duration: 2 }] });
    for (const phase of ['preparation', 'frames']) {
      const output = `${out}/cancel-${phase}.mp4`;
      await writeFile(output, 'existing output');
      const controller = new AbortController(),
        reason = new Error('test cancellation');
      const timer =
        phase === 'preparation' ? setTimeout(() => controller.abort(reason), 500) : undefined;
      try {
        await assert.rejects(
          exportVideo(b, {
            output,
            font,
            fps: 10,
            signal: controller.signal,
            onProgress: (p) => {
              if (phase === 'frames' && p.phase === 'frames') controller.abort(reason);
            },
          }),
          (error) => error === reason,
        );
      } finally {
        clearTimeout(timer);
      }
      assert.equal(await readFile(output, 'utf8'), 'existing output');
    }
    assert.ok(!(await readdir(out)).some((name) => name.endsWith('.tmp.mp4')));
  },
);

test(
  'missing encoder, early encoder failure and stalled pipe cancellation all clean up',
  { timeout: 90000 },
  async () => {
    await mkdir(out, { recursive: true });
    const b = await bundleTutorial({ ...tutorial, steps: [{ op: 'wait', duration: 1 }] });
    const dir = await mkdtemp(join(tmpdir(), 'motion-encoder-'));
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = dir;
      await assert.rejects(
        exportVideo(b, { output: `${out}/missing.mp4`, font, fps: 10 }),
        /ENOENT/,
      );
      await writeFile(join(dir, 'ffmpeg'), '#!/bin/sh\necho encoder-failed >&2\nexit 9\n');
      await chmod(join(dir, 'ffmpeg'), 0o755);
      await assert.rejects(
        exportVideo(b, { output: `${out}/failed.mp4`, font, fps: 10 }),
        /encoder-failed|EPIPE/,
      );
      const pidFile = join(dir, 'pid');
      await writeFile(
        join(dir, 'ffmpeg'),
        `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000);\n`,
      );
      const controller = new AbortController(),
        reason = new Error('stalled pipe cancelled');
      let pid, delayed;
      let submitted = 0;
      const timer = setInterval(async () => {
        try {
          pid = Number(await readFile(pidFile, 'utf8'));
          clearInterval(timer);
          delayed = setTimeout(() => controller.abort(reason), 2000);
        } catch {}
      }, 100);
      try {
        await assert.rejects(
          exportVideo(b, {
            output: `${out}/stalled.mp4`,
            font,
            fps: 10,
            signal: controller.signal,
            onProgress: (p) => {
              if (p.phase === 'frames') submitted = p.completed;
            },
          }),
          (error) => error === reason,
        );
      } finally {
        clearInterval(timer);
        clearTimeout(delayed);
      }
      assert.ok(pid);
      assert.ok(
        submitted < 10,
        'unread encoder input must stall frame submission before cancellation',
      );
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
      assert.ok(!(await readdir(out)).some((name) => name.endsWith('.tmp.mp4')));
    } finally {
      process.env.PATH = originalPath;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
