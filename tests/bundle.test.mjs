import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleTutorial, parseBundle } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/basic-editing/tutorial.ts';
test('semantic bundles contain only author data and deterministic input frames', async () => {
  const b = await bundleTutorial(tutorial);
  assert.equal(b.schemaVersion, 2);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(b))), b);
  assert.ok(!JSON.stringify(b).includes('<svg'));
  assert.equal(b.manifest, undefined);
  assert.throws(() => parseBundle({ schemaVersion: 1, manifest: {} }), /recompile/);
  const spec = {
    ...tutorial,
    steps: [{ op: 'type', target: { kind: 'field', id: 'text', name: 'TEXT' }, value: '你好' }],
  };
  const typing = await bundleTutorial(spec);
  assert.equal(typing.typing['你好'].at(-1).text, '你好');
  assert.ok(typing.typing['你好'].some((f) => f.candidates?.length));
  const bad = structuredClone(typing);
  bad.typing['你好'][0].preeditStart = -1;
  assert.throws(() => parseBundle(bad), /input frame/);
});
test('stage clips require valid ordered nonoverlapping intervals and static URLs', async () => {
  const clip = { src: 'stage.mp4', start: 0, in: 1, duration: 2 };
  const b = await bundleTutorial({ ...tutorial, stage: { clips: [clip, { ...clip, start: 3 }] } });
  assert.equal(b.tutorial.stage.clips.length, 2);
  for (const clips of [
    [{ ...clip, duration: 0 }],
    [{ ...clip, in: -1 }],
    [clip, { ...clip, start: 1 }],
    [{ ...clip, src: 'data:video/mp4,x' }],
  ])
    await assert.rejects(() => bundleTutorial({ ...tutorial, stage: { clips } }), /MEDIA/);
});
