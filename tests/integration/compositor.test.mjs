import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { createCompositor, decodePng } from '../../packages/renderer-video/dist/compositor.js';
import { targetProject } from '../fixtures/target-project.mjs';
import all from '../../examples/all-api/tutorial.ts';
const font = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';

test(
  'cached UI/SVG layers match browser input, IME, menus, annotations, themes and target changes',
  { timeout: 90000 },
  async () => {
    const bundle = await bundleTutorial({
      ...all,
      project: targetProject(),
      defaults: { ...all.defaults, theme: 'dark' },
    });
    const host = await openBrowser({ font });
    let compositor;
    try {
      await host.page.setViewportSize({ width: 640, height: 360 });
      await host.page.goto(host.runtimeUrl + 'player.html');
      const scene = await host.page.evaluate(
        async ({ bundle, url }) => {
          document.getElementById('player').style.width = '640px';
          await window.mountTutorial(bundle, {
            font: { family: 'Motion Export', url },
            cursorMotion: 'curve',
            cursorClickEffect: 'shrink',
          });
          return window.player.getPreparedScene();
        },
        { bundle, url: host.server.url + '/font.ttf' },
      );
      // The exporter receives a detached scene; consumers cannot mutate the active player.
      assert.equal(
        await host.page.evaluate(() => {
          const copy = window.player.getPreparedScene();
          copy.duration = -1;
          return window.player.duration > 0;
        }),
        true,
      );
      const options = {
        width: 640,
        height: 360,
        font,
        cacheBytes: 32 * 1024 ** 2,
        runtimeUrl: host.runtimeUrl,
        hasMedia: false,
        cursorMotion: 'curve',
        cursorClickEffect: 'shrink',
      };
      compositor = await createCompositor(host.page, scene, options);
      const groups = new Map();
      const add = (key, time) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(time);
      };
      for (let time = 0; time < scene.duration; time += 1 / 30) {
        const s = evaluate(time, scene, options);
        if (s.input) add('input', time);
        if (s.cursor.pressed) add('pressed', time);
        if (s.targetId === 'stage') add('stage', time);
        if (s.nodes.some((n) => n.dragging)) add('drag', time);
        for (const o of s.overlays)
          add(
            o.ime
              ? 'ime'
              : o.menu
                ? o.menu.context
                  ? 'context'
                  : 'choice'
                : o.text
                  ? 'annotation'
                  : 'highlight',
            time,
          );
      }
      for (const key of [
        'input',
        'ime',
        'choice',
        'context',
        'annotation',
        'highlight',
        'stage',
        'drag',
        'pressed',
      ])
        assert.ok(groups.has(key), `fixture missing ${key}`);
      const samples = [...groups].map(([kind, times]) => ({
        kind,
        time: times[Math.floor(times.length / 2)],
      }));
      samples.push({ kind: 'start', time: 0 }, { kind: 'end', time: scene.duration - 1 / 30 });
      const metrics = [];
      await mkdir('artifacts/compositor-tests', { recursive: true });
      for (const { kind, time } of samples) {
        const pixels = await compositor.frame(time);
        await host.page.evaluate(async (time) => {
          document.querySelectorAll('.motion-scene')[1].parentElement.style.display = 'none';
          document.getElementById('player').style.visibility = 'visible';
          await window.player.renderAt(time);
        }, time);
        const png = await host.page.locator('#player .motion-scene').screenshot({
          animations: 'disabled',
          path: `artifacts/compositor-tests/${kind}-browser.png`,
        });
        const browser = (await decodePng(png, 640, 360)).pixels;
        let sum = 0,
          changed = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          let max = 0;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(pixels[i + c] - browser[i + c]);
            sum += d;
            max = Math.max(max, d);
          }
          if (max > 32) changed++;
        }
        const metric = { kind, time, mean: sum / (640 * 360 * 3), changed: changed / (640 * 360) };
        metrics.push(metric);
        assert.ok(metric.mean <= 3 && metric.changed <= 0.025, JSON.stringify(metric));
        await host.page.evaluate(() => {
          document.getElementById('player').style.visibility = 'hidden';
          document.querySelectorAll('.motion-scene')[1].parentElement.style.display = '';
        });
      }
      const captures = compositor.stats.uiCaptures,
        rasters = compositor.stats.svgRasterizations;
      await compositor.frame(samples.at(-1).time);
      assert.equal(compositor.stats.uiCaptures, captures, 'unchanged UI must reuse cached crops');
      assert.equal(compositor.stats.svgRasterizations, rasters, 'unchanged SVG must reuse bitmap');
      assert.ok(compositor.cache.peakBytes <= options.cacheBytes);
      await writeFile('artifacts/compositor-tests/quality.json', JSON.stringify(metrics, null, 2));
    } finally {
      compositor?.dispose();
      await host.close();
    }
  },
);
