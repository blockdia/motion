import test from 'node:test';
import assert from 'node:assert/strict';
import { inputTextLayout } from '../packages/core/dist/index.js';
import { planTyping } from '../packages/authoring/dist/typing.js';
import { parseTutorial } from '../packages/authoring/dist/index.js';
import tutorial from '../examples/structural-editing/tutorial.ts';
test('input planning automatically chooses word IME, handles mixed scripts and keeps requested candidates first', async () => {
  assert.deepEqual(
    (await planTyping('12a')).map((f) => f.text),
    ['', '1', '12', '12a'],
  );
  assert.ok((await planTyping('12a')).every((f) => !f.candidates));
  const frames = await planTyping('你好，重庆123👋');
  assert.equal(frames.at(-1).text, '你好，重庆123👋');
  assert.ok(frames.some((f) => f.text === 'ni' && f.candidates[0] === '你'));
  assert.ok(frames.filter((f) => f.text === 'ni').every((f) => !f.candidates.includes('你好')));
  const partial = frames.find((f) => f.text === '你好，chong');
  assert.ok(partial.candidates.includes('冲'));
  assert.ok(!partial.candidates.includes('重庆'));
  assert.ok(!frames.find((f) => f.text === '你好，chong q').candidates.includes('重庆'));
  assert.ok(!frames.find((f) => f.text === '你好，chong qi').candidates.includes('重庆'));
  assert.ok(partial.candidates.length > 1);
  assert.ok(frames.some((f) => f.text === '你好，chong qing' && f.candidates[0] === '重庆'));
  assert.deepEqual(await planTyping(''), [{ text: '' }]);
  assert.throws(
    () =>
      parseTutorial({
        ...tutorial,
        steps: [
          {
            op: 'type',
            target: { kind: 'field', id: 'x', name: 'TEXT' },
            value: '你好',
            composition: { text: 'nihao', candidates: ['你好'], selected: 0 },
          },
        ],
      }),
    /Unknown property composition/,
  );
});

test('composition position follows text centering, scroll clipping and committed prefix', () => {
  const input = {
    bounds: { x: 10, y: 20, width: 200, height: 30 },
    padding: 10,
    textWidth: 80,
    preeditOffset: 40,
  };
  const centered = inputTextLayout(input);
  assert.equal(centered.preeditX, 110);
  const scrolled = inputTextLayout({ ...input, textWidth: 400, preeditOffset: 150 });
  assert.ok(scrolled.preeditX < 20);
  assert.equal(scrolled.visiblePreeditX, 20);
  assert.equal(scrolled.caret, 200);
  const visible = inputTextLayout({ ...input, textWidth: 400, preeditOffset: 350 });
  assert.equal(visible.visiblePreeditX, 150);
});
