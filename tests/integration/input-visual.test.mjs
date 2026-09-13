import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import tutorial from '../../examples/structural-editing/tutorial.ts';
import { rendererHarness } from './helpers.mjs';
test('native measured input, dropdown and IME are HTML; anchors survive system-font layout', async () => {
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
  } finally {
    await adapter.dispose();
  }
  const h = await rendererHarness(scene);
  try {
    const input = scene.tracks.find((t) => t.kind === 'input');
    const candidates = input.frames.filter((f) => f.candidates?.length);
    assert.ok(candidates.length);
    for (const f of [input.frames[0], candidates[0], candidates.at(-1), input.frames.at(-1)]) {
      const t = input.start + f.offset;
      await h.draw(t);
      const expected = evaluate(t, scene).input;
      assert.ok(expected);
      const measured = await h.page.locator('[data-input-text]:not([hidden])').evaluate((el) => ({
        tag: el.tagName,
        text: el.dataset.inputText,
        width: el.getBoundingClientRect().width,
        input: el.querySelector('input').value,
      }));
      assert.equal(measured.tag, 'DIV');
      assert.equal(measured.text, expected.appearance.text);
      assert.equal(measured.input, expected.appearance.text);
      assert.ok(Math.abs(measured.width - expected.appearance.bounds.width * expected.scale) < 0.1);
      if (f.candidates?.length) {
        assert.equal(await h.page.locator('[data-overlay="ime"]:not([hidden])').count(), 1);
        assert.equal(
          await h.page.locator('[data-ime-candidate="0"]').textContent(),
          f.candidates[0],
        );
      }
    }
    await h.screenshot('input-system-font');
    const menu =
      scene.tracks.find((t) => t.kind === 'overlay' && t.menu) ??
      scene.tracks.find((t) => t.step.endsWith(':menu'));
    assert.ok(menu);
    await h.draw((menu.start + menu.end) / 2);
    assert.equal(
      await h.page.locator('[data-overlay="menu"]:not([hidden])').evaluate((e) => e.tagName),
      'DIV',
    );
    await h.screenshot('menu-system-font');
  } finally {
    await h.close();
  }
});
