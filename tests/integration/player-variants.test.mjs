import test from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
test('client font/theme/language variants, two isolated players, cancellation and failure recovery', async () => {
  const zh = await bundleTutorial(tutorial),
    en = await bundleTutorial({ ...tutorial, defaults: { theme: 'light', locale: 'en' } });
  const h = await openBrowser({ font: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' });
  try {
    await h.page.goto(h.runtimeUrl + 'player.html');
    await h.page.evaluate(
      async ({ zh, en }) => {
        window.zh = zh;
        window.en = en;
        const { mountPlayer } = await import('./modules/renderer-browser/index.js');
        window.mount = mountPlayer;
        window.player = await window.mountTutorial(zh, { loadVariant: async () => en });
      },
      { zh, en },
    );
    await h.page.evaluate(() => window.player.seek(1));
    for (const locale of ['zh-CN', 'en'])
      for (const theme of ['light', 'dark']) {
        await h.page.evaluate(({ locale, theme }) => window.player.setOptions({ locale, theme }), {
          locale,
          theme,
        });
        assert.equal(await h.page.evaluate(() => window.player.time), 1);
        assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
        assert.equal(await h.page.evaluate(() => window.player.appearance.theme), theme);
        const native = await h.page.evaluate(
          async ({ locale, theme }) => {
            const template = await (await fetch(`./shell.${locale}.${theme}.json`)).json(),
              origin = document.querySelector('.motion-scene').getBoundingClientRect();
            return Object.entries(template.reference).map(([name, r]) => {
              const e = document.querySelector(`[data-native="${name}"]`),
                a = e.getBoundingClientRect();
              return {
                name,
                expected: r,
                actual: {
                  x: a.x - origin.x,
                  y: a.y - origin.y,
                  width: a.width,
                  height: a.height,
                  background: getComputedStyle(e).backgroundColor,
                  borderColor: getComputedStyle(e).borderTopColor,
                },
              };
            });
          },
          { locale, theme },
        );
        for (const { name, actual, expected } of native) {
          for (const key of ['x', 'y', 'width', 'height'])
            assert.ok(
              Math.abs(actual[key] - expected[key]) < 1,
              `${locale}/${theme}/${name}.${key}: ${actual[key]} vs ${expected[key]}`,
            );
          assert.equal(actual.background, expected.background);
          assert.equal(actual.borderColor, expected.borderColor);
        }

        await h.page
          .locator('.motion-scene')
          .screenshot({ path: `artifacts/browser-tests/${locale}-${theme}.png` });
      }
    const widths = [];
    for (const family of ['monospace', 'serif']) {
      await h.page.evaluate(async (family) => {
        await window.player.setOptions({ locale: 'en', theme: 'light', font: { family } });
        await window.player.seek(window.player.duration);
      }, family);
      widths.push(
        await h.page
          .locator('.motion-scene svg text')
          .first()
          .evaluate((e) => e.getBoundingClientRect().width),
      );
    }
    assert.notEqual(widths[0], widths[1]);
    const failed = await h.page.evaluate(async () => {
      const old = document.querySelector('.motion-scene');
      try {
        await window.player.setOptions({
          locale: 'en',
          theme: 'light',
          font: { family: 'Missing Font', url: '/absent-font.ttf' },
        });
        return false;
      } catch {
        return old === document.querySelector('.motion-scene');
      }
    });
    assert.equal(failed, true);
    await h.page.evaluate(async () => {
      const a = window.player.setOptions({ locale: 'en', theme: 'dark' });
      const b = window.player.setOptions({ locale: 'en', theme: 'light' });
      await Promise.allSettled([a, b]);
    });
    assert.equal(await h.page.evaluate(() => window.player.appearance.theme), 'light');
    const multiple = await h.page.evaluate(async () => {
      const font = { family: 'Shared Requested Font', url: '/font.ttf' };
      await window.player.setOptions({ locale: 'en', theme: 'light', font });
      const firstFamily = getComputedStyle(document.querySelector('.motion-scene')).fontFamily;
      const div = document.createElement('div');
      div.style.width = '1280px';
      document.body.append(div);
      const second = window.mount(div, window.en, {
        font,
        runtimeUrl: new URL('./', location.href).href,
      });
      await second.ready;
      await second.seek(1);
      const ids = Array.from(document.querySelectorAll('.motion-scene [id]'), (e) => e.id);
      const unique =
        new Set(ids).size === ids.length &&
        firstFamily !== getComputedStyle(div.querySelector('.motion-scene')).fontFamily &&
        firstFamily === getComputedStyle(document.querySelector('.motion-scene')).fontFamily;
      second.dispose();
      div.remove();
      return unique;
    });
    assert.equal(multiple, true);
    await h.page.evaluate(async () => {
      const pending = window.player.setOptions({ locale: 'en', theme: 'dark' });
      window.player.dispose();
      await Promise.allSettled([pending]);
    });
    assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
    assert.equal(await h.page.locator('.motion-scene').count(), 0);
    const destroyed = await h.page.evaluate(async () => {
      const div = document.createElement('div');
      document.body.append(div);
      const p = window.mount(div, window.zh, { runtimeUrl: new URL('./', location.href).href });
      p.dispose();
      await Promise.allSettled([p.ready]);
      const clean = div.children.length === 0;
      div.remove();
      return clean;
    });
    assert.equal(destroyed, true);
  } finally {
    await h.close();
  }
});
