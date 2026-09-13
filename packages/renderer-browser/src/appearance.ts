import type { Manifest } from '@blockdia-motion/core';

// Controlled shell labels only: never translate authored text, target names or block values.
const english: Record<string, string> = {
  放大: 'Zoom in',
  缩小: 'Zoom out',
  恢复视角: 'Reset view',
  文件: 'File',
  编辑: 'Edit',
  插件: 'Addons',
  高级: 'Advanced',
  'Motion 教程': 'Motion tutorial',
  查看作品页面: 'See project',
  'TurboWarp 反馈': 'Feedback',
  代码: 'Code',
  造型: 'Costumes',
  声音: 'Sounds',
  '查找（Ctrl+F）': 'Find (Ctrl+F)',
  书包: 'Backpack',
  角色: 'Sprite',
  显示: 'Show',
  大小: 'Size',
  方向: 'Direction',
  舞台: 'Stage',
  背景: 'Backdrops',
};
// Paint values follow the pinned GUI dark palette (gui/dark.js); block colours remain original.
export function uiPaint(svg: string, manifest: Manifest): string {
  if (manifest.colorTheme !== 'dark') return svg;
  const colors: Record<string, string> = {
    white: '#111111',
    '#ffffff': '#111111',
    '#e5f0ff': '#111111',
    '#e9f1fc': '#1e1e1e',
    '#f9f9f9': '#1e1e1e',
    '#d9e3f2': '#2e2e2e',
    '#575e75': '#eeeeee',
    '#c7c7c7': '#484848',
    '#d4d4d4': '#484848',
    '#d9d9d9': '#484848',
    '#777777': '#cccccc',
    '#777': '#cccccc',
    '#ccc': '#666666',
    '#cccccc': '#666666',
    '#e8f0fe': '#2e2e2e',
    '#29292d': '#eeeeee',
    '#172b4d': '#eeeeee',
  };
  return svg.replace(/<[^>]+>/g, (tag) =>
    tag.replace(/(fill|stroke)="([^"]+)"/g, (all, key: string, value: string) => {
      if (tag.startsWith('<text') && ['white', '#ffffff'].includes(value)) return all;
      return colors[value] ? `${key}="${colors[value]}"` : all;
    }),
  );
}
export function shellSvg(svg: string, manifest: Manifest): string {
  const translated =
    manifest.locale === 'en'
      ? svg.replace(
          /(<text\b[^>]*>)([^<]*)(<\/text>)/g,
          (_, start: string, text: string, end: string) =>
            start.replace(
              /font-size="[^"]+"/,
              ['方向', '背景', '角色'].includes(text) ? 'font-size="8"' : '$&',
            ) +
            (english[text] ?? text) +
            end,
        )
      : svg;
  return uiPaint(
    manifest.locale === 'en'
      ? translated
          .replace(
            /aria-label="(放大|缩小|恢复视角)"/g,
            (_, label: string) => `aria-label="${english[label]}"`,
          )
          .replace(
            /<title>(放大|缩小|恢复视角)<\/title>/g,
            (_, label: string) => `<title>${english[label]}</title>`,
          )
      : translated,
    manifest,
  );
}
export const darkIme = `
.motion-ime-panel { fill: #29292d; stroke: #74747a; }
.motion-ime-label { fill: #eeeeee; }
.motion-ime-number { fill: #bbbbbb; }
.motion-ime-chevron { stroke: #bbbbbb; }
`;
