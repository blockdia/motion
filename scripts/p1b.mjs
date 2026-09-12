import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import tutorial from '../examples/basic-editing/tutorial.ts';
import { compile } from '../packages/authoring/dist/index.js';
import { createAdapter } from '../packages/asset-builder/dist/index.js';
import { evaluate, frameCount } from '../packages/core/dist/index.js';
import { rasterFrame } from '../packages/renderer-video/dist/index.js';
import { serve, root, font } from './server.mjs';
const out = root + '/artifacts/p1b',
  baseline = root + '/docs/p1b-baseline';
await mkdir(out, { recursive: true });
await mkdir(baseline, { recursive: true });
const start = performance.now();
const adapter = await createAdapter({ project: tutorial.project });
let compiled;
try {
  compiled = await compile(tutorial, adapter);
  const json = JSON.parse(await readFile(root + '/examples/basic-editing/tutorial.json', 'utf8'));
  assert.deepEqual(await compile(json, adapter), compiled);
} finally {
  await adapter.dispose();
}
const report = {
  preparationMs: performance.now() - start,
  jsonEquivalent: true,
  workspaceDisposed: true,
  source: compiled.manifest.source,
  resources: Object.keys(compiled.manifest.resources).length,
  duration: compiled.duration,
  frameCount: frameCount(compiled.duration, 30),
};
await writeFile(out + '/scene.json', JSON.stringify(compiled, null, 2));
execFileSync(
  process.execPath,
  [
    'packages/cli/dist/index.js',
    'compile',
    'examples/basic-editing/tutorial.json',
    out + '/scene-cli.json',
  ],
  { cwd: root },
);
assert.deepEqual(JSON.parse(await readFile(out + '/scene-cli.json', 'utf8')), compiled);
report.cliCompileEquivalent = true;
const samples = Array.from({ length: report.frameCount }, (_, i) => evaluate(i / 30, compiled));
let seed = 12;
for (let i = 0; i < 500; i++) {
  seed = (1664525 * seed + 1013904223) >>> 0;
  const j = seed % samples.length;
  assert.deepEqual(evaluate(j / 30, compiled), samples[j]);
}
report.randomSamples = 500;
const server = await serve();
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url + '/apps/playground/index.html');
  await page.waitForFunction(() => window.ready);
  report.playerHasBlockly = await page.evaluate(() => typeof window.Blockly !== 'undefined');
  assert.equal(report.playerHasBlockly, false);
  const drags = compiled.tracks.filter((t) => t.kind === 'node' && t.opacityFrom === 1);
  const input = compiled.tracks.find((t) => t.kind === 'input');
  const paste = compiled.events.find((e) => e.nodes?.some((n) => n.id === 'note'));
  assert.ok(evaluate(paste.time, compiled).nodes.find((n) => n.id === 'note').opacity === 1);
  assert.ok(!evaluate(paste.time - 1e-8, compiled).nodes.some((n) => n.id === 'note'));
  const keyframes = [
    ['initial', 0],
    ['toolbox-hat', drags[0].start - 0.01],
    ['drag-hat', (drags[0].start + drags[0].end) / 2],
    ['drag-move', (drags[1].start + drags[1].end) / 2],
    ['typing-empty', input.start + input.frames[1].offset + 0.01],
    ['typing', (input.start + input.end) / 2],
    ['typing-complete', input.start + input.frames.at(-1).offset + 0.01],
    ['paste', paste.time],
    ['final', compiled.duration],
  ];
  report.keyframes = [];
  for (const [name, time] of keyframes) {
    await page.evaluate((t) => window.player.seek(t), time);
    const expected = await page.locator('.motion-frame').innerHTML();
    await page.evaluate((t) => {
      window.player.seek(0);
      window.player.seek(t);
    }, time);
    assert.equal(await page.locator('.motion-frame').innerHTML(), expected);
    await page.locator('.motion-frame').screenshot({ path: `${out}/browser-${name}.png` });
    await writeFile(`${out}/video-${name}.png`, rasterFrame(compiled, time, font));
    const difference = await page.evaluate(async (name) => {
      async function pixels(prefix) {
        const image = new Image();
        image.src = `/artifacts/p1b/${prefix}-${name}.png`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const a = await pixels('browser'),
        b = await pixels('video');
      if (a.length !== b.length) throw Error('Image dimensions differ');
      let sum = 0,
        changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          sum += d;
          max = Math.max(max, d);
        }
        if (max > 32) changed++;
      }
      return {
        meanChannelError: sum / ((a.length / 4) * 3),
        changedPixelRatio: changed / (a.length / 4),
      };
    }, name);
    assert.ok(
      difference.meanChannelError < 3 && difference.changedPixelRatio < 0.025,
      JSON.stringify({ name, ...difference }),
    );
    report.keyframes.push({ name, time, ...difference });
    for (const backend of ['browser', 'video'])
      await copyFile(`${out}/${backend}-${name}.png`, `${baseline}/${backend}-${name}.png`);
  }
  await page.evaluate(() => {
    window.player.seek(0);
    window.player.play();
  });
  try {
    await page.waitForFunction(() => window.player.time > 0.06);
  } catch (error) {
    throw new Error(
      JSON.stringify({
        errors,
        player: await page.evaluate(() => ({
          time: window.player.time,
          playing: window.player.playing,
        })),
      }),
      { cause: error },
    );
  }
  await page.evaluate(() => window.player.pause());
  const paused = await page.evaluate(() => window.player.time);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.player.time), paused);
  await page.evaluate(() => window.player.dispose());
  assert.equal(await page.locator('#player').evaluate((el) => el.childElementCount), 0);
  assert.deepEqual(errors, []);
  report.browserControls = 'play, pause, seek, dispose passed';
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
execFileSync(
  process.execPath,
  ['packages/cli/dist/index.js', 'export', out + '/scene.json', out + '/p1b.mp4', '30'],
  { cwd: root },
);
report.export = JSON.parse(await readFile(out + '/p1b.mp4.json', 'utf8'));
report.videoProbe = JSON.parse(
  execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,nb_read_frames,duration',
      '-of',
      'json',
      out + '/p1b.mp4',
    ],
    { encoding: 'utf8' },
  ),
).streams[0];
assert.equal(Number(report.videoProbe.nb_read_frames), report.frameCount);
assert.equal(report.videoProbe.width, 1280);
assert.equal(report.videoProbe.height, 720);
assert.equal(report.videoProbe.r_frame_rate, '30/1');
assert.ok(Math.abs(Number(report.videoProbe.duration) - report.export.encodedDuration) < 1e-6);
report.totalMs = performance.now() - start;
await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
await writeFile(baseline + '/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
