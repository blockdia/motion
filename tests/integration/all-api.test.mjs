import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import tutorial from '../../examples/all-api/tutorial.ts';
import { compile } from '../../packages/authoring/dist/index.js';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';
import { rasterFrame } from '../../packages/renderer-video/dist/index.js';
import { serve, font } from '../../scripts/server.mjs';

test('all authoring operations compile and play in the consuming playground', async () => {
  const operations = new Set(),
    direct = new Set();
  function visit(step) {
    (step.mode === 'direct' ? direct : operations).add(step.op);
    step.steps?.forEach(visit);
  }
  tutorial.steps.forEach(visit);
  assert.deepEqual(
    [...operations].sort(),
    [
      'sequence',
      'parallel',
      'wait',
      'dragFromToolbox',
      'create',
      'paste',
      'move',
      'connect',
      'type',
      'split',
      'delete',
      'contextMenu',
      'highlight',
      'annotate',
      'setField',
      'choose',
      'selectTarget',
      'selectCategory',
      'reveal',
    ].sort(),
  );
  assert.equal(direct.size, 8);
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
  } finally {
    await adapter.dispose();
  }
  assert.deepEqual(scene.finalTargets.sprite, []);
  const out = 'artifacts/all-api';
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/scene.json`, JSON.stringify(scene));
  const preview = scene.tracks.find((t) => t.kind === 'preview');
  const menu = scene.tracks.find((t) => t.kind === 'overlay' && t.menu?.context);
  const times = { preview: (preview.start + preview.end) / 2, menu: (menu.start + menu.end) / 2 };
  for (const [name, t] of Object.entries(times)) {
    await writeFile(`${out}/${name}.png`, rasterFrame(scene, t, font));
    assert.equal(frameSvg(t, scene), frameSvg(t, JSON.parse(JSON.stringify(scene))));
  }
  const server = await serve();
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.url}/apps/playground/index.html?scene=/artifacts/all-api/scene.json`);
    await page.locator('#player input[type=range]').waitFor();
    for (const [name, t] of Object.entries(times)) {
      await page.locator('#player input[type=range]').evaluate((el, t) => {
        el.value = String(t);
        el.dispatchEvent(new Event('input'));
      }, t);
      await page.locator('.motion-frame').screenshot({ path: `${out}/browser-${name}.png` });
      assert.equal(
        await page.locator('[data-overlay]').count(),
        evaluate(t, scene).overlays.length,
      );
    }
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('#player button').textContent === '暂停',
    );
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
