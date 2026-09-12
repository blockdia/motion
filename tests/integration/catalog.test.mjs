import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile, defineTutorial, parseTutorial } from '../../packages/authoring/dist/index.js';
import { descendants, evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';
import { targetProject } from '../fixtures/target-project.mjs';
const slot = { kind: 'workspaceSlot', name: 'main' };
const spec = (project) => ({
  schemaVersion: 1,
  adapter: 'turbowarp',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  project,
  initialTarget: 'sprite',
});
test('complete native catalogs preserve context, definitions, capabilities, stable keys, and target isolation', async () => {
  const project = targetProject();
  const adapter = await createAdapter({ project });
  try {
    const m = adapter.manifest;
    const catalogResources = structuredClone(m.resources);
    for (const target of project.targets) {
      const c = m.targets[target.id];
      assert.equal(c.categories.length, 9);
      assert.deepEqual(
        c.categories.map((c) => c.label),
        ['运动', '外观', '声音', '事件', '控制', '侦测', '运算', '变量', '自制积木'],
      );
      assert.ok(c.toolbox.length > (target.isStage ? 70 : 110));
      assert.ok(c.contentHeight > 4000);
      assert.ok(c.decorations.some((d) => d.kind === 'button'));
      assert.ok(c.toolbox.every((e) => m.resources[e.asset] && e.metadata));
      assert.ok(c.toolbox.every((e, i, a) => !i || e.position.y >= a[i - 1].position.y));
      const vars = c.toolbox.filter((e) => e.definition.opcode === 'data_variable');
      assert.deepEqual(
        vars.map((e) => e.definition.fields.VARIABLE).sort(),
        target.isStage
          ? ['global-score']
          : ['global-score', target.id === 'sprite' ? 'local-a' : 'local-b'].sort(),
      );
      assert.equal(new Set(vars.map((e) => e.key)).size, vars.length);
      const costumes = c.toolbox.find((e) => e.definition.opcode === 'looks_switchcostumeto');
      if (costumes) {
        const menu = Object.values(costumes.metadata).find((b) => b.fields.COSTUME);
        assert.deepEqual(
          menu.fields.COSTUME.options.map((o) => o[1]),
          target.costumes,
        );
        assert.equal(
          costumes.definition.inputs.COSTUME.shadow.fields.COSTUME,
          target.costumes.at(-1),
        );
      }
    }
    const a = m.targets.sprite,
      b = m.targets['sprite-b'];
    assert.ok(
      Object.values(m.targets).every((catalog) =>
        catalog.toolbox.every((entry) => !Object.hasOwn(entry, 'aliases')),
      ),
    );
    assert.ok(!m.targets.stage.toolbox.some((e) => e.definition.opcode === 'motion_movesteps'));
    const move = a.toolbox.find((e) => e.definition.opcode === 'motion_movesteps');
    assert.equal(move.definition.inputs.STEPS.shadow.fields.NUM, '10');
    const go = a.toolbox.find((e) => e.definition.opcode === 'motion_gotoxy');
    assert.equal(go.definition.inputs.X.shadow.fields.NUM, '37');
    assert.equal(go.definition.inputs.Y.shadow.fields.NUM, '-24');
    assert.ok(
      a.toolbox.some((e) => e.definition.opcode === 'procedures_call' && e.definition.mutation),
    );
    assert.ok(!b.toolbox.some((e) => e.definition.opcode === 'procedures_call'));
    const turn = a.toolbox.find((e) => e.definition.opcode === 'motion_turnright');
    const wait = b.toolbox.find((e) => e.definition.opcode === 'control_wait');
    const tutorial = defineTutorial({
      ...spec(project),
      build: (s) =>
        s.sequence(
          s.dragFromToolbox(turn.key, { id: 'turn', to: slot, duration: 0.1 }),
          s.toolbox.selectCategory('operators'),
          s.wait(0.1),
          s.selectTarget('sprite-b'),
          s.dragFromToolbox(wait.key, { id: 'wait', to: slot, duration: 0.1 }),
          s.wait(0.1),
          s.selectTarget('stage'),
          s.wait(0.1),
          s.selectTarget('sprite'),
          s.wait(0.1),
        ),
    });
    const scene = await compile(tutorial, adapter);
    assert.deepEqual(JSON.parse(JSON.stringify(scene)), scene);
    assert.deepEqual(
      await compile(parseTutorial(JSON.parse(JSON.stringify(tutorial))), adapter),
      scene,
    );
    assert.equal(scene.finalTargets.sprite[0].opcode, 'motion_turnright');
    assert.equal(scene.finalTargets['sprite-b'][0].opcode, 'control_wait');
    const final = evaluate(scene.duration, scene);
    assert.equal(final.targetId, 'sprite');
    assert.equal(final.toolbox.category, 'operators');
    assert.deepEqual(
      final.nodes.map((n) => n.id),
      ['turn'],
    );
    for (const e of scene.events.filter((e) => e.targetId)) {
      const s = evaluate(e.time, scene);
      assert.ok(s.nodes.every((n) => n.targetId === e.targetId));
      assert.ok(frameSvg(e.time, scene).includes('clip-path'));
    }
    const times = Array.from({ length: 100 }, (_, i) => (scene.duration * i) / 99);
    const sequential = times.map((t) => evaluate(t, scene));
    for (let i = 99; i >= 0; i--) assert.deepEqual(evaluate(times[i], scene), sequential[i]);
    const make = (steps) => ({ ...spec(project), steps });
    await assert.rejects(
      () => compile(make([{ op: 'dragFromToolbox', entry: 'absent', id: 'x', to: slot }]), adapter),
      /TOOLBOX_ENTRY/,
    );
    await assert.rejects(
      () =>
        compile(
          make([
            {
              op: 'dragFromToolbox',
              entry: a.toolbox.find((e) => e.definition.opcode === 'procedures_call').key,
              id: 'x',
              to: slot,
            },
          ]),
          adapter,
        ),
      /CAPABILITY/,
    );
    await assert.rejects(
      () =>
        compile(
          make([
            { op: 'dragFromToolbox', entry: turn.key, id: 'x', to: slot },
            { op: 'selectTarget', targetId: 'sprite-b' },
            {
              op: 'dragFromToolbox',
              entry: wait.key,
              id: 'y',
              to: { kind: 'connection', id: 'x', name: 'next' },
            },
          ]),
          adapter,
        ),
      /TARGET_SCOPE/,
    );
    const local = structuredClone(
      a.toolbox.find(
        (e) =>
          e.definition.opcode === 'data_variable' && e.definition.fields.VARIABLE === 'local-a',
      ).definition,
    );
    local.id = 'wrongScope';
    await assert.rejects(
      () =>
        compile(
          make([
            { op: 'selectTarget', targetId: 'sprite-b' },
            { op: 'create', blocks: [local], to: slot },
          ]),
          adapter,
        ),
      /outside target context/,
    );
    const dropdown = structuredClone(
      a.toolbox.find((e) => e.definition.opcode === 'looks_switchcostumeto').definition,
    );
    dropdown.inputs.COSTUME.shadow.fields.COSTUME = '不存在';
    await assert.rejects(
      () => compile(make([{ op: 'create', blocks: [dropdown], to: slot }]), adapter),
      /Field option rejected/,
    );
    const changed = structuredClone(project);
    changed.targets[1].variables[0].name = '改名';
    await assert.rejects(
      () => compile({ ...make([{ op: 'wait', duration: 1 }]), project: changed }, adapter),
      /CONTEXT/,
    );
    // Regenerate in a fresh browser, so random Blockly IDs and recycling cannot hide instability.
    const second = await createAdapter({ project });
    try {
      assert.deepEqual(second.manifest.targets, m.targets);
      assert.deepEqual(second.manifest.resources, catalogResources);
    } finally {
      await second.dispose();
    }
    const updated = await createAdapter({ project: changed });
    try {
      assert.notEqual(
        updated.manifest.source.catalog.contextSha256,
        m.source.catalog.contextSha256,
      );
      assert.notDeepEqual(updated.manifest.targets.sprite, m.targets.sprite);
    } finally {
      await updated.dispose();
    }
  } finally {
    await adapter.dispose();
  }
});
