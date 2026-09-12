import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, frameSvg, DURATION, FPS } from "../p0/scene.mjs";
const resource = (anchors = {}) => ({ content: "<path/>", anchors });
const assets = {
  theme: "",
  resources: {
    hat: resource({ start: { connections: { next: { x: 12, y: 60 } } } }),
    move10: resource({ move: { connections: { previous: { x: 12, y: 0 } } } }),
    stack10: resource({
      num: {
        opcode: "math_number",
        fields: { NUM: { x: 30, y: 70, width: 30, height: 20 } },
      },
    }),
    stack20: resource({
      num: {
        opcode: "math_number",
        fields: { NUM: { x: 30, y: 70, width: 30, height: 20 } },
      },
    }),
  },
};
test("seeking and shuffled sampling are independent of playback history", () => {
  const frames = Array.from({ length: DURATION * FPS }, (_, i) =>
    evaluate(i / FPS, assets),
  );
  for (let i = frames.length - 1; i >= 0; i -= 7)
    assert.deepEqual(evaluate(i / FPS, assets), frames[i]);
  assert.throws(() => evaluate(NaN, assets));
  assert.throws(() => evaluate(-1, assets));
});
test("join atomically replaces the two roots and preserves connection position", () => {
  const before = evaluate(4 - 1e-8, assets).nodes,
    after = evaluate(4, assets).nodes;
  assert.equal(before.length, 2);
  assert.equal(after.length, 1);
  assert.equal(after[0].asset, "stack10");
  assert.ok(Math.abs(before[1].x - 430) < 1e-5);
  assert.ok(Math.abs(before[1].y - 230.5) < 1e-5);
  assert.equal(evaluate(5.4, assets).nodes[0].asset, "stack20");
  assert.equal(evaluate(7, assets).nodes.length, 1);
});
test("renderer rejects missing visual assets and clips toolbox/workspace separately", () => {
  const svg = frameSvg(6, assets);
  assert.match(svg, /clip-path="url\(#workspace\)"/);
  assert.match(svg, /clip-path="url\(#toolbox\)"/);
  const incomplete = structuredClone(assets);
  delete incomplete.resources.stack20;
  assert.throws(() => frameSvg(6, incomplete));
});
test("scaled layout preserves toolbox origins and field targeting", () => {
  const hat = evaluate(0.5, assets).nodes[0];
  const move = evaluate(2.5, assets).nodes.find((n) => n.dragging);
  assert.deepEqual({ x: hat.x, y: hat.y }, { x: 69, y: 138 });
  assert.deepEqual({ x: move.x, y: move.y }, { x: 69, y: 238 });
  const editing = evaluate(5, assets);
  assert.equal(editing.typing, true);
  assert.deepEqual(editing.cursor, {
    x: 430 + 45 * 0.675,
    y: 190 + 80 * 0.675,
  });
  const frame = frameSvg(5, assets);
  assert.match(frame, /translate\(430 190\) scale\(0.675\)/);
  assert.match(
    frame,
    /<clipPath id="workspace"><rect x="311" y="93" width="470" height="589"\/>/,
  );
});
