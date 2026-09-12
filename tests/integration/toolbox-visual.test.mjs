import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';
import { rasterFrame } from '../../packages/renderer-video/dist/index.js';
import { serve, root, font } from '../../scripts/server.mjs';
import tutorial from '../../examples/basic-editing/tutorial.ts';

test('workspace continues under translucent flyout while dragged blocks stay above it', async () => {
  const out = root + '/artifacts/toolbox-regression';
  await mkdir(out, { recursive: true });
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
  } finally {
    await adapter.dispose();
  }
  scene.initial = evaluate(scene.duration, scene);
  scene.events = [];
  scene.tracks = [];
  // A solid resource makes alpha and clipping measurable away from text/antialiasing.
  scene.manifest.resources.probe = {
    ...Object.values(scene.manifest.resources)[0],
    content: '<rect width="200" height="40" fill="#ff0000"/>',
  };
  const sample = scene.initial.nodes[0];
  scene.initial.nodes = [
    { ...sample, id: 'under', asset: 'probe', x: 260, y: 400, opacity: 1, dragging: false },
    { ...sample, id: 'over', asset: 'probe', x: 260, y: 450, opacity: 1, dragging: true },
  ];
  assert.equal(scene.manifest.layout.workspace.x, scene.manifest.layout.toolbox.x);
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(server.url + '/packages/asset-builder/prepare.html');
    const svg = frameSvg(0, scene);
    await page.evaluate((svg) => {
      document.body.style.margin = '0';
      document.body.innerHTML = svg;
    }, svg);
    await page.screenshot({ path: out + '/browser.png' });
    await writeFile(out + '/video.png', rasterFrame(scene, 0, font));
    for (const name of ['browser', 'video']) {
      const colors = await page.evaluate(async (name) => {
        const image = new Image();
        image.src = '/artifacts/toolbox-regression/' + name + '.png';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return [
          [280, 410],
          [350, 410],
          [280, 460],
        ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
      }, name);
      for (const [actual, expected] of colors.map((c, i) => [
        c,
        i === 0 ? [250, 199, 199] : [255, 0, 0],
      ]))
        assert.ok(
          actual.every((v, i) => Math.abs(v - expected[i]) <= 1),
          name + ': ' + JSON.stringify(colors),
        );
    }
    // Keep a real-block preview straddling the same boundary for visual inspection.
    scene.initial.nodes = [{ ...sample, x: 260, y: 190, dragging: false }];
    await page.evaluate(
      (svg) => {
        document.body.innerHTML = svg;
      },
      frameSvg(0, scene),
    );
    await page.screenshot({ path: out + '/blocks.png' });
  } finally {
    await browser?.close();
    await server.close();
  }
});
