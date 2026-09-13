import type { Manifest } from '@blockdia-motion/core';

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
  return uiPaint(svg, manifest);
}
export const darkIme = `
.motion-ime-panel { fill: #29292d; stroke: #74747a; }
.motion-ime-label { fill: #eeeeee; }
.motion-ime-number { fill: #bbbbbb; }
.motion-ime-chevron { stroke: #bbbbbb; }
`;
