import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  defineTutorial,
  parseTutorial,
  defaultProject,
} from '../packages/authoring/dist/index.js';
import { evaluate, frameCount, assertResources, descendants } from '../packages/core/dist/index.js';

const spec = (steps) => ({
  schemaVersion: 1,
  adapter: 'turbowarp',
  project: defaultProject(),
  initialTarget: 'sprite',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  steps,
});
const slot = (name) => ({ kind: 'workspaceSlot', name });
const number = (id, value = '10') => ({
  id,
  opcode: 'math_number',
  fields: { NUM: value },
});
const move = (id) => ({
  id,
  opcode: 'motion_movesteps',
  inputs: { STEPS: { shadow: number(id + '.STEPS.shadow') } },
});
const hat = (id) => ({ id, opcode: 'event_whenflagclicked' });
// Deliberate geometry-only test adapter. Real Blockly legality is covered separately.
function mockAdapter() {
  const manifest = {
    schemaVersion: 1,
    adapter: 'turbowarp',
    source: { blocks: 'test', gui: 'test', fontSha256: 'test', buildFiles: {} },
    viewport: { width: 1280, height: 720 },
    locale: 'zh-CN',
    theme: '',
    chrome: '<g data-slot="targets"></g>',
    layout: {
      blockScale: 0.675,
      toolboxPadding: 4,
      stackGap: 30,
      workspace: { x: 311, y: 93, width: 470, height: 589 },
      toolbox: { x: 61, y: 93, width: 250, height: 590 },
      editor: { x: 61, y: 93, width: 720, height: 590 },
      categories: { x: 1, y: 93, width: 60, height: 537 },
      spriteList: { x: 791, y: 565, width: 400, height: 155 },
      backdrop: { x: 1200, y: 462, width: 72, height: 258 },
    },
    slots: { main: { x: 430, y: 190 }, secondary: { x: 450, y: 365 } },
    resources: {},
  };
  const prepare = async (def) => {
    const key = JSON.stringify(def);
    if (manifest.resources[key]) return key;
    const anchors = {};
    let y = 0;
    function visit(b) {
      const isHat = b.opcode === 'event_whenflagclicked';
      anchors[b.id] = {
        opcode: b.opcode,
        x: 0,
        y,
        fields: {},
        connections: {
          ...(isHat ? {} : { previous: { x: 12, y } }),
          next: { x: 12, y: y + 50 },
        },
      };
      for (const i of Object.values(b.inputs ?? {})) {
        const child = i.shadow ?? i.block;
        anchors[child.id] = {
          opcode: child.opcode,
          x: 30,
          y: y + 12,
          fields: {
            NUM: {
              value: child.fields.NUM,
              x: 30,
              y: y + 12,
              width: child.fields.NUM.length * 10,
              height: 20,
            },
          },
          connections: {},
        };
      }
      y += 50;
      if (b.next) visit(b.next);
    }
    visit(def);
    manifest.resources[key] = {
      content: '<path d="M0 0h100v50H0z"/>',
      box: { x: 0, y: 0, width: 120, height: y },
      anchors,
    };
    return key;
  };
  const prepareInput = async (def, editing) => {
    const copy = structuredClone(def);
    const target = descendants(copy).find((b) => b.id === editing.id);
    target.fields[editing.name] = editing.text;
    const base = await prepare(copy),
      key = 'editing:' + base;
    const resource = structuredClone(manifest.resources[base]);
    const bounds = resource.anchors[editing.id].fields[editing.name];
    resource.input = {
      bounds: { ...bounds, width: Math.max(32, bounds.width + 16), height: 33 },
      text: editing.text,
      radius: 16.5,
      borderWidth: 1,
      fontSize: 16,
      fontWeight: '500',
      baseline: bounds.y + 23,
      textWidth: bounds.width,
      padding: 3,
      fill: 'white',
      stroke: '#3373cc',
      textColor: '#575e75',
      shadowColor: 'rgba(0,0,0,.1)',
      shadowWidth: 4,
    };
    manifest.resources[key] = resource;
    return key;
  };
  manifest.project = defaultProject();
  manifest.targets = Object.fromEntries(
    manifest.project.targets.map((t) => [
      t.id,
      {
        categories: [
          { key: 'motion', label: '运动', y: 109 },
          { key: 'events', label: '事件', y: 256 },
        ],
        toolbox: [],
        contentHeight: 1800,
        decorations: [],
        xml: '',
      },
    ]),
  );
  const adapter = {
    manifest,
    selectTarget: async () => {},
    prepare,
    prepareInput,
  };
  return adapter;
}
async function setup() {
  const a = mockAdapter();
  for (const [key, category, definition, y] of [
    ['events.event_whenflagclicked.4758c63ad4a847ba', 'events', hat('entry'), 138],
    ['motion.motion_movesteps.a5812bf398461387', 'motion', move('entry'), 900],
  ])
    a.manifest.targets.sprite.toolbox.push({
      key,
      category,
      definition,
      asset: await a.prepare(definition),
      position: { x: 69, y },
    });
  return a;
}
test('TS builder and JSON share strict schema; no author coordinates/selectors', () => {
  for (const theme of ['light', 'dark'])
    for (const locale of ['zh-CN', 'en']) {
      const variant = { ...spec([{ op: 'wait', duration: 1 }]), defaults: { theme, locale } };
      assert.deepEqual(parseTutorial(variant).defaults, { theme, locale });
      assert.throws(
        () => parseTutorial({ ...variant, defaults: { theme: [theme], locale } }),
        /UNSUPPORTED/,
      );
    }
  const built = defineTutorial({
    ...spec([]),
    build: (s) => s.sequence(s.wait(0.1), s.create([hat('h')], { to: s.workspace.slot('main') })),
  });
  assert.deepEqual(parseTutorial(JSON.parse(JSON.stringify(built))), built);
  for (const invalid of [
    spec([{ op: 'wait', duration: 0 }]),
    spec([{ op: 'wait', duration: Infinity }]),
    spec([{ op: 'unknown', id: 'x' }]),
    spec([
      {
        op: 'move',
        id: 'x',
        to: { kind: 'workspaceSlot', name: 'main', x: 4 },
      },
    ]),
    { ...spec([{ op: 'wait', duration: 1 }]), selector: '.blockly' },
  ])
    assert.throws(() => parseTutorial(invalid), /SCHEMA|DURATION|UNSUPPORTED/);
});
test('semantic drag reveals offscreen source, preserves toolbox, joins once, submits field atomically', async () => {
  const a = await setup();
  const tutorial = spec([
    {
      op: 'dragFromToolbox',
      entry: 'events.event_whenflagclicked.4758c63ad4a847ba',
      id: 'hat',
      to: slot('main'),
      duration: 0.5,
    },
    {
      op: 'dragFromToolbox',
      entry: 'motion.motion_movesteps.a5812bf398461387',
      id: 'move',
      to: { kind: 'connection', id: 'hat', name: 'next' },
      duration: 0.5,
    },
    {
      op: 'type',
      target: { kind: 'field', id: 'move.STEPS.shadow', name: 'NUM' },
      value: '2000',
      duration: 0.5,
    },
  ]);
  const result = await compile(tutorial, a);
  assert.ok(result.tracks.some((t) => t.kind === 'scroll'));
  const dragging = result.tracks.filter((t) => t.kind === 'node');
  const moving = dragging[1];
  assert.ok(moving.from.y >= 93 && moving.from.y < 683);
  const before = evaluate(moving.end - 1e-7, result),
    after = evaluate(moving.end, result);
  assert.equal(before.nodes.length, 2);
  assert.equal(after.nodes.length, 1);
  const final = evaluate(result.duration, result);
  assert.equal(final.nodes.length, 1);
  assert.equal(result.finalTargets.sprite[0].next.id, 'move');
  assert.equal(result.finalTargets.sprite[0].next.inputs.STEPS.shadow.fields.NUM, '2000');
  assert.equal(result.manifest.targets.sprite.toolbox.length, 2);
  assert.equal(
    result.manifest.targets.sprite.toolbox[1].definition.inputs.STEPS.shadow.fields.NUM,
    '10',
  );
  const roots = result.manifest.resources[final.nodes[0].asset].anchors;
  assert.deepEqual(roots.hat.connections.next, roots.move.connections.previous);
  assert.equal(roots['move.STEPS.shadow'].fields.NUM.width, 40);

  assert.deepEqual(await compile(JSON.parse(JSON.stringify(tutorial)), a), result);
});
test('random seeking equals sequential sampling, including exact boundaries, and never mutates compiled data', async () => {
  const result = await compile(
    spec([
      { op: 'create', blocks: [hat('h')], to: slot('main'), duration: 0.2 },
      { op: 'move', id: 'h', to: slot('secondary'), duration: 0.3 },
      { op: 'wait', duration: 0.2 },
    ]),
    await setup(),
  );
  const original = JSON.stringify(result),
    times = Array.from({ length: 100 }, (_, i) => (i / 100) * result.duration);
  times.push(...result.events.map((e) => e.time), result.duration);
  const sequential = times.map((t) => evaluate(t, result));
  let seed = 42;
  for (let i = 0; i < 200; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const j = seed % times.length;
    assert.deepEqual(evaluate(times[j], result), sequential[j]);
  }
  assert.equal(JSON.stringify(result), original);
  assert.throws(() => evaluate(-1, result), /TIME/);
  assert.throws(() => evaluate(NaN, result), /TIME/);
});
test('parallel branches merge independent roots and use maximum duration', async () => {
  const result = await compile(
    spec([
      {
        op: 'parallel',
        steps: [
          { op: 'paste', blocks: [hat('a')], to: slot('main'), duration: 0.3 },
          {
            op: 'create',
            blocks: [move('b')],
            to: slot('secondary'),
            duration: 0.5,
          },
        ],
      },
      { op: 'wait', duration: 0.1 },
    ]),
    await setup(),
  );
  assert.equal(result.duration, 0.6);
  assert.equal(evaluate(0.5, result).nodes.length, 2);
  assert.deepEqual(
    result.finalTargets.sprite.map((b) => b.id),
    ['a', 'b'],
  );
});
test('diagnostics cover conflicting branches, lifecycle, missing fields/slots/entries, duplicate IDs and occupied connections', async () => {
  const create = {
    op: 'create',
    blocks: [hat('h')],
    to: slot('main'),
    duration: 0.1,
  };
  const invalid = [
    [spec([{ op: 'move', id: 'absent', to: slot('main') }]), /TARGET at steps\[0\]/],
    [spec([{ ...create, to: slot('absent') }]), /TARGET/],
    [spec([create, create]), /DUPLICATE_ID/],
    [
      spec([{ op: 'dragFromToolbox', entry: 'absent', id: 'h', to: slot('main') }]),
      /TOOLBOX_ENTRY/,
    ],
    [
      spec([
        create,
        {
          op: 'type',
          target: { kind: 'field', id: 'h', name: 'steps' },
          value: '2',
        },
      ]),
      /FIELD/,
    ],
    [spec([{ op: 'parallel', steps: [create, create] }]), /PARALLEL_CONFLICT/],
    [
      spec([
        create,
        {
          op: 'parallel',
          steps: [
            { op: 'move', id: 'h', to: slot('secondary') },
            { op: 'move', id: 'h', to: slot('main') },
          ],
        },
      ]),
      /PARALLEL_CONFLICT/,
    ],
    [
      spec([
        {
          op: 'parallel',
          steps: [create, { op: 'move', id: 'h', to: slot('secondary') }],
        },
      ]),
      /TARGET/,
    ],
    [
      spec([
        { ...create, blocks: [{ ...hat('h'), next: move('m') }] },
        {
          op: 'create',
          blocks: [move('n')],
          to: { kind: 'connection', id: 'h', name: 'next' },
        },
      ]),
      /CONNECTION/,
    ],
  ];
  for (const [tutorial, error] of invalid)
    await assert.rejects(() => compile(tutorial, mockAdapter()), error);
});
test('missing resources fail before rendering/export and frame sampling excludes terminal boundary', async () => {
  const result = await compile(
    spec([{ op: 'create', blocks: [hat('h')], to: slot('main') }]),
    await setup(),
  );
  delete result.manifest.resources[result.events[0].nodes[0].asset];
  assert.throws(() => assertResources(result), /RESOURCE/);

  assert.equal(frameCount(6.200000000000001, 30), 186);
  assert.equal(frameCount(1.01, 30), 31);
  assert.equal(frameCount(1, 30), 30);
  for (const fps of [0, -1, NaN, 2.5, 121]) assert.throws(() => frameCount(1, fps), /EXPORT/);
});

test('reveal is idempotent once visible and input schema rejects cycles/callbacks', async () => {
  const a = await setup();
  const once = await compile(
    spec([
      { op: 'reveal', entry: 'motion.motion_movesteps.a5812bf398461387' },
      { op: 'wait', duration: 0.1 },
    ]),
    a,
  );
  const twice = await compile(
    spec([
      { op: 'reveal', entry: 'motion.motion_movesteps.a5812bf398461387' },
      { op: 'reveal', entry: 'motion.motion_movesteps.a5812bf398461387' },
      { op: 'wait', duration: 0.1 },
    ]),
    a,
  );
  assert.equal(once.duration, twice.duration);
  assert.equal(once.tracks.length, twice.tracks.length);
  const cyclic = spec([]);
  cyclic.steps.push({ op: 'sequence', steps: cyclic.steps });
  assert.throws(() => parseTutorial(cyclic), /SCHEMA/);
  assert.throws(() => parseTutorial(spec([{ op: 'wait', duration: () => 1 }])), /SCHEMA/);
});

test('continuous toolbox reveal skips category navigation for an already visible neighbour', async () => {
  const adapter = await setup();
  const before = await compile(spec([{ op: 'wait', duration: 0.1 }]), adapter);
  const after = await compile(
    spec([
      { op: 'reveal', entry: 'events.event_whenflagclicked.4758c63ad4a847ba' },
      { op: 'wait', duration: 0.1 },
    ]),
    adapter,
  );
  assert.equal(after.duration, before.duration);
  assert.deepEqual(after.tracks, []);
  assert.equal(after.initial.toolbox.category, 'motion');
});

test('project schema and adapter context reject ambiguity without depending on property order', async () => {
  const adapter = await setup();
  const tutorial = spec([{ op: 'wait', duration: 0.1 }]);
  tutorial.project.targets = tutorial.project.targets.map((t) =>
    Object.fromEntries(Object.entries(t).reverse()),
  );
  await compile(tutorial, adapter);
  for (const change of [
    (p) => {
      p.targets[1].id = p.targets[0].id;
    },
    (p) => {
      p.targets[1].isStage = true;
    },
    (p) => {
      p.targets[1].costumes = [];
    },
    (p) => {
      p.targets[1].id = '__proto__';
    },
    (p) => {
      delete p.targets[1].size;
    },
    (p) => {
      p.targets[1].size = 0;
    },
    (p) => {
      p.targets[1].direction = 181;
    },
    (p) => {
      p.targets[1].direction = NaN;
    },
    (p) => {
      p.targets[1].visible = 'false';
    },
  ]) {
    const invalid = structuredClone(tutorial);
    change(invalid.project);
    assert.throws(() => parseTutorial(invalid), /SCHEMA/);
  }
  await assert.rejects(
    () =>
      compile(
        spec([
          { op: 'selectTarget', targetId: 'constructor' },
          { op: 'wait', duration: 1 },
        ]),
        adapter,
      ),
    /TARGET/,
  );
  await assert.rejects(
    () =>
      compile(
        spec([
          {
            op: 'parallel',
            steps: [
              { op: 'selectTarget', targetId: 'stage' },
              { op: 'wait', duration: 1 },
            ],
          },
        ]),
        adapter,
      ),
    /PARALLEL_CONFLICT/,
  );
});
test('corrupt compiled metadata fails before drawing', async () => {
  const a = await setup();
  a.manifest.theme = '.fill-paint0{fill:red}';
  const scene = await compile(spec([{ op: 'create', blocks: [hat('h')], to: slot('main') }]), a);
  const invalid = structuredClone(scene);
  invalid.events[0].nodes[0].x = NaN;
  assert.throws(() => assertResources(invalid), /SCHEMA/);
  const badTrack = structuredClone(scene);
  badTrack.tracks.push({
    kind: 'scroll',
    start: 0,
    end: Infinity,
    easing: 'linear',
    from: 0,
    to: 1,
  });
  assert.throws(() => assertResources(badTrack), /SCHEMA/);
});

test('manual paste appears atomically at the step start, including connected and multiple roots', async () => {
  const a = await setup();
  const result = await compile(
    spec([
      { op: 'wait', duration: 0.1 },
      { op: 'paste', blocks: [hat('h'), move('other')], to: slot('main'), duration: 0.4 },
      {
        op: 'paste',
        blocks: [move('m')],
        to: { kind: 'connection', id: 'h', name: 'next' },
        duration: 0.3,
      },
    ]),
    a,
  );
  assert.equal(evaluate(0.1 - 1e-8, result).nodes.length, 0);
  for (const t of [0.1, 0.100001, 0.3, 0.5, 0.500001, 0.7]) {
    const state = evaluate(t, result);
    assert.equal(state.nodes.length, 2);
    assert.ok(state.nodes.every((n) => n.opacity === 1 && !n.dragging));
  }
  assert.equal(result.tracks.filter((t) => t.kind === 'node').length, 0);
  assert.equal(result.finalTargets.sprite.find((b) => b.id === 'h').next.id, 'm');
});
test('typing uses measured intermediate block resources, parks cursor, then atomically commits', async () => {
  const result = await compile(
    spec([
      { op: 'create', blocks: [move('m')], to: slot('main'), duration: 0.1 },
      {
        op: 'type',
        target: { kind: 'field', id: 'm.STEPS.shadow', name: 'NUM' },
        value: '20000000',
        duration: 0.8,
      },
    ]),
    await setup(),
  );
  const input = result.tracks.find((t) => t.kind === 'input');
  const texts = input.frames.map((f) => result.manifest.resources[f.asset].input.text);
  assert.deepEqual(texts, [
    '10',
    '',
    '2',
    '20',
    '200',
    '2000',
    '20000',
    '200000',
    '2000000',
    '20000000',
  ]);
  assert.ok(
    result.manifest.resources[input.frames.at(-1).asset].input.bounds.width >
      result.manifest.resources[input.frames[0].asset].input.bounds.width,
  );
  for (const frame of input.frames) {
    const state = evaluate(input.start + frame.offset, result);
    assert.equal(state.nodes[0].asset, frame.asset);
    assert.equal(state.input.appearance.text, result.manifest.resources[frame.asset].input.text);
    if (!frame.selected) {
      const { origin, scale, appearance: a } = state.input;
      const b = {
        x: origin.x + (a.bounds.x - a.shadowWidth) * scale,
        y: origin.y + (a.bounds.y - a.shadowWidth) * scale,
        width: (a.bounds.width + 2 * a.shadowWidth) * scale,
        height: (a.bounds.height + 2 * a.shadowWidth) * scale,
      };
      assert.ok(
        state.cursor.x > b.x + b.width ||
          state.cursor.x + 24 < b.x ||
          state.cursor.y > b.y + b.height ||
          state.cursor.y + 28 < b.y,
      );
    }
  }
  const final = evaluate(input.end, result);
  assert.equal(final.input, null);
  assert.equal(result.finalTargets.sprite[0].inputs.STEPS.shadow.fields.NUM, '20000000');
  const broken = structuredClone(result);
  delete broken.manifest.resources[input.frames[2].asset];
  assert.throws(() => assertResources(broken), /RESOURCE/);
});

test('target list follows timeline selection, escapes names, scrolls deterministically and supports stage-only projects', async () => {
  const adapter = mockAdapter();
  const base = adapter.manifest.project.targets.find((target) => !target.isStage);
  const sprites = Array.from({ length: 15 }, (_, index) => ({
    ...structuredClone(base),
    id: `sprite-${index}`,
    name: index === 14 ? '很长的角色名称 $& <script> & "测试"' : `角色 ${index + 1}`,
  }));
  adapter.manifest.project.targets = [adapter.manifest.project.targets[0], ...sprites];
  for (const target of sprites)
    adapter.manifest.targets[target.id] = adapter.manifest.targets.sprite;
  const tutorial = {
    ...spec([
      { op: 'wait', duration: 1 },
      { op: 'selectTarget', targetId: 'sprite-14' },
      { op: 'wait', duration: 1 },
      { op: 'selectTarget', targetId: 'stage' },
      { op: 'wait', duration: 1 },
    ]),
    project: adapter.manifest.project,
    initialTarget: 'sprite-0',
  };
  const scene = await compile(tutorial, adapter);
  const selection = scene.events.find((e) => e.targetId === 'sprite-14');
  assert.equal(evaluate(selection.time - 0.01, scene).targetId, 'sprite-0');
  assert.equal(evaluate(selection.time - 0.01, scene).cursor.pressed, true);
  assert.ok(scene.tracks.some((t) => t.kind === 'targetScroll'));
  assert.equal(evaluate(selection.time, scene).targetId, 'sprite-14');
  assert.ok(evaluate(selection.time, scene).targetScroll > 0);
  adapter.manifest.project.targets = [adapter.manifest.project.targets[0]];
  const empty = await compile(
    { ...tutorial, initialTarget: 'stage', steps: [{ op: 'wait', duration: 1 }] },
    adapter,
  );
  assert.equal(evaluate(0, empty).targetId, 'stage');
});

test('only catalog keys and actual fields are accepted; compiled output is target-scoped', async () => {
  const adapter = await setup();
  for (const entry of [
    'events.whenFlagClicked',
    'motion.moveSteps',
    'looks.say',
    'motion_movesteps',
  ]) {
    await assert.rejects(
      () => compile(spec([{ op: 'dragFromToolbox', entry, id: 'm', to: slot('main') }]), adapter),
      /TOOLBOX_ENTRY/,
    );
  }
  await assert.rejects(
    () =>
      compile(
        spec([
          { op: 'create', blocks: [move('m')], to: slot('main') },
          { op: 'type', target: { kind: 'field', id: 'm', name: 'steps' }, value: '20' },
        ]),
        adapter,
      ),
    /FIELD/,
  );
  const scene = await compile(
    spec([{ op: 'create', blocks: [move('m')], to: slot('main') }]),
    adapter,
  );
  assert.equal(Object.hasOwn(scene, 'finalBlocks'), false);
  assert.deepEqual(Object.keys(scene.finalTargets), ['stage', 'sprite']);
});

test('P2 splits a next subtree, deletes it, merges independent branches and keeps exact boundaries atomic', async () => {
  const scene = await compile(
    spec([
      { op: 'create', blocks: [{ ...hat('h'), next: move('m') }], to: slot('main'), duration: 0.1 },
      { op: 'split', id: 'm', to: slot('secondary'), duration: 0.5 },
      {
        op: 'parallel',
        steps: [
          { op: 'delete', id: 'm', duration: 0.4 },
          { op: 'annotate', id: 'h', text: '<保留>', duration: 0.4 },
        ],
      },
      { op: 'wait', duration: 0.1 },
    ]),
    mockAdapter(),
  );
  assert.equal(evaluate(0.31, scene).nodes.length, 2);
  const deletion = scene.tracks.filter((t) => t.kind === 'node' && t.id === 'm').at(-1);
  assert.equal(
    evaluate((deletion.start + deletion.end) / 2, scene).nodes.find((n) => n.id === 'm').opacity,
    1,
  );
  assert.ok(deletion.to.x < scene.manifest.layout.toolbox.x + scene.manifest.layout.toolbox.width);
  assert.equal(evaluate(scene.duration, scene).nodes.length, 1);
  assert.equal(scene.finalTargets.sprite[0].next, undefined);
  assert.equal(evaluate(0.8, scene).overlays[0].text, '<保留>');
  assert.equal(evaluate(scene.duration, scene).overlays.length, 0);
  const before = JSON.stringify(scene);
  evaluate(0.8, scene).overlays[0].bounds.x = -999;
  assert.equal(JSON.stringify(scene), before);
  await assert.rejects(
    () =>
      compile(
        spec([
          { op: 'create', blocks: [{ ...hat('h'), next: move('m') }], to: slot('main') },
          {
            op: 'parallel',
            steps: [
              { op: 'delete', id: 'm' },
              { op: 'highlight', id: 'h' },
            ],
          },
        ]),
        mockAdapter(),
      ),
    /PARALLEL_CONFLICT/,
  );
});

test('curved cursor keeps drag anchors and exact endpoints, composes click effects, and seeks deterministically', async () => {
  const scene = await compile(
    spec([
      {
        op: 'dragFromToolbox',
        entry: 'events.event_whenflagclicked.4758c63ad4a847ba',
        id: 'hat',
        to: slot('main'),
        duration: 1,
      },
    ]),
    await setup(),
  );
  const original = structuredClone(scene);
  const track = scene.tracks.find((t) => t.kind === 'cursor' && t.pressed);
  const nodeTrack = scene.tracks.find((t) => t.kind === 'node' && t.step === track.step);
  const options = { cursorMotion: 'curve', cursorClickEffect: 'shrink' };
  const mid = (track.start + track.end) / 2;
  const straight = evaluate(mid, scene),
    curved = evaluate(mid, scene, options);
  assert.deepEqual(evaluate(mid, scene, { cursorMotion: 'linear' }), straight);
  assert.ok(
    Math.hypot(curved.cursor.x - straight.cursor.x, curved.cursor.y - straight.cursor.y) > 5,
  );
  assert.ok(Math.abs(curved.cursor.rotation) > 1);
  const frames = Array.from({ length: 101 }, (_, i) => {
    const time = track.start + ((track.end - track.start) * i) / 100;
    const state = evaluate(time, scene, options);
    if (i < 100) {
      const node = state.nodes.find((n) => n.id === nodeTrack.id);
      assert.ok(Math.abs(state.cursor.x - node.x - (track.from.x - nodeTrack.from.x)) < 1e-8);
      assert.ok(Math.abs(state.cursor.y - node.y - (track.from.y - nodeTrack.from.y)) < 1e-8);
    }
    return state;
  });
  assert.equal(frames[0].cursor.x, track.from.x);
  assert.equal(frames[0].cursor.y, track.from.y);
  assert.equal(frames[0].cursor.rotation, 0);
  assert.equal(frames[100].cursor.x, track.to.x);
  assert.equal(frames[100].cursor.y, track.to.y);
  assert.equal(frames[100].cursor.rotation ?? 0, 0);
  assert.ok(Math.abs(frames[99].cursor.rotation) < 2);
  for (let i = frames.length - 1; i >= 0; i -= 3)
    assert.deepEqual(evaluate(frames[i].time, scene, options), frames[i]);
  assert.deepEqual(scene, original);
  assert.throws(() => evaluate(mid, scene, { cursorMotion: 'invalid' }), /UNSUPPORTED/);
});

test('curved motion handles all directions, zero-distance clicks, and menu hover at the curved position', async () => {
  const base = await compile(spec([{ op: 'wait', duration: 1 }]), await setup());
  for (const to of [
    { x: 600, y: 300 },
    { x: 300, y: 300 },
    { x: 450, y: 150 },
    { x: 450, y: 450 },
    { x: 450, y: 300 },
  ]) {
    const scene = structuredClone(base);
    scene.tracks = [
      {
        kind: 'cursor',
        from: { x: 450, y: 300 },
        to,
        start: 0,
        end: 1,
        step: 'probe',
        easing: 'linear',
        pressed: true,
      },
    ];
    let previous = 0;
    for (let i = 0; i < 100; i++) {
      const { cursor } = evaluate(i / 100, scene, { cursorMotion: 'curve' });
      assert.ok([cursor.x, cursor.y, cursor.rotation].every(Number.isFinite));
      assert.ok(Math.abs(cursor.rotation - previous) < 45, 'no rotation discontinuities');
      previous = cursor.rotation;
      if (to.x === 450 && to.y === 300)
        assert.deepEqual(cursor, { x: 450, y: 300, pressed: true, rotation: 0 });
    }
  }
  const sample = (distance, pressed = false, duration = 1) => {
    const scene = structuredClone(base);
    scene.tracks = [
      {
        kind: 'cursor',
        from: { x: 450, y: 300 },
        to: { x: 450 + distance, y: 300 },
        start: 0,
        end: duration,
        step: 'distance',
        easing: 'linear',
        pressed,
      },
    ];
    return evaluate(duration / 2, scene, { cursorMotion: 'curve' }).cursor;
  };
  assert.ok(Math.abs(sample(20).x - 460) < 1e-8);
  assert.ok(Math.abs(sample(20).y - 300) < 1e-8);
  assert.equal(sample(20).rotation, 0);
  assert.ok(Math.abs(sample(60).rotation) < 1);
  const medium = sample(160),
    long = sample(400),
    drag = sample(400, true);
  assert.ok(Math.abs(medium.rotation) < 15);
  assert.ok(Math.abs(long.rotation) > Math.abs(medium.rotation));
  assert.ok(Math.abs(long.rotation) <= 60);
  assert.ok(Math.abs(drag.rotation) <= 24);
  assert.ok(Math.abs(drag.y - 300) < Math.abs(long.y - 300));
  assert.ok(Math.abs(sample(400, false, 0.1).rotation) < Math.abs(long.rotation));
  for (const boundary of [24, 48, 320, 400]) {
    const before = sample(boundary - 0.001),
      after = sample(boundary + 0.001);
    assert.ok(Math.abs(before.y - after.y) < 0.01);
    assert.ok(Math.abs(before.rotation - after.rotation) < 0.01);
  }
  const scene = structuredClone(base);
  scene.tracks = [
    {
      kind: 'cursor',
      from: { x: 400, y: 300 },
      to: { x: 700, y: 300 },
      start: 0,
      end: 1,
      step: 'menu',
      easing: 'linear',
      pressed: false,
    },
  ];
  const { cursor } = evaluate(0.5, scene, { cursorMotion: 'curve' });
  scene.tracks.push({
    kind: 'overlay',
    start: 0,
    end: 1,
    step: 'menu',
    easing: 'linear',
    bounds: { x: 400, y: 300, width: 20, height: 20 },
    text: '',
    menu: {
      panel: { x: cursor.x - 15, y: cursor.y - 10, width: 30, height: 28 },
      rowHeight: 20,
      options: [['Item', 'item']],
      hovered: -1,
    },
  });
  assert.equal(evaluate(0.5, scene, { cursorMotion: 'curve' }).overlays[0].menu.hovered, 0);
  assert.equal(evaluate(0.5, scene).overlays[0].menu.hovered, -1);
});
