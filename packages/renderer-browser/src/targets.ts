import { targetPanelLayout, type Manifest } from '@blockdia-motion/core';

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Conservative label budget at 10px. SVG clips remain the final overflow guard.
function label(value: string, width: number): string {
  const characters = Array.from(value);
  const widthOf = (character: string) => (/^[\x20-\x7e]$/.test(character) ? 7 : 10);
  if (characters.reduce((sum, character) => sum + widthOf(character), 0) <= width) return value;
  let result = '',
    used = 10;
  for (const character of characters) {
    used += widthOf(character);
    if (used > width) break;
    result += character;
  }
  return result + '…';
}

// Fixed zh-CN/light GUI geometry, shared by browser and video rendering.
// The chrome slot precedes the floating add buttons, so tiles never cover them.
export function targetPanelSvg(manifest: Manifest, targetId: string, offset?: number): string {
  const { project, layout } = manifest;
  const list = layout.spriteList,
    stageBox = layout.backdrop;
  const sprites = project.targets.filter((target) => !target.isStage);
  const selected = project.targets.find((target) => target.id === targetId)!;
  const stage = project.targets.find((target) => target.isStage)!;
  const { tile, scroll, maxScroll, tileHeight, tileWidth } = targetPanelLayout(
    manifest,
    targetId,
    offset,
  );
  const text = (x: number, y: number, value: string, extra = '') =>
    `<text x="${x}" y="${y}" font-size="10" fill="#575e75" ${extra}>${escape(value)}</text>`;
  const tiles = sprites
    .map((target, index) => {
      const { x, y } = tile(index);
      const active = target.id === targetId;
      return `<g data-target-id="${escape(target.id)}" data-selected="${active}"><title>${escape(target.name)}</title>
      ${active ? `<rect x="${x - 3}" y="${y - 3}" width="${tileWidth + 6}" height="${tileHeight + 6}" rx="9" fill="#ffb5b5"/>` : ''}
      <rect x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" rx="7" fill="${active ? 'white' : '#e9f1fc'}" stroke="${active ? '#ff4c4c' : '#c7c7c7'}" stroke-width="2"/>
      ${active ? `<path d="M${x + 1} ${y + 40} h${tileWidth - 2} v17 q0 6 -6 6 h${-(tileWidth - 14)} q-6 0 -6 -6Z" fill="#ff4c4c"/>` : ''}
      <defs><clipPath id="sprite-name-${index}"><rect x="${x + 4}" y="${y + 40}" width="${tileWidth - 8}" height="22"/></clipPath></defs>
      <text x="${x + tileWidth / 2}" y="${y + 55}" text-anchor="middle" font-size="10" fill="${active ? 'white' : '#575e75'}" clip-path="url(#sprite-name-${index})">${escape(label(target.name, tileWidth - 8))}</text>
    </g>`;
    })
    .join('');
  const stageSelected = stage.id === targetId;
  const properties = `<g data-ui="target-properties" aria-disabled="${stageSelected}">
    <title>${escape(selected.name)}</title>
    ${text(844, 497, stageSelected ? (manifest.locale === 'en' ? 'Name' : '名字') : label(selected.name, 102), `data-property="name" clip-path="url(#target-name)" font-weight="bold"${stageSelected ? ' style="fill:#777"' : ''}`)}
    ${[
      ['x', 1044, 497],
      ['y', 1155, 497],
      ['size', 1008, 539],
      ['direction', 1147, 539],
    ]
      .map(([key, x, y]) =>
        text(
          Number(x),
          Number(y),
          stageSelected
            ? key === 'x' || key === 'y'
              ? key
              : ''
            : String(Math.round(selected[key as 'x' | 'y' | 'size' | 'direction'])),
          `data-property="${key}" text-anchor="middle" font-weight="bold"${stageSelected ? ' style="fill:#777"' : ''}`,
        ),
      )
      .join('')}
    <defs>
      <filter id="target-icon-gray" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1 0"/></filter>
      <filter id="target-icon-active" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 .298 0 0 0 0 .298 0 0 0 1 0"/></filter>
    </defs>
    ${['show', 'hide']
      .map((key, index) => {
        const active = !stageSelected && (key === 'show' ? selected.visible : !selected.visible);
        const x = 832 + index * 33;
        return `<g data-visibility="${key}" aria-pressed="${active}">
        <path d="${index === 0 ? `M${x + 3} 518 H${x + 33} V550 H${x + 3} Q${x} 550 ${x} 547 V521 Q${x} 518 ${x + 3} 518Z` : `M${x} 518 H${x + 30} Q${x + 33} 518 ${x + 33} 521 V547 Q${x + 33} 550 ${x + 30} 550 H${x}Z`}" fill="${active ? '#ffe5e5' : 'white'}" stroke="#d4d4d4"/>
        <use href="#target-${key}-icon" filter="url(#target-icon-${active ? 'active' : 'gray'})"/>
      </g>`;
      })
      .join('')}
  </g>`;
  return `<g data-ui="targets">
    <defs><clipPath id="sprite-list"><rect x="${list.x}" y="${list.y}" width="${list.width}" height="${list.height}"/></clipPath>
    <clipPath id="target-name"><rect x="844" y="480" width="102" height="24"/></clipPath></defs>
    ${properties}
    <g clip-path="url(#sprite-list)" data-ui="sprite-list" data-scroll="${scroll}">${tiles}</g>
    ${maxScroll ? `<rect x="${list.x + list.width - 5}" y="${list.y + 3 + (scroll / (maxScroll + list.height)) * (list.height - 6)}" width="3" height="${(list.height / (maxScroll + list.height)) * (list.height - 6)}" rx="1.5" fill="#b5becb"/>` : ''}
    <g data-target-id="${escape(stage.id)}" data-selected="${stageSelected}"><title>${escape(stage.name)}</title>
    ${
      stageSelected
        ? `<rect x="${stageBox.x - 2}" y="${stageBox.y - 2}" width="${stageBox.width + 4}" height="${stageBox.height + 4}" rx="10" fill="none" stroke="#ffb5b5" stroke-width="4"/>
      <rect x="${stageBox.x}" y="${stageBox.y}" width="${stageBox.width}" height="${stageBox.height}" rx="8" fill="none" stroke="#ff4c4c"/>
      <path d="M${stageBox.x + 1} ${stageBox.y + 42} v-34 q0 -7 7 -7 h${stageBox.width - 16} q7 0 7 7 v34Z" fill="#ff4c4c"/>
      ${text(stageBox.x + stageBox.width / 2, 489, '舞台', 'text-anchor="middle" style="fill:white" font-weight="bold"')}`
        : ''
    }
    ${text(stageBox.x + stageBox.width / 2, 602, String(stage.costumes.length), 'text-anchor="middle"')}
    </g></g>`;
}
