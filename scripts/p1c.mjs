import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { targetProject } from '../tests/fixtures/target-project.mjs';
import { compile, defineTutorial } from '../packages/authoring/dist/index.js';
import { createAdapter } from '../packages/asset-builder/dist/index.js';
import { evaluate } from '../packages/core/dist/index.js';
import { frameSvg } from '../packages/renderer-browser/dist/index.js';
import { rasterFrame, exportVideo } from '../packages/renderer-video/dist/index.js';
import { serve, root, font } from './server.mjs';
const project = targetProject(),
  out = root + '/artifacts/p1c',
  baseline = root + '/docs/p1c-baseline';
await mkdir(out, { recursive: true });
await mkdir(baseline, { recursive: true });
const start = performance.now();
const adapter = await createAdapter({ project });
let scene;
try {
  const tutorial = defineTutorial({
    schemaVersion: 1,
    adapter: 'turbowarp',
    viewport: { width: 1280, height: 720 },
    defaults: { theme: 'light', locale: 'zh-CN' },
    project,
    initialTarget: 'stage',
    build(s) {
      const steps = [];
      for (const target of project.targets) {
        steps.push(s.selectTarget(target.id));
        for (const category of ['motion', 'control', 'myBlocks'])
          steps.push(s.toolbox.selectCategory(category, 0.1), s.wait(0.2));
        if (!target.isStage) {
          const opcode = target.id === 'sprite' ? 'motion_turnright' : 'control_wait';
          const entry = adapter.manifest.targets[target.id].toolbox.find(
            (e) => e.definition.opcode === opcode,
          );
          steps.push(
            s.dragFromToolbox(entry.key, {
              id: target.id + '.example',
              to: s.workspace.slot('main'),
              duration: 0.3,
            }),
            s.wait(0.1),
          );
        }
      }
      steps.push(s.selectTarget('sprite'), s.wait(0.2));
      return steps;
    },
  });
  scene = await compile(tutorial, adapter);
  await writeFile(out + '/tutorial.json', JSON.stringify(tutorial, null, 2));
} finally {
  await adapter.dispose();
}
await writeFile(out + '/scene.json', JSON.stringify(scene, null, 2));
const report = {
  source: scene.manifest.source,
  preparationMs: performance.now() - start,
  targets: Object.fromEntries(
    Object.entries(scene.manifest.targets).map(([id, c]) => [
      id,
      {
        categories: c.categories.length,
        entries: c.toolbox.length,
        contentHeight: c.contentHeight,
      },
    ]),
  ),
  keyframes: [],
};
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + '/apps/playground/index.html?scene=/artifacts/p1c/scene.json');
  await page.waitForFunction(() => window.ready);
  const samples = scene.events
    .filter((e) => e.toolbox && e.step.includes('steps[') && !e.targetId && !e.step.includes(':'))
    .map((e) => e.time);
  samples.push(scene.duration);
  for (const [index, time] of samples.entries()) {
    const state = evaluate(time, scene),
      name = `${index}-${state.targetId}-${state.toolbox.category}`;
    await page.evaluate((t) => window.player.seek(t), time);
    const target = project.targets.find((target) => target.id === state.targetId);
    assert.deepEqual(
      await page
        .locator('[data-property]')
        .evaluateAll((fields) =>
          Object.fromEntries(
            fields.map((field) => [field.getAttribute('data-property'), field.textContent]),
          ),
        ),
      {
        name: target.isStage ? '名字' : target.name,
        x: target.isStage ? 'x' : String(Math.round(target.x)),
        y: target.isStage ? 'y' : String(Math.round(target.y)),
        size: target.isStage ? '' : String(Math.round(target.size)),
        direction: target.isStage ? '' : String(Math.round(target.direction)),
      },
    );
    assert.deepEqual(
      await page
        .locator('[data-visibility][aria-pressed="true"]')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-visibility'))),
      target.isStage ? [] : [target.visible ? 'show' : 'hide'],
    );
    assert.deepEqual(
      await page.locator('[data-ui="sprite-list"] [data-target-id]').evaluateAll((tiles) =>
        tiles.map((tile) => ({
          id: tile.getAttribute('data-target-id'),
          name: tile.querySelector('title').textContent,
        })),
      ),
      project.targets
        .filter((target) => !target.isStage)
        .map((target) => ({ id: target.id, name: target.name })),
    );
    assert.deepEqual(
      await page
        .locator('[data-ui="targets"] [data-selected="true"]')
        .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-target-id'))),
      [state.targetId],
    );
    await page.locator('.motion-frame').screenshot({ path: `${out}/browser-${name}.png` });
    await writeFile(`${out}/video-${name}.png`, rasterFrame(scene, time, font));
    const difference = await page.evaluate(async (name) => {
      async function pixels(prefix) {
        const im = new Image();
        im.src = `/artifacts/p1c/${prefix}-${name}.png`;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(im, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      }
      const a = await pixels('browser'),
        b = await pixels('video');
      let sum = 0,
        changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        let max = 0;
        for (let j = 0; j < 3; j++) {
          const d = Math.abs(a[i + j] - b[i + j]);
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
    for (const prefix of ['browser', 'video'])
      await copyFile(`${out}/${prefix}-${name}.png`, `${baseline}/${prefix}-${name}.png`);
  }
  // Rendering-only stress fixture: reuse prepared blocks and vary the target panel.
  const many = structuredClone(scene);
  const sprite = many.manifest.project.targets.find((target) => !target.isStage);
  const longName = '很长的角色名称 $& <script> & "测试"';
  many.manifest.project.targets = [
    many.manifest.project.targets[0],
    ...Array.from({ length: 15 }, (_, index) => ({
      ...sprite,
      id: `sprite-${index}`,
      name: index === 14 ? longName : `角色 ${index + 1}`,
    })),
  ];
  for (const target of many.manifest.project.targets)
    many.manifest.targets[target.id] = scene.manifest.targets[target.isStage ? 'stage' : 'sprite'];
  many.initial.targetId = 'sprite-14';
  many.events = [];
  many.tracks = [];
  await page.locator('.motion-frame').evaluate(
    (host, svg) => {
      host.innerHTML = svg;
    },
    frameSvg(0, many),
  );
  const tile = page.locator('[data-target-id="sprite-14"]');
  assert.equal(await tile.locator('title').textContent(), longName);
  assert.equal(await page.locator('.motion-frame script').count(), 0);
  const tileBounds = await tile.boundingBox();
  assert.ok(
    tileBounds.y >= 565 && tileBounds.y + tileBounds.height < 658,
    JSON.stringify(tileBounds),
  );
  await page.locator('.motion-frame').screenshot({ path: `${baseline}/browser-targets-many.png` });
  await writeFile(`${baseline}/video-targets-many.png`, rasterFrame(many, 0, font));
  many.manifest.project.targets = many.manifest.project.targets.filter((target) => target.isStage);
  many.initial.targetId = 'stage';
  await page.locator('.motion-frame').evaluate(
    (host, svg) => {
      host.innerHTML = svg;
    },
    frameSvg(0, many),
  );
  assert.equal(await page.locator('[data-ui="sprite-list"] [data-target-id]').count(), 0);
  assert.equal(
    await page.locator('[data-target-id="stage"]').getAttribute('data-selected'),
    'true',
  );
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => typeof window.Blockly), 'undefined');
} finally {
  await browser?.close();
  await server.close();
}
report.export = await exportVideo(scene, { output: out + '/p1c.mp4', font, fps: 30 });
report.probe = JSON.parse(
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
      out + '/p1c.mp4',
    ],
    { encoding: 'utf8' },
  ),
).streams[0];
assert.equal(Number(report.probe.nb_read_frames), report.export.frames);
await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
await copyFile(out + '/report.json', baseline + '/report.json');
console.log(JSON.stringify(report, null, 2));
