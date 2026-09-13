// Reproducible comparison against the checked-in pre-migration renderer and saved all-api scene.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import ts from 'typescript';
import { openBrowser } from '../packages/asset-builder/dist/index.js';
import { exportVideo } from '../packages/renderer-video/dist/index.js';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/all-api/tutorial.ts';
const font = process.argv[2];
if (!font) throw Error('Pass an explicit benchmark font path');
const out = 'artifacts/migration';
await mkdir(out + '/legacy', { recursive: true });
const original = await readFile('artifacts/all-api/scene.json'),
  bundle = await bundleTutorial(tutorial),
  semantic = Buffer.from(JSON.stringify(bundle));
await writeFile(out + '/benchmark.json', semantic);
for (const [file, source] of [
  ['index', 'packages/renderer-browser/src/index.ts'],
  ['targets', 'packages/renderer-browser/src/targets.ts'],
  ['appearance', 'packages/renderer-browser/src/appearance.ts'],
  ['video', 'packages/renderer-video/src/index.ts'],
]) {
  let code = execFileSync('git', ['show', 'e55c4fec798528e795edc8f7a6ba9d83c8eac8ee:' + source], {
    encoding: 'utf8',
  });
  code = code.replaceAll("'@blockdia-motion/core'", "'../../../packages/core/dist/index.js'");
  if (file === 'video') code = code.replace("'@blockdia-motion/renderer-browser'", "'./index.js'");
  await writeFile(
    `${out}/legacy/${file}.js`,
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  );
}
await writeFile(
  out + '/legacy/view.html',
  `<!doctype html><style>body{margin:0}#host{width:1280px}</style><div id="host"></div><script type="importmap">{"imports":{"@blockdia-motion/core":"/packages/core/dist/index.js"}}</script><script type="module">import {mountPlayer} from './index.js';const font=await new FontFace('Motion Sans','url(/font.ttf)').load();document.fonts.add(font);const scene=await(await fetch('/artifacts/all-api/scene.json')).json();window.player=mountPlayer(document.getElementById('host'),scene);window.ready=true;</script>`,
);
const host = await openBrowser({ font: resolve(font) });
const report = {
  environment: {
    browser: host.browser.version(),
    platform: process.platform,
    arch: process.arch,
    font: resolve(font),
  },
  published: {
    old: { bytes: original.length, gzipBytes: gzipSync(original).length },
    current: { bytes: semantic.length, gzipBytes: gzipSync(semantic).length },
  },
  playback: {},
};
try {
  for (const mode of ['old', 'current']) {
    const page = await host.browser.newPage({ viewport: { width: 1280, height: 720 } }),
      cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const requests = [];
    page.on('response', (r) => {
      if (r.ok()) requests.push(r);
    });
    const before = performance.now();
    if (mode === 'old') {
      await page.goto(host.server.url + '/' + out + '/legacy/view.html');
      await page.waitForFunction(() => window.ready === true);
    } else {
      await page.goto(host.runtimeUrl + 'player.html');
      await page.evaluate((b) => window.mountTutorial(b), bundle);
    }
    const coldMs = performance.now() - before;
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const sizes = await Promise.all(
      requests.map(async (r) => {
        try {
          const bytes = await r.body();
          return {
            url: new URL(r.url()).pathname,
            bytes: bytes.length,
            gzipBytes: gzipSync(bytes).length,
          };
        } catch {
          if (new URL(r.url()).pathname === '/font.ttf') {
            const bytes = await readFile(font);
            return { url: '/font.ttf', bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
          }
          throw Error('Missing response body: ' + r.url());
        }
      }),
    );
    await cdp.send('Performance.enable');
    await page.evaluate(async () => {
      await window.player.seek(10);
      window.frameSamples = 0;
      window.originalRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) =>
        window.originalRAF((time) => {
          window.frameSamples++;
          callback(time);
        });
    });
    const beforePlayback = await cdp.send('Performance.getMetrics');
    await page.evaluate(() => window.player.play());
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.player.pause();
      window.requestAnimationFrame = window.originalRAF;
    });
    const afterPlayback = await cdp.send('Performance.getMetrics'),
      frameSamples = await page.evaluate(() => window.frameSamples);
    const metric = (data, key) => data.metrics.find((m) => m.name === key)?.value ?? 0;
    const taskMsPerFrame =
      (1000 * (metric(afterPlayback, 'TaskDuration') - metric(beforePlayback, 'TaskDuration'))) /
      frameSamples;
    const samples = await page.evaluate(async () => {
      const ms = [];
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        await window.player.seek(i * 0.4);
        ms.push(performance.now() - t);
      }
      return ms;
    });
    let repeatedMs = null;
    if (mode === 'current') {
      const start = performance.now();
      await page.evaluate(() => window.player.setOptions({ locale: 'zh-CN', theme: 'light' }));
      repeatedMs = performance.now() - start;
    }
    report.playback[mode] = {
      coldMs,
      repeatedPreparationMs: repeatedMs,
      downloadBytes: sizes.reduce((n, s) => n + s.bytes, mode === 'current' ? semantic.length : 0),
      gzipEquivalentBytes: sizes.reduce(
        (n, s) => n + s.gzipBytes,
        mode === 'current' ? gzipSync(semantic).length : 0,
      ),
      heapAfterGC: heap.usedSize,
      frameSamples,
      taskMsPerFrame,
      seekMeanMs: samples.reduce((a, b) => a + b) / samples.length,
      seekP95Ms: samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)],
      requests: sizes,
    };
    await page.close();
  }
} finally {
  await host.close();
}
try {
  const previous = JSON.parse(await readFile(out + '/cost.json'));
  if (previous.export) report.export = previous.export;
} catch {}
await writeFile(out + '/cost.json', JSON.stringify(report, null, 2));
if (process.argv.includes('--playback-only')) {
  console.log('Playback measurements updated');
  process.exit(0);
}
console.log('Playback comparison captured; exporting both all-api versions.');
const { exportVideo: oldExport } = await import('../artifacts/migration/legacy/video.js');
report.export = {
  old: await oldExport(JSON.parse(original), {
    output: out + '/old-all-api.mp4',
    font: resolve(font),
    fps: 30,
  }),
  current: await exportVideo(bundle, {
    output: out + '/current-all-api.mp4',
    font: resolve(font),
    fps: 30,
  }),
};
await writeFile(out + '/cost.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      published: report.published,
      playback: Object.fromEntries(
        Object.entries(report.playback).map(([k, { requests, ...v }]) => [k, v]),
      ),
      export: report.export,
    },
    null,
    2,
  ),
);
