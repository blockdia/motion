import {
  assertResources,
  inputTextLayout,
  evaluate,
  fail,
  type CompiledScene,
  type Rect,
  type Snapshot,
} from '@blockdia-motion/core';
import { shellSvg, uiPaint, darkIme } from './appearance.js';
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
export interface WorkspaceView {
  x: number;
  y: number;
  zoom: number;
}
export function frameSvg(
  time: number,
  compiled: CompiledScene,
  namespace = 'motion',
  view: WorkspaceView = { x: 0, y: 0, zoom: 1 },
): string {
  if (
    ![view.x, view.y, view.zoom].every(Number.isFinite) ||
    view.zoom < 0.3 / compiled.manifest.layout.blockScale ||
    view.zoom > 3 / compiled.manifest.layout.blockScale
  )
    fail('VIEW', 'render', 'Invalid workspace view');
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
    return `<g${dragging ? ' data-dragged-stack="true"' : ''} opacity="${opacity}" transform="translate(${x} ${y}) scale(${scale})">${dragging ? `<defs><filter id="${prefix}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feComponentTransfer result="offsetBlur"><feFuncA type="linear" slope=".3"/></feComponentTransfer><feComposite in="SourceGraphic" in2="offsetBlur" operator="over"/></filter></defs><g filter="url(#${prefix}-shadow)">${content}</g>` : content}</g>`;
  };
  const w = m.layout.workspace;
  const transform = `translate(${w.x + view.x} ${w.y + view.y}) scale(${view.zoom}) translate(${-w.x} ${-w.y})`;
  const viewed = (content: string, clip = true) =>
    `${clip ? '<g clip-path="url(#workspace)">' : ''}<g data-workspace-view="true" transform="${transform}">${content.replaceAll(' clip-path="url(#workspace)"', '')}</g>${clip ? '</g>' : ''}`;
  const catalog = m.targets[s.targetId];
  if (!catalog) fail('TARGET', 'render', `Missing target catalog ${s.targetId}`);
  const category = catalog.categories.find((c) => c.key === s.toolbox.category);
  const box = m.layout.toolbox;
  const workspace = viewed(
    `<g>${s.nodes
      .filter((n) => !n.dragging)
      .map((n, i) => node(n.asset, n.x, n.y, n.opacity, `root${i}`))
      .join('')}</g>`,
  );
  const workspaceSlot = '<g data-slot="workspace"></g>';
  const chrome = shellSvg(m.chrome, m)
    .replace(
      '<pattern id="workspace-dots"',
      `<pattern id="workspace-dots" patternTransform="${transform}"`,
    )
    .replace('<g data-slot="targets"></g>', () =>
      uiPaint(targetPanelSvg(m, s.targetId, s.targetScroll), m),
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
          `<circle cx="${m.layout.categories.x + m.layout.categories.width / 2}" cy="${c.y}" r="9.5" fill="${escape(c.color ?? '#888')}"/><text x="${m.layout.categories.x + m.layout.categories.width / 2}" y="${c.y + 23}" text-anchor="middle" font-size="10.4" fill="${m.colorTheme === 'dark' ? '#eeeeee' : '#575e75'}">${escape(c.label)}</text>`,
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
      .join('')}${uiPaint(
      catalog.decorations
        .filter(
          (d) =>
            d.position.y - s.toolbox.scroll + d.height >= box.y &&
            d.position.y - s.toolbox.scroll < box.y + box.height,
        )
        .map(
          (d) =>
            `<g transform="translate(${d.position.x} ${d.position.y - s.toolbox.scroll})">${d.kind === 'checkbox' ? `<rect width="${d.width}" height="${d.height}" rx="3" fill="white" stroke="#888"/>` : d.kind === 'button' ? `<rect width="${d.width}" height="${d.height}" rx="4" fill="white" stroke="#c7c7c7"/>` : ''}<text x="${d.kind === 'button' ? d.width / 2 : 0}" y="${d.height / 2 + 4}" text-anchor="${d.kind === 'button' ? 'middle' : 'start'}" font-size="12" fill="#575e75">${escape(d.text)}</text></g>`,
        )
        .join(''),
      m,
    )}</g>` +
    `<rect x="${box.x + box.width - 11}" y="${box.y + (s.toolbox.scroll / Math.max(catalog.contentHeight, box.height)) * box.height}" width="6" height="${Math.max(20, box.height * Math.min(1, box.height / catalog.contentHeight))}" rx="3" fill="#ccc"/>` +
    `<g clip-path="url(#editor)">` +
    `<g transform="translate(${s.cursor.x} ${s.cursor.y}) scale(${view.zoom}) translate(${-s.cursor.x} ${-s.cursor.y})">${s.nodes
      .filter((n) => n.dragging)
      .map((n, i) => node(n.asset, n.x, n.y, n.opacity, `drag${i}`, true))
      .join('')}</g>` +
    '</g>' +
    (s.input ? viewed(inputSvg(s.input)) : '') +
    viewed(uiPaint(overlays, m)) +
    ((content: string) =>
      !s.nodes.some((node) => node.dragging) &&
      s.cursor.x >= box.x + box.width &&
      s.cursor.x <= w.x + w.width &&
      s.cursor.y >= w.y &&
      s.cursor.y <= w.y + w.height
        ? viewed(content, false)
        : content)(
      (s.cursor.pressed
        ? `<circle cx="${s.cursor.x}" cy="${s.cursor.y}" r="15" fill="${s.cursor.button === 'right' ? '#4c97ff' : '#ff4c4c'}" opacity=".18"/>`
        : '') +
        `<path data-cursor-button="${s.cursor.button ?? 'left'}" transform="translate(${s.cursor.x} ${s.cursor.y})" d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/>`,
    );
  const svg = `<svg class="scene-${namespace}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${m.viewport.width}" height="${m.viewport.height}" viewBox="0 0 ${m.viewport.width} ${m.viewport.height}"><style>${(
    m.theme + (m.colorTheme === 'dark' ? darkIme : '')
  ).replace(
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
export interface PlayerOptions {
  loadVariant?: (
    options: { locale: 'zh-CN' | 'en'; theme: 'light' | 'dark' },
    signal: AbortSignal,
  ) => Promise<CompiledScene>;
}
export function mountPlayer(
  host: HTMLElement,
  initial: CompiledScene | undefined,
  options: PlayerOptions = {},
) {
  if (!initial) fail('RESOURCE', 'player', 'Missing scene');
  assertResources(initial);
  let compiled: CompiledScene | undefined = initial;
  initial = undefined;
  const namespace = `player${++playerId}`;
  host.innerHTML =
    '<div class="motion-frame" tabindex="0" aria-label="Workspace: drag to pan, scroll to zoom"></div><footer><button type="button">播放</button><input type="range" min="0" step="any" aria-label="播放时间"><output></output></footer><p role="status" aria-live="polite"></p>';
  const frame = host.querySelector<HTMLDivElement>('.motion-frame')!,
    button = host.querySelector('button')!,
    range = host.querySelector('input')!,
    output = host.querySelector('output')!,
    status = host.querySelector<HTMLElement>('[role="status"]')!;
  frame.style && (frame.style.touchAction = 'none');
  let time = 0,
    playing = false,
    startTime = 0,
    startClock = 0,
    request = 0,
    disposed = false;
  let view: WorkspaceView = { x: 0, y: 0, zoom: 1 };
  let drag: { id: number; x: number; y: number } | undefined;
  let pending: AbortController | undefined;
  function render() {
    if (!compiled || disposed) return;
    frame.innerHTML = frameSvg(time, compiled, namespace, view);
    range.max = String(compiled.duration);
    range.value = String(time);
    output.value = `${time.toFixed(2)} / ${compiled.duration.toFixed(2)} s`;
    button.textContent =
      compiled.manifest.locale === 'en' ? (playing ? 'Pause' : 'Play') : playing ? '暂停' : '播放';
  }
  function pause() {
    if (disposed) return;
    if (playing && compiled)
      time = Math.min(
        compiled.duration,
        startTime + Math.max(0, performance.now() - startClock) / 1000,
      );
    playing = false;
    cancelAnimationFrame(request);
    render();
  }
  function endDrag() {
    if (drag && frame.hasPointerCapture?.(drag.id)) frame.releasePointerCapture(drag.id);
    drag = undefined;
  }
  function resetView() {
    endDrag();
    view = { x: 0, y: 0, zoom: 1 };
    render();
  }
  function seek(t: number) {
    if (disposed || !compiled) return;
    if (!Number.isFinite(t) || t < 0) fail('TIME', 'player', 'Invalid seek time');
    pause();
    time = Math.min(t, compiled.duration);
    resetView();
  }
  function tick(now: number) {
    if (!playing || disposed || !compiled) return;
    time = Math.min(compiled.duration, startTime + Math.max(0, now - startClock) / 1000);
    if (time === compiled.duration) playing = false;
    render();
    if (playing) request = requestAnimationFrame(tick);
  }
  function play() {
    if (disposed || !compiled || pending) return;
    resetView();
    if (time >= compiled.duration) time = 0;
    playing = true;
    startTime = time;
    startClock = performance.now();
    cancelAnimationFrame(request);
    render();
    request = requestAnimationFrame(tick);
  }
  function point(event: MouseEvent) {
    const svg = frame.querySelector('svg')!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function inside(p: { x: number; y: number }) {
    const { workspace: w, toolbox: b } = compiled!.manifest.layout;
    return p.x >= b.x + b.width && p.x < w.x + w.width && p.y >= w.y && p.y < w.y + w.height;
  }
  function down(event: PointerEvent) {
    if (pending || event.button !== 0 || (event.target as Element).closest('[data-view-action]'))
      return;
    const p = point(event);
    if (!p || !inside(p)) return;
    event.preventDefault();
    pause();
    drag = { id: event.pointerId, x: p.x, y: p.y };
    frame.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const p = point(event);
    if (!p) return;
    view.x += p.x - drag.x;
    view.y += p.y - drag.y;
    drag.x = p.x;
    drag.y = p.y;
    render();
  }
  function up(event: PointerEvent) {
    if (drag?.id === event.pointerId) endDrag();
  }
  function wheel(event: WheelEvent) {
    if (pending) return;
    const p = point(event);
    if (!p || !inside(p)) return;
    event.preventDefault();
    pause();
    endDrag();
    const multiplier = event.deltaMode === 1 ? 15 : 1;
    if (event.ctrlKey) zoomAt(p, (-event.deltaY * multiplier) / 50);
    else {
      const horizontal = event.shiftKey && event.deltaX === 0;
      view.x -= (horizontal ? event.deltaY : event.deltaX) * multiplier;
      view.y -= horizontal ? 0 : event.deltaY * multiplier;
      render();
    }
  }
  function zoomAt(p: { x: number; y: number }, amount: number) {
    const w = compiled!.manifest.layout.workspace;
    const scale = compiled!.manifest.layout.blockScale;
    const zoom = Math.max(0.3 / scale, Math.min(3 / scale, view.zoom * Math.pow(1.2, amount)));
    const ratio = zoom / view.zoom;
    view = {
      x: p.x - w.x - (p.x - w.x - view.x) * ratio,
      y: p.y - w.y - (p.y - w.y - view.y) * ratio,
      zoom,
    };
    render();
  }
  function action(event: Event) {
    const control = (event.target as Element).closest('[data-view-action]');
    if (!control || pending || !compiled) return false;
    event.preventDefault();
    pause();
    endDrag();
    const name = control.getAttribute('data-view-action');
    if (name === 'reset') resetView();
    else {
      const { workspace: w, toolbox: b } = compiled.manifest.layout;
      zoomAt(
        { x: (b.x + b.width + w.x + w.width) / 2, y: w.y + w.height / 2 },
        name === 'in' ? 1 : -1,
      );
    }
    // The SVG is replaced on render; keep keyboard navigation on the same control.
    frame.querySelector<SVGElement>(`[data-view-action="${name}"]`)?.focus();
    return true;
  }
  function click(event: MouseEvent) {
    action(event);
  }

  function key(event: KeyboardEvent) {
    if (pending) return;
    if ((event.key === 'Enter' || event.key === ' ') && action(event)) return;
    if (event.key === '0') {
      event.preventDefault();
      resetView();
      return;
    }
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [30, 0],
      ArrowRight: [-30, 0],
      ArrowUp: [0, 30],
      ArrowDown: [0, -30],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    pause();
    view.x += offset[0];
    view.y += offset[1];
    render();
  }
  async function setOptions(next: { locale: 'zh-CN' | 'en'; theme: 'light' | 'dark' }) {
    if (disposed || !compiled) return;
    if (!['zh-CN', 'en'].includes(next.locale) || !['light', 'dark'].includes(next.theme))
      fail('UNSUPPORTED', 'player', 'Unknown variant');
    pause();
    endDrag();
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    host.setAttribute('aria-busy', 'true');
    status.textContent = next.locale === 'en' ? 'Loading…' : '正在加载…';
    try {
      const scene =
        next.locale === compiled.manifest.locale
          ? { ...compiled, manifest: { ...compiled.manifest, colorTheme: next.theme } }
          : await (options.loadVariant?.(next, controller.signal) ??
              Promise.reject(Error('No locale variant loader configured')));
      if (disposed || pending !== controller) return;
      assertResources(scene);
      if (
        scene.manifest.source.fontSha256 !== compiled.manifest.source.fontSha256 ||
        JSON.stringify(scene.manifest.project) !== JSON.stringify(compiled.manifest.project) ||
        scene.manifest.viewport.width !== compiled.manifest.viewport.width ||
        scene.manifest.viewport.height !== compiled.manifest.viewport.height
      )
        fail('VARIANT', 'player', 'Variant project, viewport or font mismatch');
      if (
        scene.manifest.locale !== next.locale ||
        (scene.manifest.colorTheme ?? 'light') !== next.theme
      )
        fail('VARIANT', 'player', 'Variant does not match requested options');
      compiled = scene;
      time = Math.min(time, scene.duration);
      resetView();
      status.textContent = '';
    } catch (error) {
      if (disposed || pending !== controller) return;
      status.textContent = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (!disposed && pending === controller) {
        pending = undefined;
        host.setAttribute('aria-busy', 'false');
      }
    }
  }
  const toggle = () => (playing ? pause() : play());
  const scrub = () => seek(Number(range.value));
  button.addEventListener('click', toggle);
  range.addEventListener('input', scrub);
  frame.addEventListener('click', click);
  frame.addEventListener('pointerdown', down);
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerup', up);
  frame.addEventListener('pointercancel', up);
  frame.addEventListener('lostpointercapture', up);
  frame.addEventListener('wheel', wheel, { passive: false });
  frame.addEventListener('keydown', key);
  render();
  return {
    seek,
    play,
    pause,
    resetView,
    setOptions,
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    get view() {
      return { ...view };
    },
    get appearance() {
      return compiled
        ? { locale: compiled.manifest.locale, theme: compiled.manifest.colorTheme ?? 'light' }
        : undefined;
    },
    dispose() {
      if (disposed) return;
      endDrag();
      disposed = true;
      playing = false;
      pending?.abort();
      pending = undefined;
      compiled = undefined;
      options = {};
      cancelAnimationFrame(request);
      button.removeEventListener('click', toggle);
      range.removeEventListener('input', scrub);
      frame.removeEventListener('click', click);
      frame.removeEventListener('pointerdown', down);
      frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', up);
      frame.removeEventListener('pointercancel', up);
      frame.removeEventListener('lostpointercapture', up);
      frame.removeEventListener('wheel', wheel);
      frame.removeEventListener('keydown', key);
      frame.replaceChildren();
      host.replaceChildren();
      host.removeAttribute('aria-busy');
    },
  };
}
