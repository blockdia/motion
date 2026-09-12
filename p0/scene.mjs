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
  let cursor = { x: 180, y: 170 };
  const start = { x: 445, y: 190 };
  const hatNext = assets.resources.hat.anchors.start.connections.next;
  const movePrev = assets.resources.move10.anchors.move.connections.previous;
  const end = {
    x: start.x + hatNext.x - movePrev.x,
    y: start.y + hatNext.y - movePrev.y,
  };
  if (time >= 0.5 && time < 2) {
    const t = (time - 0.5) / 1.5;
    nodes.push({
      asset: "hat",
      dragging: true,
      x: lerp(128, start.x, t),
      y: lerp(150, start.y, t),
    });
    cursor = { x: lerp(180, start.x + 45, t), y: lerp(170, start.y + 18, t) };
  } else if (time >= 2 && time < 4) nodes.push({ asset: "hat", ...start });
  if (time >= 2 && time < 2.5)
    cursor = {
      x: lerp(start.x + 45, 178, (time - 2) * 2),
      y: lerp(start.y + 18, 264, (time - 2) * 2),
    };
  if (time >= 2.5 && time < 4) {
    const t = (time - 2.5) / 1.5;
    nodes.push({
      asset: "move10",
      dragging: true,
      x: lerp(128, end.x, t),
      y: lerp(245, end.y, t),
    });
    cursor = { x: lerp(178, end.x + 50, t), y: lerp(264, end.y + 18, t) };
  }
  if (time >= 4) {
    nodes.push({ asset: time < 5.4 ? "stack10" : "stack20", ...start });
    const stack = assets.resources[time < 5.4 ? "stack10" : "stack20"];
    const number = Object.values(stack.anchors).find(
      (a) => a.opcode === "math_number",
    ).fields.NUM;
    cursor = {
      x:
        start.x + number.x + number.width / 2 + lerp(0, 65, (time - 5.4) / 0.6),
      y:
        start.y +
        number.y +
        number.height / 2 +
        lerp(0, 45, (time - 5.4) / 0.6),
    };
  }
  return { time, nodes, cursor, typing: time >= 4.8 && time < 5.4 };
}
export function chrome() {
  return `<rect width="1280" height="720" fill="#f9f9fc"/><rect width="1280" height="52" fill="#ff4c4c"/>
  <g font-size="17" fill="white"><text x="22" y="33">Blockdia Motion</text><text x="235" y="33">文件</text><text x="300" y="33">编辑</text><text x="1090" y="33">P0 · 素材验证</text></g>
  <rect x="0" y="52" width="930" height="46" fill="#fff"/><g font-size="16" fill="#575e75"><text x="28" y="82">代码</text><text x="105" y="82">造型</text><text x="180" y="82">声音</text></g>
  <rect x="0" y="98" width="100" height="622" fill="white"/><rect x="100" y="98" width="245" height="622" fill="#f0f3fa"/>
  <rect x="345" y="98" width="585" height="622" fill="#fff" stroke="#d9dce4"/>
  <g font-size="15" fill="#575e75"><circle cx="49" cy="137" r="10" fill="#4c97ff"/><text x="33" y="171">运动</text><circle cx="49" cy="216" r="10" fill="#ffbf00"/><text x="33" y="250">事件</text></g>
  <rect x="947" y="98" width="315" height="238" rx="8" fill="white" stroke="#d9dce4"/><rect x="947" y="354" width="315" height="348" rx="8" fill="white" stroke="#d9dce4"/>
  <g fill="#9499a8" font-size="15"><text x="968" y="130">舞台 · 留空</text><text x="968" y="386">角色 / 造型 · 留空</text></g>`;
}
export function frameSvg(time, assets, { gallery = false } = {}) {
  const scene = evaluate(time, assets);
  const node = ({ asset, x, y }) => {
    if (!assets.resources[asset]) throw Error(`Missing asset: ${asset}`);
    return `<g transform="translate(${x} ${y})">${assets.resources[asset].content}</g>`;
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
    : chrome() +
      `<g clip-path="url(#toolbox)">${node({ asset: "hat", x: 128, y: 150 })}${node({ asset: "move10", x: 128, y: 245 })}</g><g clip-path="url(#workspace)">${scene.nodes
        .filter((n) => !n.dragging)
        .map(node)
        .join("")}</g><g clip-path="url(#editor)">${scene.nodes
        .filter((n) => n.dragging)
        .map(node)
        .join(
          "",
        )}</g><path transform="translate(${scene.cursor.x} ${scene.cursor.y})" d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/>${scene.typing ? `<circle cx="${scene.cursor.x}" cy="${scene.cursor.y}" r="23" fill="none" stroke="#ff4c4c" stroke-width="2"/>` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><style>${assets.theme}</style><defs><clipPath id="editor"><rect x="100" y="98" width="830" height="622"/></clipPath><clipPath id="toolbox"><rect x="100" y="98" width="245" height="622"/></clipPath><clipPath id="workspace"><rect x="345" y="98" width="585" height="622"/></clipPath></defs><g font-family="Motion Sans">${gallery ? '<rect width="1280" height="720" fill="#f6f7fb"/>' : ""}${content}</g></svg>`;
}
