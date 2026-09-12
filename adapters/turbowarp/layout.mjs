// Fixed 1280x720, zh-CN, light/red GUI baseline. See docs/p1a.md.
export const source = {
  repository: "https://github.com/TurboWarp/scratch-gui",
  commit: "a2946eeb9a9dca7857d7ab53d766b54288c7a2ff",
};
export const theme = Object.freeze({
  accent: "#ff4c4c",
  background: "#e5f0ff",
  panel: "#ffffff",
  tertiary: "#d9e3f2",
  toolbox: "#f9f9f9",
  text: "#575e75",
  border: "#c7c7c7",
  scrollbar: "#cccccc",
  grid: "#d9d9d9",
});
const rect = (x, y, width, height) => Object.freeze({ x, y, width, height });
export const layout = Object.freeze({
  width: 1280,
  height: 720,
  menu: rect(0, 0, 1280, 48),
  tabs: rect(0, 48, 782, 44),
  categories: rect(1, 93, 60, 537),
  toolbox: rect(61, 93, 250, 590),
  workspace: rect(311, 93, 470, 589),
  editor: rect(61, 93, 720, 589),
  stage: rect(790, 92, 482, 362),
  sprites: rect(790, 462, 402, 258),
  backdrop: rect(1200, 462, 72, 258),
  blockScale: 0.675,
  toolboxPadding: 4,
  stackGap: 30,
});
export const anchors = Object.freeze({
  workspace: Object.freeze({ main: Object.freeze({ x: 430, y: 190 }), secondary: Object.freeze({ x: 450, y: 365 }), lower: Object.freeze({ x: 440, y: 520 }) }),
  toolbox: Object.freeze({
    hat: Object.freeze({ x: 69, y: 138 }),
    move10: Object.freeze({ x: 69, y: 238 }),
  }),
  ui: Object.freeze({
    "file-menu": Object.freeze({ x: 150, y: 24 }),
    "code-tab": Object.freeze({ x: 48, y: 73 }),
    "green-flag": Object.freeze({ x: 808, y: 70 }),
  }),
});
export const rectAttributes = ({ x, y, width, height }) =>
  `x="${x}" y="${y}" width="${width}" height="${height}"`;

// Preparation and scene geometry share these category and placement conventions.
export const catalogLayout = Object.freeze({categoryOffset: 16, categoryStep: 49});
