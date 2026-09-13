import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile, defineTutorial, defaultProject } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';

test('native boolean replacement, dropdown open state, pointer hover and flyout decay', async () => {
  const project = defaultProject();
  const adapter = await createAdapter({ project });
  try {
    const scene = await compile(
      defineTutorial({
        schemaVersion: 1,
        adapter: 'turbowarp',
        project,
        initialTarget: 'sprite',
        viewport: { width: 1280, height: 720 },
        defaults: { theme: 'light', locale: 'zh-CN' },
        build: (s) => [
          s.direct.create([{ id: 'if', opcode: 'control_if' }], s.workspace.slot('main')),
          s.direct.create(
            [{ id: 'boolean', opcode: 'operator_equals' }],
            s.workspace.slot('secondary'),
          ),
          s.connect('boolean', { kind: 'connection', id: 'if', name: 'CONDITION' }),
          s.wait(0.2),
          s.split('boolean', s.workspace.slot('secondary')),
          s.delete('boolean'),
          s.delete('if'),
          s.direct.create(
            [{ id: 'menu', opcode: 'motion_setrotationstyle', fields: { STYLE: 'all around' } }],
            s.workspace.slot('main'),
          ),
          s.choose(s.ref('menu').field('STYLE'), 'left-right'),
          s.direct.create(
            [
              {
                id: 'goto',
                opcode: 'motion_goto',
                inputs: {
                  TO: {
                    shadow: {
                      id: 'destination',
                      opcode: 'motion_goto_menu',
                      fields: { TO: '_random_' },
                    },
                  },
                },
              },
            ],
            s.workspace.slot('secondary'),
          ),
          s.choose(s.ref('destination').field('TO'), '_mouse_'),
          s.toolbox.selectCategory('control'),
          s.wait(0.2),
        ],
      }),
      adapter,
    );
    const preview = scene.tracks.find((t) => t.kind === 'preview');
    const content = scene.manifest.resources[preview.asset].content;
    assert.match(content, /feGaussianBlur/);
    assert.doesNotMatch(content, /blocklyInsertionMarker/);
    assert.equal(scene.manifest.resources[preview.asset].anchors.boolean, undefined);
    assert.ok(scene.tracks.some((t) => t.step.endsWith(':departure')));
    const dropdowns = scene.tracks.filter((t) => t.step.endsWith(':dropdown'));
    assert.equal(dropdowns.length, 2);
    for (const opened of dropdowns) {
      const before = evaluate(opened.start - 0.001, scene).nodes.find((n) => n.id === opened.id);
      assert.notEqual(
        scene.manifest.resources[before.asset].content,
        scene.manifest.resources[opened.asset].content,
      );
      assert.notEqual(
        evaluate(opened.end, scene).nodes.find((n) => n.id === opened.id).asset,
        opened.asset,
      );
    }
    const opened = scene.tracks.find((t) => t.step.endsWith(':dropdown'));
    const closed = evaluate(opened.start - 0.001, scene).nodes.find((n) => n.id === 'menu');
    assert.notEqual(
      scene.manifest.resources[closed.asset].content,
      scene.manifest.resources[opened.asset].content,
    );
    const move = scene.tracks.find((t) => t.step.endsWith(':option'));
    let sawOutside = false,
      sawHover = false;
    for (let t = move.start; t < move.end; t += 0.01) {
      const snap = evaluate(t, scene),
        menu = snap.overlays.find((o) => o.menu).menu;
      if (menu.hovered < 0) sawOutside = true;
      else {
        sawHover = true;
        assert.equal(snap.cursor.pressed, false);
      }
    }
    assert.ok(sawOutside && sawHover, 'Hover follows the cursor before click');
    const scroll = scene.tracks.find((t) => t.kind === 'scroll');
    const t = scroll.start + 0.06;
    assert.ok(
      Math.abs(
        evaluate(t, scene).toolbox.scroll - (scroll.to - (scroll.to - scroll.from) * 0.3 ** 2),
      ) < 1e-6,
    );
    const click = scene.tracks.find((t) => t.step === scroll.step + ':click');
    assert.ok(click.end <= scroll.start);
  } finally {
    await adapter.dispose();
  }
});
