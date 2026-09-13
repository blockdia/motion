import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { serve, font } from '../../scripts/server.mjs';
import { rasterFrame } from '../../packages/renderer-video/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';

test('P3 real variants, responsive player, view transforms, races and disposal', async () => {
  await import('../../scripts/p3.mjs');
  const zh = JSON.parse(await readFile('artifacts/p3/scene.zh-CN.json'));
  const en = JSON.parse(await readFile('artifacts/p3/scene.en.json'));
  assert.equal(zh.duration, en.duration);
  assert.equal(en.manifest.targets.sprite.categories[0].label, 'Motion');
  assert.notDeepEqual(zh.manifest.resources, en.manifest.resources);
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url + '/apps/playground/index.html');
    await page.waitForFunction(() => window.ready);
    const draggingTime = zh.tracks
      .filter((t) => t.kind === 'node')
      .map((t) => t.start + 0.001)
      .find((t) => {
        const snapshot = evaluate(t, zh);
        return snapshot.nodes.some((n) => n.dragging) && snapshot.cursor.x < 311;
      });
    assert.ok(draggingTime !== undefined);
    await page.evaluate((time) => window.player.seek(time), draggingTime);
    const beforeCursor = await page.locator('[data-cursor-button]').boundingBox();
    const grip = () =>
      page.evaluate(() => {
        const block = document.querySelector('[data-dragged-stack]').getScreenCTM();
        const cursor = document.querySelector('[data-cursor-button]').getScreenCTM();
        return {
          x: (block.e - cursor.e) / window.player.view.zoom,
          y: (block.f - cursor.f) / window.player.view.zoom,
        };
      });
    const beforeGrip = await grip();
    const dragFrame = await page.locator('.motion-frame').boundingBox();
    await page.mouse.move(dragFrame.x + 600, dragFrame.y + 350);
    await page.mouse.down();
    await page.mouse.move(dragFrame.x + 650, dragFrame.y + 380);
    await page.mouse.up();
    const afterCursor = await page.locator('[data-cursor-button]').boundingBox();
    assert.ok(Math.abs(afterCursor.x - beforeCursor.x) < 1);
    assert.ok(Math.abs(afterCursor.y - beforeCursor.y) < 1);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => window.player.view.zoom > 1);
    const afterGrip = await grip();
    assert.ok(Math.abs(beforeGrip.x - afterGrip.x) < 0.001);
    assert.ok(Math.abs(beforeGrip.y - afterGrip.y) < 0.001);
    assert.equal(await page.evaluate(() => window.player.time), draggingTime);
    await page.evaluate(() => window.player.resetView());
    await page.mouse.wheel(20, 40);
    await page.waitForFunction(() => window.player.view.y === -40);
    assert.deepEqual(await page.evaluate(() => window.player.view), { x: -20, y: -40, zoom: 1 });
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 30);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => window.player.view.x === -50);
    assert.deepEqual(await page.evaluate(() => window.player.view), { x: -50, y: -40, zoom: 1 });
    await page.getByRole('button', { name: '放大', exact: true }).click();
    assert.equal(await page.evaluate(() => window.player.view.zoom), 1.2);
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    assert.equal(await page.evaluate(() => window.player.view.zoom), 1);
    await page.getByRole('button', { name: '恢复视角', exact: true }).press('Enter');
    assert.deepEqual(await page.evaluate(() => window.player.view), { x: 0, y: 0, zoom: 1 });
    const input = zh.tracks.find((t) => t.kind === 'input' && t.frames.some((f) => f.candidates));
    assert.ok(input);
    const time = input.start + input.frames.find((f) => f.candidates).offset;
    await page.evaluate((time) => window.player.seek(time), time);
    await page.evaluate(() => window.player.play());
    const initialFrame = await page.locator('.motion-frame').boundingBox();
    await page.mouse.move(initialFrame.x + 600, initialFrame.y + 350);
    await page.mouse.down();
    await page.mouse.move(initialFrame.x + 620, initialFrame.y + 360);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.player.playing), false);
    await page.evaluate((time) => window.player.seek(time), time);
    const original = await page.locator('[data-input-text]').boundingBox();
    const frame = await page.locator('.motion-frame').boundingBox();
    await page.mouse.move(frame.x + 600, frame.y + 350);
    await page.mouse.down();
    await page.mouse.move(frame.x + 650, frame.y + 380);
    await page.mouse.up();
    const shifted = await page.locator('[data-input-text]').boundingBox();
    assert.ok(Math.abs(shifted.x - original.x - 50) < 1);
    assert.ok(Math.abs(shifted.y - original.y - 30) < 1);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => window.player.view.zoom > 1);
    assert.equal(await page.evaluate(() => window.player.playing), false);
    assert.equal(await page.evaluate(() => window.player.time), time);
    await page.screenshot({ path: 'artifacts/p3/interaction.png' });
    await page.evaluate(() => window.player.play());
    assert.deepEqual(await page.evaluate(() => window.player.view), { x: 0, y: 0, zoom: 1 });
    await page.evaluate((time) => window.player.seek(time), time);
    await page.selectOption('#locale', 'en');
    await page.waitForFunction(() => window.player.appearance.locale === 'en');
    assert.equal(await page.evaluate(() => window.player.time), time);
    await page.selectOption('#theme', 'dark');
    await page.waitForFunction(() => window.player.appearance.theme === 'dark');
    assert.equal(await page.evaluate(() => window.player.time), time);
    assert.equal(await page.locator('#player').getAttribute('aria-busy'), 'false');
    for (const width of [1280, 800, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: `artifacts/p3/player-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const box = await page.locator('.motion-frame').boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');
      await page.waitForFunction(() => window.player.view.zoom > 1);
      await page.evaluate(() => window.player.resetView());
    }
    // Late results, cancellation, failed loads, and a retained disposed handle.
    const lifecycle = await page.evaluate(
      async ({ zh, en }) => {
        window.player.dispose();
        const { mountPlayer } = await import('/packages/renderer-browser/dist/index.js');
        const host = document.querySelector('#player');
        const original = JSON.stringify(zh);
        const jobs = [];
        const player = mountPlayer(host, zh, {
          loadVariant: (_next, signal) =>
            new Promise((resolve, reject) => jobs.push({ resolve, reject, signal })),
        });
        player.seek(2);
        const first = player.setOptions({ locale: 'en', theme: 'light' });
        const second = player.setOptions({ locale: 'zh-CN', theme: 'dark' });
        await second;
        jobs[0].resolve(en);
        await first;
        const latestWins =
          player.appearance.locale === 'zh-CN' &&
          player.appearance.theme === 'dark' &&
          jobs[0].signal.aborted;
        const failed = player.setOptions({ locale: 'en', theme: 'light' });
        jobs[1].reject(Error('test load failure'));
        await failed.catch(() => {});
        const preserved =
          player.time === 2 &&
          player.appearance.theme === 'dark' &&
          host.getAttribute('aria-busy') === 'false';
        const late = player.setOptions({ locale: 'en', theme: 'light' });
        player.dispose();
        jobs[2].resolve(en);
        await late;
        player.play();
        player.pause();
        player.seek(0);
        player.resetView();
        player.dispose();
        return {
          latestWins,
          preserved,
          empty: host.children.length === 0,
          released: !player.appearance,
          unchanged: JSON.stringify(zh) === original,
          aborted: jobs[2].signal.aborted,
        };
      },
      { zh, en },
    );
    assert.deepEqual(lifecycle, {
      latestWins: true,
      preserved: true,
      empty: true,
      released: true,
      unchanged: true,
      aborted: true,
    });
    // Both render backends use the same prepared locale geometry and theme.
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const locale of ['zh-CN', 'en'])
      for (const theme of ['light', 'dark']) {
        const base = locale === 'en' ? en : zh;
        const scene = { ...base, manifest: { ...base.manifest, colorTheme: theme } };
        const name = `${locale}-${theme}`;
        const svg = frameSvg(time, scene);
        await page.setContent(
          `<style>@font-face{font-family:'Motion Sans';src:url('${server.url}/font.ttf')}body{margin:0}</style>${svg}`,
        );
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `artifacts/p3/${name}-browser.png` });
        await writeFile(`artifacts/p3/${name}-video.png`, rasterFrame(scene, time, font));
        const diff = await page.evaluate(async (name) => {
          const pixels = async (suffix) => {
            const image = new Image();
            image.src = `/artifacts/p3/${name}-${suffix}.png`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, 1280, 720).data;
          };
          const a = await pixels('browser'),
            b = await pixels('video');
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
          return { mean: sum / (1280 * 720 * 3), changed: changed / (1280 * 720) };
        }, name);
        assert.ok(diff.mean < 3 && diff.changed < 0.025, JSON.stringify({ name, diff }));
      }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
