import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import tutorial from '../../examples/all-api/tutorial.ts';
import { rendererHarness } from './helpers.mjs';

for (const theme of ['light', 'dark']) {
  test(`${theme} player text uses its own theme instead of the host page color`, async () => {
    const adapter = await createAdapter({ project: tutorial.project, theme });
    let scene;
    try {
      scene = await compile({ ...tutorial, defaults: { ...tutorial.defaults, theme } }, adapter);
    } finally {
      await adapter.dispose();
    }
    assert.equal(scene.manifest.colorTheme, theme);
    const h = await rendererHarness(scene);
    try {
      await h.page.evaluate((theme) => {
        document.body.style.color = theme === 'light' ? 'white' : 'black';
      }, theme);
      const expected = await h.page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--text)';
        window.shell.root.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      assert.notEqual(
        await h.page.locator('body').evaluate((e) => getComputedStyle(e).color),
        expected,
      );
      const readColor = (selector) =>
        h.page
          .locator(selector)
          .evaluateAll((elements) =>
            elements.map((e) => ({ text: e.textContent, color: getComputedStyle(e).color })),
          );
      const decorations = await readColor('[data-decorations] > div');
      assert.ok(decorations.some((e) => e.text));
      for (const decoration of decorations) assert.equal(decoration.color, expected);

      const annotation = scene.tracks.find((t) => t.kind === 'overlay' && t.text);
      assert.ok(annotation);
      await h.draw((annotation.start + annotation.end) / 2);
      const annotations = await readColor('[data-overlay="annotation"]:not([hidden])');
      assert.ok(annotations.length);
      for (const annotation of annotations) assert.equal(annotation.color, expected);
      await h.screenshot(`text-colors-${theme}-annotation`);

      const input = scene.tracks.find(
        (t) => t.kind === 'input' && t.frames.some((f) => f.candidates?.length > 1),
      );
      assert.ok(input);
      const frame = input.frames.find((f) => f.candidates?.length > 1);
      await h.draw(input.start + frame.offset);
      const candidates = await readColor('[data-overlay="ime"]:not([hidden]) [data-ime-candidate]');
      assert.equal(candidates.length, frame.candidates.length);
      assert.equal(candidates[0].color, 'rgb(255, 255, 255)');
      for (const candidate of candidates.slice(1)) assert.equal(candidate.color, expected);
      const numbers = await readColor('[data-overlay="ime"]:not([hidden]) small');
      assert.equal(numbers[0].color, 'rgb(255, 255, 255)');
      for (const number of numbers.slice(1)) assert.equal(number.color, expected);
      await h.screenshot(`text-colors-${theme}-ime`);

      const context = scene.tracks.find(
        (t) => t.kind === 'overlay' && t.menu?.context && t.menu.hovered >= 0,
      );
      assert.ok(context);
      await h.draw((context.start + context.end) / 2);
      const menu = await h.page.locator('[data-overlay="menu"]:not([hidden])').evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        rows: Array.from(el.children, (row) => ({
          color: getComputedStyle(row).color,
          background: getComputedStyle(row).backgroundColor,
          opacity: getComputedStyle(row).opacity,
        })),
      }));
      const colors = scene.manifest.appearance.blocks;
      assert.equal(menu.background, colors.contextMenuBackground);
      assert.equal(menu.rows.length, context.menu.options.length);
      for (const [index, row] of menu.rows.entries()) {
        assert.equal(
          row.color,
          context.menu.enabled?.[index] === false
            ? colors.contextMenuDisabledForeground
            : colors.contextMenuForeground,
        );
        assert.equal(row.opacity, '1');
        assert.equal(
          row.background,
          index === context.menu.hovered ? colors.contextMenuActiveBackground : 'rgba(0, 0, 0, 0)',
        );
      }
      assert.notEqual(
        menu.rows[context.menu.hovered].color,
        menu.rows[context.menu.hovered].background,
      );
      await h.screenshot(`text-colors-${theme}-context-menu`);
    } finally {
      await h.close();
    }
  });
}
