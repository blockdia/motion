import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';
import { rasterFrame, exportVideo } from '../../packages/renderer-video/dist/index.js';
import { serve, root, font } from '../../scripts/server.mjs';
import tutorial from '../../examples/structural-editing/tutorial.ts';

test('P2 real Blockly structural editing, shadow restoration, overlays and deterministic export', async () => {
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
    const count = Object.keys(adapter.manifest.resources).length;
    assert.deepEqual(await compile(JSON.parse(JSON.stringify(tutorial)), adapter), scene);
    assert.equal(Object.keys(adapter.manifest.resources).length, count);
    const typing = scene.tracks.find((t) => t.kind === 'input');
    assert.ok(
      scene.manifest.resources[typing.frames.at(-1).asset].box.width >
        scene.manifest.resources[typing.frames[1].asset].box.width,
    );
    const roots = scene.finalTargets.sprite;
    assert.equal(roots.length, 2);
    assert.equal(roots[0].inputs.TIMES.shadow.fields.NUM, '20');
    assert.equal(roots[0].inputs.TIMES.block, undefined);
    assert.equal(roots[0].inputs.SUBSTACK, undefined);
    assert.equal(roots[1].fields.STYLE, 'left-right');
    const joined = scene.events.find((e) =>
      e.nodes?.some(
        (n) =>
          scene.manifest.resources[n.asset].anchors.say &&
          scene.manifest.resources[n.asset].anchors.repeat,
      ),
    );
    const r = scene.manifest.resources[joined.nodes[0].asset];
    assert.deepEqual(r.anchors.repeat.connections.SUBSTACK, r.anchors.say.connections.previous);
    const reporter = scene.events
      .flatMap((e) => e.nodes ?? [])
      .map((n) => scene.manifest.resources[n.asset])
      .find((r) => r.anchors.reporter && r.anchors.repeat);
    assert.deepEqual(
      reporter.anchors.repeat.connections.TIMES,
      reporter.anchors.reporter.connections.output,
    );
    assert.equal(reporter.anchors.times, undefined);
    assert.ok(
      reporter.anchors.reporter.bounds.x + reporter.anchors.reporter.bounds.width <
        reporter.anchors.repeat.bounds.width,
    );
    const joinedEvent = scene.events.find((e) =>
      e.nodes?.some((n) => {
        const a = scene.manifest.resources[n.asset].anchors;
        return a.repeat && a.reporter;
      }),
    );
    assert.ok(
      evaluate(joinedEvent.time + 0.3, scene).nodes.some((n) => {
        const a = scene.manifest.resources[n.asset].anchors;
        return a.repeat && a.reporter;
      }),
    );
    const open = scene.tracks.find((t) => t.step.endsWith(':open-click'));
    const click = scene.tracks.find((t) => t.step.endsWith(':select-click'));
    assert.ok(evaluate((open.start + open.end) / 2, scene).cursor.pressed);
    const selected = evaluate((click.start + click.end) / 2, scene);
    const menu = selected.overlays.find((o) => o.menu).menu;
    assert.equal(selected.cursor.pressed, true);
    assert.ok(
      selected.cursor.x >= menu.panel.x && selected.cursor.x < menu.panel.x + menu.panel.width,
    );
    assert.equal(Math.floor((selected.cursor.y - menu.panel.y - 4) / menu.rowHeight), menu.hovered);
    assert.equal(menu.options[menu.hovered][1], 'left-right');
    const imeFrame = typing.frames.find(
      (f) => scene.manifest.resources[f.asset].input.text === 'ni',
    );
    assert.equal(imeFrame.candidates[0], '你');
    assert.ok(!imeFrame.candidates.includes('你好'));
    assert.equal(evaluate(typing.start + imeFrame.offset, scene).input.preedit, true);

    for (const step of [
      { op: 'split', id: 'times', to: { kind: 'workspaceSlot', name: 'secondary' } },
      { op: 'choose', target: { kind: 'field', id: 'times', name: 'NUM' }, value: '10' },
      { op: 'connect', id: 'rotation', to: { kind: 'connection', id: 'repeat', name: 'TIMES' } },
    ])
      await assert.rejects(
        () => compile({ ...tutorial, steps: [...tutorial.steps, step] }, adapter),
        /CAPABILITY|BLOCKLY|CONNECTION/,
      );
  } finally {
    await adapter.dispose();
  }
  const times = [
    ...new Set([
      0,
      scene.duration,
      ...scene.events.map((e) => e.time),
      ...scene.tracks.flatMap((t) => [t.start, (t.start + t.end) / 2, t.end]),
    ]),
  ];
  const samples = times.map((t) => evaluate(t, scene));
  for (let i = times.length - 1; i >= 0; i--) {
    assert.deepEqual(evaluate(times[i], scene), samples[i]);
    assert.equal(new Set(samples[i].nodes.map((n) => n.id)).size, samples[i].nodes.length);
    const ids = samples[i].nodes.flatMap((n) =>
      Object.keys(scene.manifest.resources[n.asset].anchors),
    );
    assert.equal(new Set(ids).size, ids.length, `Duplicate visible block at ${times[i]}`);
  }
  const out = root + '/artifacts/p2';
  await mkdir(out, { recursive: true });
  await writeFile(out + '/scene.json', JSON.stringify(scene));
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(server.url);
    const keyTimes = scene.tracks
      .filter((t) => t.kind === 'overlay' || t.kind === 'input')
      .map((t) => (t.start + t.end) / 2);
    const connected = scene.events.find((e) =>
      e.nodes?.some((n) => {
        const a = scene.manifest.resources[n.asset].anchors;
        return a.repeat && a.reporter;
      }),
    );
    keyTimes.push(connected.time + 0.3);
    const longInput = scene.tracks.find((t) => t.kind === 'input');
    const composing = longInput.frames.find((f) =>
      scene.manifest.resources[f.asset].input.text.endsWith('ji mu'),
    );
    assert.ok(composing);
    keyTimes.push(longInput.start + composing.offset);
    for (const [i, t] of keyTimes.entries()) {
      const svg = frameSvg(t, scene);
      await page.setContent(
        `<style>@font-face{font-family:'Motion Sans';src:url('${server.url}/font.ttf')}body{margin:0}</style>${svg}`,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/browser-${i}.png` });
      await writeFile(`${out}/video-${i}.png`, rasterFrame(scene, t, font));
      if (t === longInput.start + composing.offset) {
        const alignment = await page.evaluate(() => {
          const input = document.querySelector('[data-input-text] text');
          const prefix = input.textContent.indexOf('ji mu');
          const pos = input.getStartPositionOfChar(prefix);
          const expected = new DOMPoint(pos.x, pos.y).matrixTransform(input.getScreenCTM());
          const candidate = document.querySelector('[data-ime-candidate="0"]');
          const actual = new DOMPoint(
            candidate.x.baseVal[0].value,
            candidate.y.baseVal[0].value,
          ).matrixTransform(candidate.getScreenCTM());
          return { expected: expected.x, actual: actual.x };
        });
        assert.ok(Math.abs(alignment.actual - alignment.expected) < 1, JSON.stringify(alignment));
      }
      const difference = await page.evaluate(async (i) => {
        async function pixels(prefix) {
          const image = new Image();
          image.src = `/artifacts/p2/${prefix}-${i}.png`;
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
        let sum = 0,
          changed = 0;
        for (let k = 0; k < a.length; k += 4) {
          let max = 0;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a[k + c] - b[k + c]);
            sum += d;
            max = Math.max(max, d);
          }
          if (max > 32) changed++;
        }
        return { mean: sum / ((a.length / 4) * 3), changed: changed / (a.length / 4) };
      }, i);
      assert.ok(
        difference.mean < 3 && difference.changed < 0.025,
        JSON.stringify({ i, difference }),
      );
      assert.equal(
        await page.locator('[data-overlay]').count(),
        evaluate(t, scene).overlays.length,
      );
    }
  } finally {
    await browser?.close();
    await server.close();
  }
  if (process.env.P2_VIDEO === '1') {
    const report = await exportVideo(scene, { output: out + '/tutorial.mp4', font, fps: 30 });
    await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  }
});
