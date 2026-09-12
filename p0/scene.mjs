import {
  layout,
  anchors,
  rectAttributes,
} from "../adapters/turbowarp/layout.mjs";
import { chrome } from "../adapters/turbowarp/chrome.mjs";
export { chrome };
export const WIDTH = 1280,
  HEIGHT = 720,
  DURATION = 7,
  FPS = 30;
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * clamp(t);
export function evaluate(time, assets) {
  if (!Number.isFinite(time) || time < 0)
    throw Error("Time must be finite and nonnegative");
  const nodes = [];
  let cursor = { x: anchors.toolbox.hat.x + 35, y: anchors.toolbox.hat.y + 12 };
  const start = anchors.workspace.main;
  const scale = layout.blockScale;
  const hatSource = anchors.toolbox.hat,
    moveSource = anchors.toolbox.move10;
  const hatNext = assets.resources.hat.anchors.start.connections.next;
  const movePrev = assets.resources.move10.anchors.move.connections.previous;
  const end = {
    x: start.x + (hatNext.x - movePrev.x) * scale,
    y: start.y + (hatNext.y - movePrev.y) * scale,
  };
  if (time >= 0.5 && time < 2) {
    const t = (time - 0.5) / 1.5;
    nodes.push({
      asset: "hat",
      dragging: true,
      x: lerp(hatSource.x, start.x, t),
      y: lerp(hatSource.y, start.y, t),
    });
    cursor = {
      x: lerp(hatSource.x + 35, start.x + 35, t),
      y: lerp(hatSource.y + 12, start.y + 12, t),
    };
  } else if (time >= 2 && time < 4) nodes.push({ asset: "hat", ...start });
  if (time >= 2 && time < 2.5)
    cursor = {
      x: lerp(start.x + 35, moveSource.x + 35, (time - 2) * 2),
      y: lerp(start.y + 12, moveSource.y + 12, (time - 2) * 2),
    };
  if (time >= 2.5 && time < 4) {
    const t = (time - 2.5) / 1.5;
    nodes.push({
      asset: "move10",
      dragging: true,
      x: lerp(moveSource.x, end.x, t),
      y: lerp(moveSource.y, end.y, t),
    });
    cursor = {
      x: lerp(moveSource.x + 35, end.x + 35, t),
      y: lerp(moveSource.y + 12, end.y + 12, t),
    };
  }
  if (time >= 4) {
    nodes.push({ asset: time < 5.4 ? "stack10" : "stack20", ...start });
    const stack = assets.resources[time < 5.4 ? "stack10" : "stack20"];
    const number = Object.values(stack.anchors).find(
      (a) => a.opcode === "math_number",
    ).fields.NUM;
    cursor = {
      x:
        start.x +
        (number.x + number.width / 2) * scale +
        lerp(0, 65, (time - 5.4) / 0.6),
      y:
        start.y +
        (number.y + number.height / 2) * scale +
        lerp(0, 45, (time - 5.4) / 0.6),
    };
  }
  return { time, nodes, cursor, typing: time >= 4.8 && time < 5.4 };
}
export function frameSvg(time, assets, { gallery = false } = {}) {
  const scene = evaluate(time, assets);
  const node = ({ asset, x, y }) => {
    if (!assets.resources[asset]) throw Error(`Missing asset: ${asset}`);
    return `<g transform="translate(${x} ${y}) scale(${gallery ? 1 : layout.blockScale})">${assets.resources[asset].content}</g>`;
  };
  const content = gallery
    ? [
        ["hat", 40, 90],
        ["move10", 380, 90],
        ["stack20", 40, 255],
        ["nested", 380, 255],
        ["container", 740, 255],
        ["longText", 40, 535],
      ]
        .map(([asset, x, y]) => node({ asset, x, y }))
        .join("")
    : chrome().replace(
        '<g data-slot="workspace"></g>',
        () => `<g clip-path="url(#workspace)">${scene.nodes
          .filter((n) => !n.dragging)
          .map(node)
          .join("")}</g>`,
      ) +
      `<g clip-path="url(#toolbox)">${node({ asset: "hat", ...anchors.toolbox.hat })}${node({ asset: "move10", ...anchors.toolbox.move10 })}</g><g clip-path="url(#editor)">${scene.nodes
        .filter((n) => n.dragging)
        .map(node)
        .join(
          "",
        )}</g><path transform="translate(${scene.cursor.x} ${scene.cursor.y})" d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/>${scene.typing ? `<circle cx="${scene.cursor.x}" cy="${scene.cursor.y}" r="23" fill="none" stroke="#ff4c4c" stroke-width="2"/>` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><style>${assets.theme}</style><defs><clipPath id="editor"><rect ${rectAttributes(layout.editor)}/></clipPath><clipPath id="toolbox"><rect ${rectAttributes(layout.toolbox)}/></clipPath><clipPath id="workspace"><rect ${rectAttributes(layout.workspace)}/></clipPath></defs><g font-family="Motion Sans">${gallery ? '<rect width="1280" height="720" fill="#f6f7fb"/>' : ""}${content}</g></svg>`;
}
