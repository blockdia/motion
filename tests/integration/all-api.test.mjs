import test from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import tutorial from '../../examples/all-api/tutorial.ts';
import { mkdir, writeFile } from 'node:fs/promises';
test('all API tutorial prepares in the consuming playground; persistent nodes, controls, and disposal', async () => {
  const bundle = await bundleTutorial(tutorial);
  await mkdir('artifacts/all-api', { recursive: true });
  await writeFile('artifacts/all-api/tutorial.json', JSON.stringify(bundle));
  const h = await openBrowser();
  try {
    const errors = [];
    h.page.on('pageerror', (e) => errors.push(e.message));
    await h.page.goto(
      h.server.url + '/apps/playground/index.html?scene=/artifacts/all-api/tutorial.json',
    );
    await h.page.waitForFunction(() => window.ready === true, {}, { timeout: 60000 });
    assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
    await h.page.evaluate(() => window.player.seek(2));
    const stable = await h.page.evaluate(async () => {
      const root = document.querySelector('.motion-scene'),
        path = document.querySelector('[data-cursor-button]');
      await window.player.seek(2.1);
      return (
        root === document.querySelector('.motion-scene') &&
        path === document.querySelector('[data-cursor-button]')
      );
    });
    assert.equal(stable, true);
    for (const t of [0, 1.5, 5, 8, 12, 16, 20, 25, 26.8, 2])
      await h.page.evaluate((t) => window.player.seek(t), t);
    const boundary = await h.page.evaluate(async () => {
      await window.player.seek(0.5);
      const raf = window.requestAnimationFrame,
        cancel = window.cancelAnimationFrame;
      let callback;
      window.requestAnimationFrame = (cb) => ((callback = cb), 0);
      window.cancelAnimationFrame = () => {};
      try {
        const earlier = performance.now() - 16;
        window.player.play();
        await callback(earlier);
        return window.player.time;
      } finally {
        window.player.pause();
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = cancel;
      }
    });
    assert.equal(boundary, 0.5);
    await h.page.locator('.motion-frame').focus();
    await h.page.keyboard.press('ArrowLeft');
    assert.equal(await h.page.evaluate(() => window.player.view.x), 30);
    await h.page.keyboard.press('0');
    assert.equal(await h.page.evaluate(() => window.player.view.x), 0);
    await h.page.evaluate(() => {
      window.player.setCursorClickEffect('shrink');
      window.player.setCursorMotion('curve');
    });
    assert.equal(await h.page.evaluate(() => window.player.cursorMotion), 'curve');
    for (const width of [375, 800, 1280]) {
      await h.page.setViewportSize({ width, height: 900 });
      await h.page.evaluate(() => window.player.seek(4));
      await h.page.screenshot({
        path: `artifacts/migration/playground-${width}.png`,
        fullPage: true,
      });
      const overflow = await h.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false);
    }
    await h.page.evaluate(() => window.player.dispose());
    assert.equal(await h.page.locator('#player > *').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await h.close();
  }
});
