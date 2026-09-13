import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import tutorial from '../../examples/all-api/tutorial.ts';
import { rendererHarness } from './helpers.mjs';

test('SVG origins, cursor stacking, compact annotations, complete IME, dropdown arrows and selection chrome', async () => {
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
  } finally {
    await adapter.dispose();
  }
  const h = await rendererHarness(scene);
  try {
    const times = new Set([scene.duration]);
    for (const track of scene.tracks) {
      if (track.kind === 'overlay') times.add((track.start + track.end) / 2);
      if (track.kind === 'input')
        for (const frame of track.frames) {
          if (frame.candidates?.length) times.add(track.start + frame.offset);
        }
    }
    for (const event of scene.events) if (event.targetId) times.add(event.time + 0.001);
    let menus = 0,
      imes = 0,
      annotations = 0,
      unselected = 0;
    for (const time of times) {
      await h.draw(time);
      const expected = evaluate(time, scene);
      const actual = await h.page.evaluate(() => {
        const root = window.shell.root,
          origin = root.getBoundingClientRect();
        const rect = (e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
        };
        return {
          workspace: window.shell.layout.workspace,
          highlights: Array.from(
            root.querySelectorAll('[data-layer^="highlight"]:not([hidden])'),
          ).map((e) => ({
            border: getComputedStyle(e).borderWidth,
            outline: getComputedStyle(e).outlineWidth,
            offset: getComputedStyle(e).outlineOffset,
          })),
          nodes: Array.from(window.shell.world.children)
            .filter((e) => !e.hidden)
            .map((e) => rect(e.querySelector('svg'))),
          menus: Array.from(root.querySelectorAll('[data-overlay="menu"]:not([hidden])')).map(
            (e) => !!e.querySelector('[data-menu-arrow]'),
          ),
          imes: Array.from(root.querySelectorAll('[data-overlay="ime"]:not([hidden])')).map(
            (e) => ({
              box: rect(e),
              clipped: e.scrollWidth > e.clientWidth + 1,
              candidates: Array.from(e.querySelectorAll('[data-ime-candidate]')).map(rect),
            }),
          ),
          annotations: Array.from(
            root.querySelectorAll('[data-overlay="annotation"]:not([hidden])'),
          ).map((e) => {
            const r = document.createRange();
            r.selectNodeContents(e);
            return {
              height: e.getBoundingClientRect().height,
              text: r.getBoundingClientRect().height,
            };
          }),
          tiles: Array.from(root.querySelectorAll('[data-ui="sprite-list"] [data-target-id]')).map(
            (e) => ({
              selected: e.dataset.selected === 'true',
              deletion: !!e.querySelector('[aria-label="Delete"]:not([hidden])'),
            }),
          ),
        };
      });
      for (const h of actual.highlights) {
        assert.equal(h.border, '0px');
        assert.equal(h.outline, '3px');
        assert.equal(h.offset, '2px');
      }
      const nodes = expected.nodes.filter((n) => !n.dragging);
      for (let i = 0; i < nodes.length; i++) {
        // The one-pixel SVG viewport must start at the scene origin, without a text baseline offset.
        assert.ok(
          actual.nodes.some(
            (r) =>
              Math.abs(
                r.x - nodes[i].x - (actual.workspace.x - scene.manifest.layout.workspace.x),
              ) < 0.1 &&
              Math.abs(
                r.y - nodes[i].y - (actual.workspace.y - scene.manifest.layout.workspace.y),
              ) < 0.1,
          ),
          JSON.stringify({ time, expected: nodes[i], actual: actual.nodes }),
        );
      }
      for (const menu of expected.overlays.filter((o) => o.menu)) {
        if (!menu.menu.context) {
          assert.ok(actual.menus.includes(true));
          const gap = menu.menu.above
            ? menu.bounds.y - menu.menu.panel.y - menu.menu.panel.height
            : menu.menu.panel.y - menu.bounds.y - menu.bounds.height;
          assert.ok(gap >= 19.9);
          if (!menus) await h.screenshot('fixed-dropdown');
          menus++;
        }
      }
      for (const ime of actual.imes) {
        assert.equal(ime.clipped, false);
        const w = actual.workspace;
        assert.ok(ime.box.x >= w.x && ime.box.x + ime.box.width <= w.x + w.width);
        for (const candidate of ime.candidates)
          assert.ok(candidate.x + candidate.width <= ime.box.x + ime.box.width + 0.5);
        if (!imes) await h.screenshot('fixed-ime');
        imes++;
      }
      for (const a of actual.annotations) {
        assert.ok(a.height - a.text < 25);
        if (!annotations) await h.screenshot('fixed-annotation');
        annotations++;
      }
      for (const t of actual.tiles) {
        assert.equal(t.deletion, t.selected);
        if (!t.selected) unselected++;
      }
    }
    assert.ok(menus && imes && annotations && unselected);
    const menuTrack = scene.tracks.find((t) => t.kind === 'overlay' && t.menu && !t.menu.context);
    await h.draw((menuTrack.start + menuTrack.end) / 2);
    const arrowClip = await h.page.evaluate(() => {
      const menu = document.querySelector('[data-overlay="menu"]:not([hidden])');
      menu.firstElementChild.style.background = 'rgb(20,40,60)';
      const arrow = menu.querySelector('[data-menu-arrow]'),
        r = arrow.getBoundingClientRect(),
        m = menu.getBoundingClientRect();
      return { x: Math.floor(r.x + r.width / 2), y: Math.floor(m.y + 8), width: 2, height: 2 };
    });
    const menuPixel = await h.page.screenshot({ clip: arrowClip });
    await h.page.locator('[data-menu-arrow]').evaluate((e) => (e.hidden = true));
    assert.deepEqual(menuPixel, await h.page.screenshot({ clip: arrowClip }));
    // Pixel check inside the category strip: removing the native shell behind the cursor
    // must not change an opaque cursor pixel.
    await h.page.evaluate(() => {
      window.shell.cursor.style.transform = 'translate(25px,200px)';
    });
    const clip = { x: 28, y: 210, width: 2, height: 2 };
    const before = await h.page.screenshot({ clip });
    await h.page.locator('[data-native-root]').evaluate((e) => (e.style.visibility = 'hidden'));
    const after = await h.page.screenshot({ clip });
    assert.deepEqual(before, after);
  } finally {
    await h.close();
  }
});
