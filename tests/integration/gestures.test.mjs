import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile, defineTutorial, defaultProject } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
const base = {
  schemaVersion: 1,
  adapter: 'turbowarp',
  project: defaultProject(),
  initialTarget: 'sprite',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
};
const turn = (id, opcode, fieldId) => ({
  id,
  opcode,
  inputs: { DEGREES: { shadow: { id: fieldId, opcode: 'math_number', fields: { NUM: '15' } } } },
});
const stack = {
  id: 'h',
  opcode: 'event_whenflagclicked',
  next: { ...turn('a', 'motion_turnright', 'n'), next: turn('b', 'motion_turnleft', 'n2') },
};
test('direct edits are instantaneous; toolbox deletes subtree; context deletion heals next via Blockly', async () => {
  const adapter = await createAdapter({ project: base.project });
  try {
    const direct = await compile(
      defineTutorial({
        ...base,
        build: (s) => [
          s.direct.create([stack], s.workspace.slot('main')),
          s.direct.move('a', s.workspace.slot('secondary')),
          s.direct.connect('a', { kind: 'connection', id: 'h', name: 'next' }),
          s.direct.setField(s.ref('n').field('NUM'), '25'),
          s.wait(0.1),
        ],
      }),
      adapter,
    );
    assert.equal(direct.tracks.length, 0);
    assert.equal(direct.finalTargets.sprite[0].next.inputs.DEGREES.shadow.fields.NUM, '25');
    assert.equal(evaluate(0, direct).nodes.length, 1);
    const context = await compile(
      defineTutorial({
        ...base,
        build: (s) => [
          s.direct.create([stack], s.workspace.slot('main')),
          s.contextMenu('a', 0.2),
          s.delete('a', { via: 'contextMenu', duration: 0.2 }),
          s.wait(0.1),
        ],
      }),
      adapter,
    );
    assert.equal(context.finalTargets.sprite[0].next.id, 'b');
    const click = context.tracks.find((t) => t.step.endsWith(':right-click'));
    assert.equal(evaluate((click.start + click.end) / 2, context).cursor.button, 'right');
    const deletion = context.events.find((e) => e.remove?.includes('h'));
    assert.ok(
      evaluate(deletion.time - 1e-8, context).nodes.some(
        (n) => context.manifest.resources[n.asset].anchors.a,
      ),
    );
    assert.ok(
      !evaluate(deletion.time, context).nodes.some(
        (n) => context.manifest.resources[n.asset].anchors.a,
      ),
    );
    const drag = await compile(
      defineTutorial({
        ...base,
        build: (s) => [
          s.direct.create([stack], s.workspace.slot('main')),
          s.delete('a', { duration: 0.2 }),
          s.wait(0.1),
        ],
      }),
      adapter,
    );
    assert.equal(drag.finalTargets.sprite[0].next, undefined);
    const track = drag.tracks.find((t) => t.kind === 'node');
    assert.equal(evaluate(track.end, drag).nodes.length, 1);
    assert.equal(evaluate((track.start + track.end) / 2, drag).cursor.pressed, true);
    const erased = await compile(
      defineTutorial({
        ...base,
        build: (s) => [
          s.direct.create([stack], s.workspace.slot('main')),
          s.direct.delete('a'),
          s.wait(0.1),
        ],
      }),
      adapter,
    );
    assert.equal(erased.tracks.length, 0);
    assert.equal(erased.finalTargets.sprite[0].next, undefined);
  } finally {
    await adapter.dispose();
  }
});
