import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
import { rendererHarness } from './helpers.mjs';
test('workspace continues under translucent flyout and dragged SVG stays above it', async () => {
  const a = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, a);
  } finally {
    await a.dispose();
  }
  const h = await rendererHarness(scene);
  try {
    const geometry = await h.page.evaluate(() => ({
      workspace: window.shell.layout.workspace,
      toolbox: window.shell.layout.toolbox,
      bg: getComputedStyle(window.shell.toolbox.parentElement).backgroundColor,
      dragAbove: !!(
        window.shell.toolbox.parentElement.compareDocumentPosition(
          window.shell.dragWorld.parentElement,
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
    }));
    assert.equal(geometry.workspace.x, geometry.toolbox.x);
    assert.match(geometry.bg, /0\.8/);
    assert.equal(geometry.dragAbove, true);
    const moving = scene.tracks.find((t) => t.kind === 'node');
    assert.ok(moving);
    await h.draw((moving.start + moving.end) / 2, { x: 70, y: 30, zoom: 1.2 });
    assert.ok((await h.page.locator('[data-dragged-stack="true"]:not([hidden])').count()) > 0);
    await h.screenshot('toolbox-layering');
  } finally {
    await h.close();
  }
});
