import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import { exportVideo } from '../../packages/renderer-video/dist/index.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
const font = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const spec = {
  ...tutorial,
  steps: [{ op: 'wait', duration: 0.5 }],
  stage: {
    clips: [
      { src: '/artifacts/media/stage.mp4', start: 0.25, in: 1, duration: 1 },
      { src: '/artifacts/media/stage.mp4', start: 1.5, in: 2, duration: 1 },
    ],
  },
};
test(
  'composite export reads CORS-enabled cross-origin stage pixels',
  { timeout: 30000 },
  async () => {
    const data = await readFile('artifacts/media/stage.mp4');
    const server = createServer((req, res) => {
      const headers = {
        'Content-Type': 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': data.length });
        res.end(data);
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const b = await bundleTutorial({
        ...spec,
        steps: [{ op: 'wait', duration: 0.5 }],
        stage: {
          clips: [
            {
              src: `http://127.0.0.1:${server.address().port}/stage.mp4`,
              start: 0,
              in: 1,
              duration: 0.5,
            },
          ],
        },
      });
      const output = 'artifacts/migration/stage-cors.mp4';
      const report = await exportVideo(b, { output, font, fps: 4, width: 640, height: 360 });
      assert.equal(report.layers.mediaFrames, 2);
      assert.equal(report.frames, 2);
      const rgb = execFileSync('ffmpeg', [
        '-v',
        'error',
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'crop=2:2:500:100,scale=1:1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ]);
      assert.ok(rgb[1] > 240 && rgb[0] < 10 && rgb[2] < 10);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
test('stage video trim, gaps, shuffled exact seeking, duration and browser export', async () => {
  const b = await bundleTutorial(spec),
    h = await openBrowser();
  try {
    await h.page.goto(h.runtimeUrl + 'player.html');
    await h.page.evaluate((b) => window.mountTutorial(b), b);
    assert.equal(await h.page.evaluate(() => window.player.duration), 2.5);
    for (const [t, expected] of [
      [0, null],
      [0.5, [0, 255, 0]],
      [2, [0, 0, 255]],
      [1.3, null],
      [0.5, [0, 255, 0]],
      [2.5, null],
    ]) {
      await h.page.evaluate((t) => window.player.seek(t), t);
      const actual = await h.page.evaluate(() => {
        const v = document.querySelector('video:not([hidden])');
        if (!v) return null;
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      });
      if (expected) for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 8);
      else assert.equal(actual, null);
    }
    await h.page.evaluate(() => window.player.seek(0.5));
    await h.page.evaluate(() => window.player.play());
    await h.page.waitForTimeout(180);
    await h.page.evaluate(() => window.player.pause());
    assert.ok((await h.page.evaluate(() => window.player.time)) > 0.5);
    const race = await h.page.evaluate(async () => {
      await Promise.all([window.player.seek(2), window.player.seek(0.7)]);
      return window.player.time;
    });
    assert.equal(race, 0.7);
    // Deterministically exercise buffering and decoder failure without network timing races.
    await h.page.evaluate(async () => {
      await window.player.seek(0.5);
      window.video = document.querySelector('video:not([hidden])');
      Object.defineProperty(window.video, 'readyState', { configurable: true, get: () => 2 });
      window.player.play();
    });
    await h.page.waitForTimeout(150);
    assert.equal(await h.page.evaluate(() => window.player.time), 0.5);
    await h.page.evaluate(() => {
      delete window.video.readyState;
      window.video.dispatchEvent(new Event('canplay'));
    });
    await h.page.waitForTimeout(100);
    const resumed = await h.page.evaluate(() => {
      window.player.pause();
      return window.player.time;
    });
    assert.ok(resumed > 0.5 && resumed < 0.7);
    await h.page.evaluate(() => {
      Object.defineProperty(window.video, 'error', { configurable: true, value: { code: 3 } });
      window.player.play();
    });
    await h.page.waitForFunction(() =>
      document.querySelector('[role="status"]').textContent.includes('decode failed'),
    );
    assert.equal(await h.page.evaluate(() => window.video.paused), true);
    for (const clips of [
      [{ src: '/absent.mp4', start: 0, in: 0, duration: 1 }],
      [{ src: '/artifacts/media/stage.mp4', start: 0, in: 2, duration: 5 }],
    ]) {
      const broken = await bundleTutorial({ ...spec, stage: { clips } });
      await assert.rejects(
        () => h.page.evaluate((b) => window.mountTutorial(b), broken),
        /Video|duration/,
      );
    }
  } finally {
    await h.close();
  }
  const output = 'artifacts/migration/stage-export.mp4';
  const report = await exportVideo(b, { output, font, fps: 10 });
  assert.equal(report.backend, 'composite');
  assert.equal(report.nodePeakRssBytes, report.memory.nodePeakRssBytes);
  assert.equal(report.cache.enabled, true);
  assert.equal(report.cache.screenshots, 0);
  assert.equal(report.layers.mediaFrames, 20);
  assert.equal(report.frames, 25);
  assert.equal(report.encodedDuration, 2.5);
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', output], {
      encoding: 'utf8',
    }),
  );
  assert.equal(info.streams.length, 1);
  assert.equal(info.streams[0].codec_type, 'video');
  assert.equal(info.streams[0].width, 1280);
  assert.equal(info.streams[0].height, 720);
  assert.equal(Number(info.streams[0].nb_frames), 25);
  for (const [t, channel] of [
    [0.5, 1],
    [2, 2],
  ]) {
    const rgb = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      output,
      '-frames:v',
      '1',
      '-vf',
      'crop=2:2:1000:200,scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]);
    assert.ok(rgb[channel] > 240);
  }
});
