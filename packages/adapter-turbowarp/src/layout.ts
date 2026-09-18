// Fallback preparation geometry; browser playback measures the native shell.
const rect = (x: number, y: number, width: number, height: number) =>
  Object.freeze({ x, y, width, height });
export const layout = Object.freeze({
  categories: rect(1, 93, 60, 537),
  toolbox: rect(61, 93, 250, 590),
  workspace: rect(61, 93, 720, 589),
  editor: rect(61, 93, 720, 589),
  spriteList: rect(791, 565, 400, 155),
  backdrop: rect(1200, 462, 72, 258),
  blockScale: 0.675,
  toolboxPadding: 4,
  stackGap: 30,
});
export const anchors = Object.freeze({
  workspace: Object.freeze({
    main: Object.freeze({ x: 430, y: 190 }),
    secondary: Object.freeze({ x: 450, y: 365 }),
    lower: Object.freeze({ x: 440, y: 520 }),
  }),
});

// Preparation and scene geometry share these category conventions.
export const catalogLayout = Object.freeze({ categoryOffset: 16, categoryStep: 49 });
