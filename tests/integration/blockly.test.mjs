import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
const slot = (name) => ({ kind: 'workspaceSlot', name });
const make = (steps) => ({ ...tutorial, steps });
const move = (id, value = '10') => ({
  id,
  opcode: 'motion_movesteps',
  inputs: {
    STEPS: {
      shadow: { id: id + '.n', opcode: 'math_number', fields: { NUM: value } },
    },
  },
});
test('pinned Blockly compiles independent JSON/TS inputs and rejects invalid editing rules', async () => {
  const adapter = await createAdapter({ project: tutorial.project });
  try {
    const a = await compile(tutorial, adapter),
      b = await compile(
        JSON.parse(await readFile('tests/fixtures/basic-editing.json', 'utf8')),
        adapter,
      );
    assert.deepEqual(a, b);
    assert.equal(evaluate(a.duration, a).nodes.length, 2);
    for (const [blocks, match] of [
      [
        [
          {
            id: 'h',
            opcode: 'event_whenflagclicked',
            next: { id: 'bad', opcode: 'event_whenflagclicked' },
          },
        ],
        /Missing connection/,
      ],
      [[{ id: 'm', opcode: 'motion_movesteps', fields: { NOPE: '1' } }], /Missing field/],
      [[{ id: 'unknown', opcode: 'not_registered' }], /Unsupported opcode/],
      [
        [
          {
            id: 'm',
            opcode: 'motion_movesteps',
            inputs: {
              STEPS: {
                block: {
                  id: 'say',
                  opcode: 'looks_say',
                  inputs: {
                    MESSAGE: {
                      shadow: {
                        id: 's',
                        opcode: 'text',
                        fields: { TEXT: 'hi' },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        /incompatible types/,
      ],
    ])
      await assert.rejects(
        () => compile(make([{ op: 'create', blocks, to: slot('main') }]), adapter),
        (error) => {
          assert.match(error.message, /BLOCKLY at steps\[0\]/);
          assert.match(error.message, match);
          return true;
        },
        JSON.stringify(blocks),
      );
    // This pinned fork accepts nonnumeric strings at field commit. Do not invent numeric semantics.
    const accepted = await compile(
      make([{ op: 'create', blocks: [move('literal', 'hello')], to: slot('main') }]),
      adapter,
    );
    assert.equal(accepted.finalTargets.sprite[0].inputs.STEPS.shadow.fields.NUM, 'hello');
    await assert.rejects(
      () =>
        compile(
          make([
            {
              op: 'create',
              blocks: [
                {
                  id: 'say',
                  opcode: 'looks_say',
                  inputs: {
                    MESSAGE: {
                      shadow: { id: 'say.text', opcode: 'text', fields: { TEXT: 'hello' } },
                    },
                  },
                },
              ],
              to: slot('main'),
            },
            { op: 'type', target: { kind: 'field', id: 'say', name: 'message' }, value: 'world' },
          ]),
          adapter,
        ),
      /FIELD/,
    );
    const joined = await compile(
      make([
        {
          op: 'create',
          blocks: [{ id: 'hat', opcode: 'event_whenflagclicked' }],
          to: slot('main'),
        },
        { op: 'paste', blocks: [move('move')], to: slot('secondary') },
        {
          op: 'connect',
          id: 'move',
          to: { kind: 'connection', id: 'hat', name: 'next' },
          duration: 0.3,
        },
        {
          op: 'type',
          target: { kind: 'field', id: 'move.n', name: 'NUM' },
          value: '123456',
          duration: 0.3,
        },
      ]),
      adapter,
    );
    const node = evaluate(joined.duration, joined).nodes[0],
      anchors = joined.manifest.resources[node.asset].anchors;
    assert.equal(joined.finalTargets.sprite[0].next.id, 'move');
    assert.deepEqual(anchors.hat.connections.next, anchors.move.connections.previous);
    assert.equal(anchors['move.n'].fields.NUM.value, '123456');
    const pasted = await compile(
      make([{ op: 'paste', blocks: [move('a'), move('b')], to: slot('main') }]),
      adapter,
    );
    const nodes = evaluate(pasted.duration, pasted).nodes;
    assert.equal(nodes.length, 2);
    assert.ok(nodes[1].y > nodes[0].y);
  } finally {
    await adapter.dispose();
  }
  await assert.rejects(() => adapter.prepare(move('after'), 'disposed'), /LIFECYCLE/);
});
