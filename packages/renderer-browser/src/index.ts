import {
  assertResources,
  inputTextLayout,
  evaluate,
  fail,
  type CompiledScene,
  type Rect,
  type Snapshot,
} from '@blockdia-motion/core';
import { targetPanelSvg } from './targets.js';
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const rect = (r: Rect) => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;
function inputSvg(input: NonNullable<Snapshot['input']>): string {
  const { appearance: a, origin, scale, selected } = input;
  const b = a.bounds,
    border = a.borderWidth;
  const { innerWidth, textX, caret, preeditX } = inputTextLayout(a);
  return `<g clip-path="url(#workspace)"><g transform="translate(${origin.x} ${origin.y}) scale(${scale})" data-input-text="${escape(a.text)}">
    <rect x="${b.x - a.shadowWidth}" y="${b.y - a.shadowWidth}" width="${b.width + a.shadowWidth * 2}" height="${b.height + a.shadowWidth * 2}" rx="${a.radius + a.shadowWidth}" fill="${a.shadowColor}"/>
    <rect x="${b.x + border / 2}" y="${b.y + border / 2}" width="${b.width - border}" height="${b.height - border}" rx="${Math.max(0, a.radius - border / 2)}" fill="${a.fill}" stroke="${a.stroke}" stroke-width="${border}"/>
    <defs><clipPath id="input-text"><rect x="${b.x + a.padding}" y="${b.y + border}" width="${innerWidth}" height="${b.height - border * 2}" rx="${Math.max(0, a.radius - a.padding)}"/></clipPath></defs>
    <g clip-path="url(#input-text)">
    ${selected ? `<rect x="${textX}" y="${b.y + (b.height - a.fontSize * 1.2) / 2}" width="${a.textWidth}" height="${a.fontSize * 1.2}" fill="#b4d5fe"/>` : ''}
    <text x="${textX}" y="${a.baseline}" font-size="${a.fontSize}" font-weight="${a.fontWeight}" fill="${a.textColor}">${escape(a.text)}</text>
    ${input.preedit ? `<path data-preedit-underline="true" d="M${preeditX} ${a.baseline + 2} H${caret}" stroke="${a.textColor}" stroke-width="1"/>` : ''}
    ${selected ? '' : `<path d="M${caret} ${b.y + (b.height - a.fontSize * 1.2) / 2} v${a.fontSize * 1.2}" stroke="${a.textColor}" stroke-width="1"/>`}
    </g></g></g>`;
}
export function frameSvg(time: number, compiled: CompiledScene, namespace = 'motion'): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace))
    fail('NAMESPACE', 'render', 'Invalid SVG namespace');
  const s = evaluate(time, compiled),
    m = compiled.manifest,
    scale = m.layout.blockScale;
  const node = (
    asset: string,
    x: number,
    y: number,
    opacity = 1,
    prefix = 'node',
    dragging = false,
  ) => {
    const resource = m.resources[asset];
    if (!resource) fail('RESOURCE', 'render', `Missing resource ${asset}`);
    // Resources can occur in both toolbox and workspace. Namespace every instance.
    const content = resource.content
      .replace(/(?<=\s)id="([^"]+)"/g, (_, id: string) => `id="${prefix}-${id}"`)
      .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}-${id})`)
      .replace(/(href=")#([^"]+)/g, (_, start: string, id: string) => `${start}#${prefix}-${id}`);
    return `<g opacity="${opacity}" transform="translate(${x} ${y}) scale(${scale})">${dragging ? `<defs><filter id="${prefix}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feComponentTransfer result="offsetBlur"><feFuncA type="linear" slope=".3"/></feComponentTransfer><feComposite in="SourceGraphic" in2="offsetBlur" operator="over"/></filter></defs><g filter="url(#${prefix}-shadow)">${content}</g>` : content}</g>`;
  };
  const catalog = m.targets[s.targetId];
  if (!catalog) fail('TARGET', 'render', `Missing target catalog ${s.targetId}`);
  const category = catalog.categories.find((c) => c.key === s.toolbox.category);
  const box = m.layout.toolbox;
  const workspace = `<g clip-path="url(#workspace)">${s.nodes
    .filter((n) => !n.dragging)
    .map((n, i) => node(n.asset, n.x, n.y, n.opacity, `root${i}`))
    .join('')}</g>`;
  const workspaceSlot = '<g data-slot="workspace"></g>';
  const chrome = m.chrome.replace('<g data-slot="targets"></g>', () =>
    targetPanelSvg(m, s.targetId, s.targetScroll),
  );
  const overlays = s.overlays
    .map((o) => {
      if (o.menu) {
        const a = o.menu,
          p = a.panel;
        const tip = Math.max(
          p.x + 12,
          Math.min(o.bounds.x + o.bounds.width / 2, p.x + p.width - 12),
        );
        const edge = a.above ? p.y + p.height : p.y;
        const direction = a.above ? 1 : -1;
        return `<g data-overlay="menu" clip-path="url(#workspace)"><rect ${rect(p)} rx="4" fill="${escape(a.fill)}" stroke="${escape(a.stroke)}"/>${a.context ? '' : `<path d="M${tip - 8} ${edge} L${tip} ${edge + direction * 9} L${tip + 8} ${edge}" fill="${escape(a.fill)}" stroke="${escape(a.stroke)}"/>`}${a.options.map((option, i) => `<g>${a.hovered === i ? `<rect x="${p.x + 2}" y="${p.y + 4 + i * a.rowHeight}" width="${p.width - 4}" height="${a.rowHeight}" rx="2" fill="${a.context ? '#e8f0fe' : 'rgba(0,0,0,.2)'}"/>` : ''}${a.checked === i ? `<path d="M${p.x + 12} ${p.y + 4 + (i + 0.5) * a.rowHeight} l3 4 l7 -10" fill="none" stroke="#172b4d" stroke-width="2"/>` : ''}<text x="${p.x + (a.context ? 12 : 30)}" y="${p.y + 4 + (i + 0.5) * a.rowHeight + a.fontSize * 0.35}" font-size="${a.fontSize}" font-weight="${a.context ? 'normal' : 'bold'}" fill="${a.context ? (a.enabled?.[i] === false ? '#aaa' : '#29292d') : 'white'}">${escape(option[0])}</text></g>`).join('')}</g>`;
      }
      if (o.ime) {
        const view = m.layout.workspace;
        const entries = [];
        // Align the first candidate's text (25px inset) with visible preedit start.
        const preferredX = (o.imeAnchor?.x ?? o.bounds.x) - 25;
        const available = Math.min(
          view.width - 16,
          view.x + view.width - 8 - Math.max(view.x + 8, preferredX),
        );
        let width = 8;
        for (const candidate of o.ime) {
          const w = 26 + [...candidate].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 16 : 8), 0);
          if (width + w + 28 > available && entries.length) break;
          entries.push({ text: candidate, x: width, width: w });
          width += w;
        }
        width = Math.min(view.width - 16, width + 28);
        const x = Math.max(view.x + 8, Math.min(preferredX, view.x + view.width - width - 8));
        const y =
          o.bounds.y + o.bounds.height + 38 < view.y + view.height
            ? o.bounds.y + o.bounds.height + 6
            : Math.max(view.y + 4, o.bounds.y - 38);
        return `<g data-overlay="ime" clip-path="url(#workspace)"><rect x="${x}" y="${y}" width="${width}" height="32" rx="16" class="motion-ime-panel"/>${entries.map((e, i) => `${i === 0 ? `<rect x="${x + e.x - 4}" y="${y + 3}" width="${e.width}" height="26" rx="13" class="motion-ime-selected"/>` : ''}<text x="${x + e.x + 2}" y="${y + 21}" font-size="11" class="${i === 0 ? 'motion-ime-selected-label' : 'motion-ime-number'}">${i + 1}</text><text data-ime-candidate="${i}" x="${x + e.x + 17}" y="${y + 22}" font-size="16" class="${i === 0 ? 'motion-ime-selected-label' : 'motion-ime-label'}">${escape(e.text)}</text>`).join('')}<path d="M${x + width - 19} ${y + 14} l4 4 l4 -4" fill="none" class="motion-ime-chevron" stroke-width="2"/></g>`;
      }
      const lines = o.text.split('\n');
      const width = Math.min(
        m.layout.workspace.width - 16,
        Math.max(120, ...lines.map((l) => [...l].length * 14 + 20)),
      );
      const height = lines.length * 22 + 12;
      const x = Math.max(
        m.layout.workspace.x + 8,
        Math.min(o.bounds.x, m.layout.workspace.x + m.layout.workspace.width - width - 8),
      );
      const y =
        o.bounds.y + o.bounds.height + height + 8 < m.layout.workspace.y + m.layout.workspace.height
          ? o.bounds.y + o.bounds.height + 8
          : Math.max(m.layout.workspace.y + 8, o.bounds.y - height - 8);
      return `<g clip-path="url(#workspace)" data-overlay="true"><rect ${rect(o.bounds)} fill="none" stroke="#ffbf00" stroke-width="3" rx="4"/>${o.text ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="white" stroke="#c7c7c7"/>${lines.map((line, i) => `<text x="${x + 10}" y="${y + 22 + i * 22}" font-size="14" fill="#575e75">${escape(line)}</text>`).join('')}` : ''}</g>`;
    })
    .join('');
  const content =
    (chrome.includes(workspaceSlot)
      ? chrome.replace(workspaceSlot, () => workspace)
      : chrome + workspace) +
    catalog.categories
      .map(
        (c) =>
          `<circle cx="${m.layout.categories.x + m.layout.categories.width / 2}" cy="${c.y}" r="9.5" fill="${escape(c.color ?? '#888')}"/><text x="${m.layout.categories.x + m.layout.categories.width / 2}" y="${c.y + 23}" text-anchor="middle" font-size="10.4" fill="#575e75">${escape(c.label)}</text>`,
      )
      .join('') +
    (category
      ? `<rect x="2" y="${category.y - 15}" width="58" height="46" rx="3" fill="#4c97ff" opacity=".12"/>`
      : '') +
    `<g clip-path="url(#toolbox)">${catalog.toolbox
      .filter((e) => {
        const b = m.resources[e.asset]!.box;
        const top = e.position.y + b.y * scale - s.toolbox.scroll;
        return top < box.y + box.height && top + b.height * scale > box.y;
      })
      .map((e, i) => node(e.asset, e.position.x, e.position.y - s.toolbox.scroll, 1, `tool${i}`))
      .join('')}${catalog.decorations
      .filter(
        (d) =>
          d.position.y - s.toolbox.scroll + d.height >= box.y &&
          d.position.y - s.toolbox.scroll < box.y + box.height,
      )
      .map(
        (d) =>
          `<g transform="translate(${d.position.x} ${d.position.y - s.toolbox.scroll})">${d.kind === 'checkbox' ? `<rect width="${d.width}" height="${d.height}" rx="3" fill="white" stroke="#888"/>` : d.kind === 'button' ? `<rect width="${d.width}" height="${d.height}" rx="4" fill="white" stroke="#c7c7c7"/>` : ''}<text x="${d.kind === 'button' ? d.width / 2 : 0}" y="${d.height / 2 + 4}" text-anchor="${d.kind === 'button' ? 'middle' : 'start'}" font-size="12" fill="#575e75">${escape(d.text)}</text></g>`,
      )
      .join('')}</g>` +
    `<rect x="${box.x + box.width - 11}" y="${box.y + (s.toolbox.scroll / Math.max(catalog.contentHeight, box.height)) * box.height}" width="6" height="${Math.max(20, box.height * Math.min(1, box.height / catalog.contentHeight))}" rx="3" fill="#ccc"/>` +
    `<g clip-path="url(#editor)">${s.nodes
      .filter((n) => n.dragging)
      .map((n, i) => node(n.asset, n.x, n.y, n.opacity, `drag${i}`, true))
      .join('')}</g>` +
    (s.input ? inputSvg(s.input) : '') +
    overlays +
    (s.cursor.pressed
      ? `<circle cx="${s.cursor.x}" cy="${s.cursor.y}" r="15" fill="${s.cursor.button === 'right' ? '#4c97ff' : '#ff4c4c'}" opacity=".18"/>`
      : '') +
    `<path data-cursor-button="${s.cursor.button ?? 'left'}" transform="translate(${s.cursor.x} ${s.cursor.y})" d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/>`;
  const svg = `<svg class="scene-${namespace}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${m.viewport.width}" height="${m.viewport.height}" viewBox="0 0 ${m.viewport.width} ${m.viewport.height}"><style>${m.theme.replace(
    /([^{}]+)\{/g,
    (_, selectors: string) =>
      selectors
        .split(',')
        .map((selector) => `.scene-${namespace} ${selector.trim()}`)
        .join(',') + '{',
  )}</style><defs>${['workspace', 'toolbox', 'editor'].map((key) => `<clipPath id="${key}"><rect ${rect(m.layout[key as 'workspace'])}/></clipPath>`).join('')}</defs><g font-family="Motion Sans">${content}</g></svg>`;
  return svg
    .replace(/(?<=\s)id="([^"]+)"/g, (_, id: string) => `id="${namespace}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${namespace}-${id})`)
    .replace(/(href=")#([^"]+)/g, (_, start: string, id: string) => `${start}#${namespace}-${id}`);
}
let playerId = 0;
export function mountPlayer(host: HTMLElement, compiled: CompiledScene) {
  assertResources(compiled);
  const namespace = `player${++playerId}`;
  host.innerHTML =
    '<div class="motion-frame"></div><footer><button type="button">播放</button><input type="range" min="0" step="any" aria-label="播放时间"><output></output></footer>';
  const frame = host.querySelector<HTMLDivElement>('.motion-frame')!,
    button = host.querySelector('button')!,
    range = host.querySelector('input')!,
    output = host.querySelector('output')!;
  range.max = String(compiled.duration);
  let time = 0,
    playing = false,
    startTime = 0,
    startClock = 0,
    request = 0,
    disposed = false;
  function render() {
    frame.innerHTML = frameSvg(time, compiled, namespace);
    range.value = String(time);
    output.value = `${time.toFixed(2)} / ${compiled.duration.toFixed(2)} s`;
    button.textContent = playing ? '暂停' : '播放';
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(request);
    render();
  }
  function seek(t: number) {
    if (disposed) return;
    if (!Number.isFinite(t) || t < 0) fail('TIME', 'player', 'Invalid seek time');
    time = Math.min(t, compiled.duration);
    pause();
  }
  function tick(now: number) {
    if (!playing || disposed) return;
    // RAF timestamps describe the frame start and may precede play() in that frame.
    time = Math.min(compiled.duration, startTime + Math.max(0, now - startClock) / 1000);
    if (time === compiled.duration) playing = false;
    render();
    if (playing) request = requestAnimationFrame(tick);
  }
  function play() {
    if (disposed) return;
    if (time >= compiled.duration) time = 0;
    playing = true;
    startTime = time;
    startClock = performance.now();
    cancelAnimationFrame(request);
    render();
    request = requestAnimationFrame(tick);
  }
  const toggle = () => (playing ? pause() : play());
  const scrub = () => seek(Number(range.value));
  button.addEventListener('click', toggle);
  range.addEventListener('input', scrub);
  render();
  return {
    seek,
    play,
    pause,
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    dispose() {
      disposed = true;
      playing = false;
      cancelAnimationFrame(request);
      button.removeEventListener('click', toggle);
      range.removeEventListener('input', scrub);
      host.replaceChildren();
    },
  };
}
