import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import tutorial from '../../examples/structural-editing/tutorial.ts';

test('real Blockly structural editing, shadow restoration and deterministic timeline states', async () => {
  const adapter = await createAdapter({ project: tutorial.project });
  let scene;
  try {
    scene = await compile(tutorial, adapter);
    const count = Object.keys(adapter.manifest.resources).length;
    assert.deepEqual(await compile(JSON.parse(JSON.stringify(tutorial)), adapter), scene);
    assert.equal(Object.keys(adapter.manifest.resources).length, count);
    const previews = scene.tracks.filter((t) => t.kind === 'preview');
    assert.equal(previews.length, 5);
    assert.ok(
      previews.some((p) => /feGaussianBlur/.test(scene.manifest.resources[p.asset].content)),
    );
    assert.ok(
      previews.some((p) =>
        /blocklyInsertionMarker/.test(scene.manifest.resources[p.asset].content),
      ),
    );
    assert.ok(previews.some((p) => p.step.endsWith(':dropdown')));
    for (const preview of previews) {
      const prepared = scene.manifest.resources[preview.asset];
      assert.ok(prepared.content);
      const middle = evaluate((preview.start + preview.end) / 2, scene);
      assert.equal(middle.nodes.find((n) => n.id === preview.id).asset, preview.asset);
      assert.notEqual(
        evaluate(preview.end, scene).nodes.find((n) => n.id === preview.id).asset,
        preview.asset,
      );
    }
    const typing = scene.tracks.find((t) => t.kind === 'input');
    assert.ok(
      scene.manifest.resources[typing.frames.at(-1).asset].box.width >
        scene.manifest.resources[typing.frames[1].asset].box.width,
    );
    const roots = scene.finalTargets.sprite;
    assert.equal(roots.length, 2);
    assert.equal(roots[0].inputs.TIMES.shadow.fields.NUM, '20');
    assert.equal(roots[0].inputs.TIMES.block, undefined);
    assert.equal(roots[0].inputs.SUBSTACK, undefined);
    assert.equal(roots[1].fields.STYLE, 'left-right');
    const joined = scene.events.find((e) =>
      e.nodes?.some(
        (n) =>
          scene.manifest.resources[n.asset].anchors.say &&
          scene.manifest.resources[n.asset].anchors.repeat,
      ),
    );
    const r = scene.manifest.resources[joined.nodes[0].asset];
    assert.deepEqual(r.anchors.repeat.connections.SUBSTACK, r.anchors.say.connections.previous);
    const reporter = scene.events
      .flatMap((e) => e.nodes ?? [])
      .map((n) => scene.manifest.resources[n.asset])
      .find((r) => r.anchors.reporter && r.anchors.repeat);
    assert.deepEqual(
      reporter.anchors.repeat.connections.TIMES,
      reporter.anchors.reporter.connections.output,
    );
    assert.equal(reporter.anchors.times, undefined);
    assert.ok(
      reporter.anchors.reporter.bounds.x + reporter.anchors.reporter.bounds.width <
        reporter.anchors.repeat.bounds.width,
    );
    const joinedEvent = scene.events.find((e) =>
      e.nodes?.some((n) => {
        const a = scene.manifest.resources[n.asset].anchors;
        return a.repeat && a.reporter;
      }),
    );
    assert.ok(
      evaluate(joinedEvent.time + 0.3, scene).nodes.some((n) => {
        const a = scene.manifest.resources[n.asset].anchors;
        return a.repeat && a.reporter;
      }),
    );
    const open = scene.tracks.find((t) => t.step.endsWith(':open-click'));
    const click = scene.tracks.find((t) => t.step.endsWith(':select-click'));
    assert.ok(evaluate((open.start + open.end) / 2, scene).cursor.pressed);
    const selected = evaluate((click.start + click.end) / 2, scene);
    const menu = selected.overlays.find((o) => o.menu).menu;
    assert.equal(selected.cursor.pressed, true);
    assert.ok(
      selected.cursor.x >= menu.panel.x && selected.cursor.x < menu.panel.x + menu.panel.width,
    );
    assert.equal(Math.floor((selected.cursor.y - menu.panel.y - 4) / menu.rowHeight), menu.hovered);
    assert.equal(menu.options[menu.hovered][1], 'left-right');
    const imeFrame = typing.frames.find(
      (f) => scene.manifest.resources[f.asset].input.text === 'ni',
    );
    assert.equal(imeFrame.candidates[0], '你');
    assert.ok(!imeFrame.candidates.includes('你好'));
    assert.equal(evaluate(typing.start + imeFrame.offset, scene).input.preedit, true);

    for (const step of [
      { op: 'split', id: 'times', to: { kind: 'workspaceSlot', name: 'secondary' } },
      { op: 'choose', target: { kind: 'field', id: 'times', name: 'NUM' }, value: '10' },
      { op: 'connect', id: 'rotation', to: { kind: 'connection', id: 'repeat', name: 'TIMES' } },
    ])
      await assert.rejects(
        () => compile({ ...tutorial, steps: [...tutorial.steps, step] }, adapter),
        /CAPABILITY|BLOCKLY|CONNECTION/,
      );
  } finally {
    await adapter.dispose();
  }
  const times = [
    ...new Set([
      0,
      scene.duration,
      ...scene.events.map((e) => e.time),
      ...scene.tracks.flatMap((t) => [t.start, (t.start + t.end) / 2, t.end]),
    ]),
  ];
  const samples = times.map((t) => evaluate(t, scene));
  for (let i = times.length - 1; i >= 0; i--) {
    assert.deepEqual(evaluate(times[i], scene), samples[i]);
    assert.equal(new Set(samples[i].nodes.map((n) => n.id)).size, samples[i].nodes.length);
    const ids = samples[i].nodes.flatMap((n) =>
      Object.keys(scene.manifest.resources[n.asset].anchors),
    );
    assert.equal(new Set(ids).size, ids.length, `Duplicate visible block at ${times[i]}`);
  }
});
