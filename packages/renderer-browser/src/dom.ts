import {
  evaluate,
  inputTextLayout,
  targetPanelLayout,
  type CompiledScene,
  type Manifest,
  type Rect,
  type Snapshot,
} from '@blockdia-motion/core';
import { layout as baseLayout } from '@blockdia-motion/adapter-turbowarp/layout';

import { guiColor, blockColor } from './appearance.js';
export interface WorkspaceView {
  x: number;
  y: number;
  zoom: number;
}
export interface RenderOptions {
  cursorMotion?: 'linear' | 'curve';
  cursorClickEffect?: 'circle' | 'shrink';
}
export const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  css = '',
) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  parent.append(e);
  return e;
}
export function position(e: HTMLElement, r: Rect) {
  Object.assign(e.style, {
    position: 'absolute',
    left: r.x + 'px',
    top: r.y + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
  });
}
const contents = new WeakMap<HTMLElement, string>();
const setHTML = (e: HTMLElement, html: string) => {
  if (contents.get(e) !== html) {
    e.innerHTML = html;
    contents.set(e, html);
  }
};
export interface NativeShellTemplate {
  zoom: (Rect & { src: string; action: 'in' | 'out' | 'reset' })[];
  html: string;
  css: string;
  variables: Record<string, string>;
  category: string;
  tile: string;
  source: { gui: string; locale: string; theme: string };
}
export async function loadNativeShell(
  runtimeUrl: string,
  locale: string,
  theme: string,
  signal?: AbortSignal,
): Promise<NativeShellTemplate> {
  const response = await fetch(
    new URL(`shell.${locale}.${theme}.json`, runtimeUrl),
    signal ? { signal } : {},
  );
  if (!response.ok) throw Error('Missing native shell; run shell:build and runtime:build');
  const template = (await response.json()) as NativeShellTemplate;
  if (
    template.source.gui !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff' ||
    template.source.locale !== locale ||
    template.source.theme !== theme
  )
    throw Error('Native shell version mismatch');
  return template;
}
let ids = 0;
export function createShell(
  parent: HTMLElement,
  fontFamily: string,
  locale: string,
  native: NativeShellTemplate,
) {
  const root = element(
    'div',
    parent,
    'position:relative;width:1280px;height:720px;overflow:hidden;transform-origin:0 0;font-size:12px;color:var(--text);isolation:isolate',
  );
  root.className = 'motion-scene';
  root.style.fontFamily = fontFamily;
  const scope = 'motion-dom-' + ++ids;
  root.id = scope;
  for (const [key, value] of Object.entries(native.variables)) root.style.setProperty(key, value);
  const css = element('style', root);
  css.textContent =
    native.css.replaceAll('__MOTION_SCOPE__', '#' + scope) +
    `
#${scope}{width:1280px;height:720px;overflow:hidden;position:relative} #${scope} *{font-family:inherit!important;box-sizing:border-box;transition:none!important;animation:none!important} #${scope} [data-native-root]{position:absolute;inset:0;pointer-events:none;z-index:0} #${scope} [data-view-action]{pointer-events:auto;cursor:pointer;background:none;border:0;width:36px;height:36px;padding:0} #${scope} [data-overlay]{white-space:pre;box-shadow:0 2px 5px #0002} #${scope} [hidden]{display:none!important}`;
  const mount = element('div', root, 'position:absolute;inset:0;pointer-events:none');
  mount.dataset.nativeRoot = '';
  mount.innerHTML = native.html;
  const region = (e: HTMLElement): Rect => {
    const r = e.getBoundingClientRect(),
      o = root.getBoundingClientRect(),
      k = root.offsetWidth / o.width;
    return { x: (r.x - o.x) * k, y: (r.y - o.y) * k, width: r.width * k, height: r.height * k };
  };
  function slot(name: string) {
    const e = mount.querySelector<HTMLElement>(`[data-native="${name}"]`);
    if (!e) throw Error('Missing native shell slot: ' + name);
    return e;
  }
  const categories = slot('categories'),
    blockRect = region(slot('blocks')),
    categoryRect = region(categories.parentElement!);
  const workspaceRect = {
    x: blockRect.x + categoryRect.width + 1,
    y: blockRect.y + 1,
    width: blockRect.width - categoryRect.width - 2,
    height: blockRect.height - 2,
  };
  const toolboxRect = { ...workspaceRect, width: 250 };
  const grid = element(
    'div',
    root,
    'pointer-events:none;background-color:var(--workspace);background-image:radial-gradient(var(--grid) 1px,transparent 1px);background-size:27px 27px',
  );
  position(grid, workspaceRect);
  const workspace = element('div', root, 'overflow:hidden;pointer-events:none');
  position(workspace, workspaceRect);
  const world = element('div', workspace, 'position:absolute;transform-origin:0 0');
  const flyout = element(
    'div',
    root,
    'overflow:hidden;background:color-mix(in srgb,var(--flyout) 80%,transparent);border-right:1px solid var(--border);pointer-events:none',
  );
  position(flyout, toolboxRect);
  const toolbox = element('div', flyout, 'position:absolute');
  const stage = slot('stage');
  stage.style.position = 'relative';
  stage.style.overflow = 'hidden';
  const properties = slot('properties'),
    targets = slot('targets'),
    backdrop = slot('backdrop');
  const listRect = region(targets.parentElement!);
  targets.style.position = 'relative';
  targets.style.display = 'block';
  targets.style.padding = '0';
  targets.style.height = '100%';
  targets.parentElement!.style.overflow = 'hidden';
  const dragged = element('div', root, 'overflow:hidden;pointer-events:none');
  position(dragged, workspaceRect);
  const dragWorld = element('div', dragged, 'position:absolute;transform-origin:0 0');
  const overlayClip = element('div', root, 'overflow:hidden;pointer-events:none');
  position(overlayClip, workspaceRect);
  const overlays = element('div', overlayClip, 'position:absolute;transform-origin:0 0');
  const controls = element('div', root, 'position:absolute;inset:0;pointer-events:none');
  for (const control of native.zoom) {
    const button = element('button', controls);
    position(button, control);
    button.dataset.viewAction = control.action;
    button.setAttribute(
      'aria-label',
      locale === 'en'
        ? { in: 'Zoom in', out: 'Zoom out', reset: 'Reset view' }[control.action]
        : { in: '放大', out: '缩小', reset: '恢复视角' }[control.action],
    );
    const img = element('img', button, 'display:block;width:100%;height:100%;pointer-events:none');
    img.src = control.src;
    img.alt = '';
  }
  const cursor = element(
    'div',
    root,
    'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0;width:32px;height:32px;overflow:visible;z-index:100',
  );
  cursor.innerHTML =
    '<svg width="44" height="44" style="overflow:visible"><circle data-cursor-click-effect="circle" r="15" fill="#ff4c4c" opacity=".18"/><path data-cursor-button="left" d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/></svg>';
  const layout: Manifest['layout'] = {
    ...baseLayout,
    workspace: workspaceRect,
    editor: workspaceRect,
    toolbox: toolboxRect,
    categories: categoryRect,
    spriteList: listRect,
    backdrop: region(backdrop),
  };
  return {
    root,
    layout,
    world,
    toolbox,
    categories,
    stage,
    targets,
    backdrop,
    properties,
    dragWorld,
    overlays,
    cursor,
    grid,
    scope,
    native,
  };
}
export type Shell = ReturnType<typeof createShell>;
export function createSceneRenderer(shell: Shell, scene: CompiledScene) {
  const m = scene.manifest,
    s = shell;
  const gui = (k: string, f: string) => guiColor(m, k, f),
    block = (k: string, f: string) => blockColor(m, k, f);
  const colors: Record<string, string> = {
    text: gui('text-primary', '#575e75'),
    surface: gui('ui-primary', '#e5f0ff'),
    panel: gui('ui-white', 'white'),
    input: gui('input-background', 'white'),
    border: gui('ui-black-transparent', '#c7c7c7'),
    accent: gui('looks-secondary', '#ff4c4c'),
    workspace: block('workspace', '#f9f9f9'),
    flyout: block('flyout', '#f9f9f9'),
    grid: block('gridColor', '#d9e3f2'),
  };
  for (const [k, v] of Object.entries(colors)) s.root.style.setProperty('--' + k, v);
  for (const img of s.root.querySelectorAll<HTMLImageElement>('[data-view-action] img'))
    img.style.filter = block('zoomIconFilter', 'none');
  const style = element('style', s.root);
  style.textContent = m.theme.replace(
    /([^{}]+)\{/g,
    (_, sel: string) =>
      sel
        .split(',')
        .map((x) => `#${s.scope} ${x.trim()}`)
        .join(',') + '{',
  );
  const nodes = new Map<string, { el: HTMLDivElement; asset: string }>();
  const w = m.layout.workspace,
    b = m.layout.toolbox,
    scale = m.layout.blockScale;
  function resource(
    parent: HTMLElement,
    key: string,
    asset: string,
    x: number,
    y: number,
    opacity = 1,
    drag = false,
  ) {
    let entry = nodes.get(key);
    if (!entry) {
      entry = {
        el: element('div', parent, 'position:absolute;left:0;top:0;transform-origin:0 0'),
        asset: '',
      };
      nodes.set(key, entry);
    }
    if (entry.el.parentElement !== parent) parent.append(entry.el);
    if (entry.asset !== asset) {
      const content = m.resources[asset]!.content,
        prefix = s.scope + '-' + key;
      entry.el.innerHTML = `<svg width="1" height="1" style="display:block;overflow:visible">${content
        .replace(/(?<=\s)id="([^"]+)"/g, (_, id) => `id="${prefix}-${id}"`)
        .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}-${id})`)
        .replace(/(href=")#([^"]+)/g, (_, q, id) => `${q}#${prefix}-${id}`)}</svg>`;
      entry.asset = asset;
    }
    entry.el.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    entry.el.style.opacity = String(opacity);
    entry.el.hidden = false;
    entry.el.style.filter = drag ? 'drop-shadow(0 0 6px #0005)' : '';
    if (drag) entry.el.dataset.draggedStack = 'true';
    else delete entry.el.dataset.draggedStack;
  }
  function draw(time: number, view: WorkspaceView, options: RenderOptions) {
    const snapshot = evaluate(time, scene, options),
      catalog = m.targets[snapshot.targetId]!;
    for (const n of nodes.values()) n.el.hidden = true;
    const transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    s.world.style.transform = transform;
    s.overlays.style.transform = transform;
    s.grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
    s.grid.style.backgroundSize = `${27 * view.zoom}px ${27 * view.zoom}px`;
    const inWorkspace =
      snapshot.cursor.x >= b.x + b.width &&
      snapshot.cursor.x <= w.x + w.width &&
      snapshot.cursor.y >= w.y &&
      snapshot.cursor.y <= w.y + w.height;
    s.dragWorld.style.transform = inWorkspace
      ? transform
      : `translate(${snapshot.cursor.x - w.x}px,${snapshot.cursor.y - w.y}px) scale(${view.zoom}) translate(${w.x - snapshot.cursor.x}px,${w.y - snapshot.cursor.y}px)`;
    for (const n of snapshot.nodes)
      resource(
        n.dragging ? s.dragWorld : s.world,
        'node-' + n.id,
        n.asset,
        n.x - w.x,
        n.y - w.y,
        n.opacity,
        n.dragging,
      );
    for (const [i, e] of catalog.toolbox.entries()) {
      const r = m.resources[e.asset]!.box,
        y = e.position.y - b.y - snapshot.toolbox.scroll;
      if (y + r.y * scale < b.height && y + (r.y + r.height) * scale > 0)
        resource(s.toolbox, 'tool-' + snapshot.targetId + '-' + i, e.asset, e.position.x - b.x, y);
    }
    let decorations = s.toolbox.querySelector<HTMLDivElement>('[data-decorations]');
    if (!decorations) {
      decorations = element('div', s.toolbox);
      decorations.dataset.decorations = '';
    }
    decorations.style.transform = `translateY(${-snapshot.toolbox.scroll}px)`;
    setHTML(
      decorations,
      catalog.decorations
        .map(
          (d) =>
            `<div style="position:absolute;left:${d.position.x - b.x}px;top:${d.position.y - b.y}px;width:${d.width}px;height:${d.height}px;display:flex;align-items:center;${d.kind === 'button' || d.kind === 'checkbox' ? 'border:1px solid var(--border);border-radius:4px;background:var(--panel);justify-content:center;' : ''}">${escape(d.text)}</div>`,
        )
        .join(''),
    );
    let scrollbar = s.toolbox.parentElement!.querySelector<HTMLElement>('[data-toolbox-scrollbar]');
    if (!scrollbar) {
      scrollbar = element(
        'div',
        s.toolbox.parentElement!,
        'position:absolute;right:5px;width:6px;border-radius:3px;pointer-events:none',
      );
      scrollbar.dataset.toolboxScrollbar = '';
    }
    scrollbar.style.backgroundColor = block('scrollbar', '#ccc');
    scrollbar.style.height = `${Math.max(20, b.height * Math.min(1, b.height / catalog.contentHeight))}px`;
    scrollbar.style.top = `${(snapshot.toolbox.scroll / Math.max(catalog.contentHeight, b.height)) * b.height}px`;
    const categoryKey = snapshot.targetId + ':' + snapshot.toolbox.category;
    if (s.categories.dataset.state !== categoryKey) {
      s.categories.replaceChildren();
      for (const c of catalog.categories) {
        const wrapper = element('div', s.categories);
        wrapper.className = 'scratchCategoryMenuRow';
        wrapper.innerHTML = s.native.category;
        const item = wrapper.firstElementChild as HTMLElement;
        item.className = `scratchCategoryMenuItem scratchCategoryId-${c.key}${c.key === snapshot.toolbox.category ? ' categorySelected' : ''}`;
        item.querySelector('.scratchCategoryMenuItemLabel')!.textContent = c.label;
        Object.assign((item.querySelector('.scratchCategoryItemBubble') as HTMLElement).style, {
          backgroundColor: c.color ?? '#888',
          borderColor: c.borderColor ?? c.color ?? '#888',
        });
      }
      s.categories.dataset.state = categoryKey;
    }
    const selected = m.project.targets.find((t) => t.id === snapshot.targetId)!;
    s.properties.dataset.ui = 'target-properties';
    s.properties.setAttribute('aria-disabled', String(selected.isStage));
    for (const input of s.properties.querySelectorAll<HTMLInputElement>('[data-property]')) {
      const key = input.dataset.property as 'name' | 'x' | 'y' | 'size' | 'direction';
      input.value = selected.isStage ? '' : String(selected[key]);
      input.disabled = selected.isStage;
    }
    for (const [i, button] of Array.from(
      s.properties.querySelectorAll<HTMLButtonElement>('[aria-pressed]'),
    ).entries()) {
      button.disabled = selected.isStage;
      button.setAttribute(
        'aria-pressed',
        String(!selected.isStage && (i === 0 ? selected.visible : !selected.visible)),
      );
      button.dataset.visibility = i === 0 ? 'show' : 'hide';
    }
    const layout = targetPanelLayout(m, snapshot.targetId, snapshot.targetScroll);
    s.targets.dataset.scroll = String(layout.scroll);
    s.targets.dataset.ui = 'sprite-list';
    const stateKey = snapshot.targetId + ':' + layout.scroll;
    if (s.targets.dataset.state !== stateKey) {
      s.targets.replaceChildren();
      m.project.targets
        .filter((t) => !t.isStage)
        .forEach((t, i) => {
          const holder = element('div', s.targets);
          holder.innerHTML = s.native.tile;
          const tile = holder.firstElementChild as HTMLElement;
          // The source wrapper is preserved; its position follows the same measured list as cursor targeting.
          const r = layout.tile(i);
          position(holder, {
            ...r,
            x: r.x - m.layout.spriteList.x,
            y: r.y - m.layout.spriteList.y,
          });
          tile.style.width = '100%';
          tile.style.height = '100%';
          tile.style.margin = '0';
          const item = tile.matches('[class*="sprite-selector-item_sprite-selector-item_"]')
            ? tile
            : tile.querySelector<HTMLElement>(
                '[class*="sprite-selector-item_sprite-selector-item_"]',
              )!;
          item.dataset.targetId = t.id;
          item.dataset.selected = String(t.id === snapshot.targetId);
          item.title = t.name;
          item
            .querySelectorAll<HTMLElement>('[class*="sprite-selector-item_delete-button_"]')
            .forEach((e) => (e.hidden = t.id !== snapshot.targetId));
          for (const cls of Array.from(item.classList))
            if (cls.includes('sprite-selector-item_is-selected_')) item.classList.remove(cls);
          if (t.id === snapshot.targetId)
            item.classList.add('sprite-selector-item_is-selected_24tQj');
          item.querySelector('[class*="sprite-selector-item_sprite-name_"]')!.textContent = t.name;
          item
            .querySelectorAll('[class*="sprite-selector-item_sprite-image_"]')
            .forEach((e) => e.remove());
        });
      s.targets.dataset.state = stateKey;
    }
    const stage = m.project.targets.find((t) => t.isStage)!;
    s.backdrop.dataset.targetId = stage.id;
    s.backdrop.dataset.selected = String(selected.isStage);
    s.backdrop.classList.toggle('stage-selector_is-selected_2x2r_', selected.isStage);
    s.backdrop.style.borderColor = selected.isStage ? 'var(--accent)' : '';
    const count = s.backdrop.querySelector('[class*="stage-selector_count_"]');
    if (count) count.textContent = String(stage.costumes.length);
    drawOverlays(s.overlays, snapshot, m);
    const x = inWorkspace
        ? w.x + view.x + (snapshot.cursor.x - w.x) * view.zoom
        : snapshot.cursor.x,
      y = inWorkspace ? w.y + view.y + (snapshot.cursor.y - w.y) * view.zoom : snapshot.cursor.y;
    s.cursor.style.transform = `translate(${x}px,${y}px) scale(${inWorkspace ? view.zoom : 1})`;
    const path = s.cursor.querySelector('path')!,
      circle = s.cursor.querySelector('circle')!;
    path.setAttribute('data-cursor-button', snapshot.cursor.button ?? 'left');
    path.setAttribute(
      'transform',
      `rotate(${snapshot.cursor.rotation ?? 0}) scale(${snapshot.cursor.pressed && options.cursorClickEffect === 'shrink' ? 0.75 : 1})`,
    );
    circle.setAttribute(
      'visibility',
      snapshot.cursor.pressed && options.cursorClickEffect !== 'shrink' ? 'visible' : 'hidden',
    );
    circle.setAttribute('fill', snapshot.cursor.button === 'right' ? '#4c97ff' : '#ff4c4c');
  }
  return {
    draw,
    dispose() {
      nodes.clear();
      s.root.remove();
    },
  };
}
function drawOverlays(host: HTMLElement, s: Snapshot, m: Manifest) {
  const w = m.layout.workspace;
  const active = new Set<string>();
  function layer(key: string, r: Rect, html: string, css = '') {
    active.add(key);
    let el = host.querySelector<HTMLDivElement>(`[data-layer="${key}"]`);
    if (!el) {
      el = element('div', host);
      el.dataset.layer = key;
    }
    el.hidden = false;
    el.style.cssText = css;
    position(el, { ...r, x: r.x - w.x, y: r.y - w.y });
    setHTML(el, html);
    return el;
  }
  if (s.input) {
    const { appearance: a, origin, scale, selected } = s.input,
      b = a.bounds,
      metrics = inputTextLayout(a);
    const el = layer(
      'input',
      { x: origin.x + b.x * scale, y: origin.y + b.y * scale, width: b.width, height: b.height },
      `<input readonly tabindex="-1" aria-label="Tutorial input" value="${escape(a.text)}" style="position:absolute;inset:0;width:100%;height:100%;opacity:0"><span style="position:absolute;left:${a.padding}px;right:${a.padding}px;top:0;height:100%;overflow:hidden"><span style="position:absolute;left:${metrics.textX - b.x - a.padding}px;top:${a.baseline - b.y - a.fontSize}px;font-size:${a.fontSize}px;font-weight:${a.fontWeight};line-height:1.2;white-space:pre;${selected ? 'background:#b4d5fe;' : ''}">${escape(a.text)}</span>${selected ? '' : `<span style="position:absolute;left:${metrics.caret - b.x - a.padding}px;top:${(b.height - a.fontSize * 1.2) / 2}px;height:${a.fontSize * 1.2}px;border-left:1px solid ${a.textColor}"></span>`}${s.input.preedit ? `<span data-preedit-underline="true" style="position:absolute;left:${metrics.preeditX - b.x - a.padding}px;top:${a.baseline - b.y + 2}px;width:${metrics.caret - metrics.preeditX}px;border-bottom:1px solid ${a.textColor}"></span>` : ''}</span>`,
      `border:${a.borderWidth}px solid ${a.stroke};border-radius:${a.radius}px;background:${a.fill};color:${a.textColor};box-shadow:0 0 0 ${a.shadowWidth}px ${a.shadowColor};transform-origin:0 0;transform:scale(${scale});`,
    );
    el.dataset.inputText = a.text;
  }
  s.overlays.forEach((o, i) => {
    if (o.menu) {
      const a = o.menu;
      const foreground = a.context ? blockColor(m, 'contextMenuForeground', '#000000') : 'white',
        hover = a.context
          ? blockColor(m, 'contextMenuActiveBackground', '#d6e9f8')
          : blockColor(m, 'menuHover', 'rgba(0, 0, 0, 0.2)'),
        disabledForeground = blockColor(m, 'contextMenuDisabledForeground', '#cccccc');
      const el = layer(
        'overlay' + i,
        a.panel,
        a.options
          .map(
            (v, j) =>
              `<div style="height:${a.rowHeight}px;display:flex;align-items:center;padding:0 12px;font-size:${a.fontSize}px;font-weight:${a.context ? 'normal' : 'bold'};background:${a.hovered === j ? hover : 'transparent'};color:${a.context && a.enabled?.[j] === false ? disabledForeground : foreground};opacity:${!a.context && a.enabled?.[j] === false ? 0.5 : 1}">${a.checked === j ? '✓ ' : ''}${escape(v[0])}</div>`,
          )
          .join(''),
        `isolation:isolate;z-index:0;padding:4px 0;border:1px solid ${a.stroke};border-radius:4px;background:${a.fill};color:${foreground};`,
      );
      if (!a.context) {
        el.querySelector('[data-menu-arrow]')?.remove();
        const arrow = element('div', el);
        arrow.dataset.menuArrow = '';
        const center = o.bounds.x + o.bounds.width / 2 - a.panel.x;
        arrow.style.cssText = `position:absolute;z-index:-1;width:16px;height:16px;left:${Math.max(12, Math.min(center - 8, a.panel.width - 28))}px;${a.above ? 'bottom' : 'top'}:-9px;transform:rotate(45deg);background:${a.fill};border-${a.above ? 'bottom' : 'top'}:1px solid ${a.stroke};border-${a.above ? 'right' : 'left'}:1px solid ${a.stroke};`;
      }
      el.dataset.overlay = 'menu';
      return;
    }
    if (o.ime) {
      const text = o.ime
        .map(
          (c, j) =>
            `<span style="display:flex;flex-shrink:0;align-items:center;gap:5px;padding:4px 8px;border-radius:16px;${j === 0 ? 'background:#007aff;color:white;' : ''}"><small>${j + 1}</small><span data-ime-candidate="${j}">${escape(c)}</span></span>`,
        )
        .join('');
      const x = Math.max(w.x + 8, Math.min(o.imeAnchor?.x ?? o.bounds.x, w.x + w.width - 300)),
        y =
          o.bounds.y + o.bounds.height + 38 < w.y + w.height
            ? o.bounds.y + o.bounds.height + 6
            : Math.max(w.y + 4, o.bounds.y - 38);
      const el = layer(
        'overlay' + i,
        { x, y, width: Math.min(440, w.x + w.width - x - 8), height: 32 },
        text,
        'display:flex;align-items:center;width:max-content;max-width:440px;overflow:hidden;border-radius:16px;background:var(--panel);border:1px solid var(--border);font-size:16px;',
      );
      el.style.width = 'max-content';
      el.style.maxWidth = `${w.width - 16}px`;
      el.style.height = 'auto';
      el.style.flexWrap = 'wrap';
      const width = el.offsetWidth,
        height = el.offsetHeight;
      el.style.left = `${Math.max(8, Math.min((o.imeAnchor?.x ?? o.bounds.x) - w.x, w.width - width - 8))}px`;
      el.style.top = `${Math.max(4, Math.min(y - w.y, w.height - height - 4))}px`;
      el.dataset.overlay = 'ime';
      return;
    }
    layer(
      'highlight' + i,
      o.bounds,
      '',
      'outline:3px solid #ffbf00;outline-offset:2px;border-radius:4px;',
    );
    if (o.text) {
      const el = layer(
        'overlay' + i,
        {
          x: Math.max(w.x + 8, Math.min(o.bounds.x, w.x + w.width - 240)),
          y:
            o.bounds.y + o.bounds.height + 70 < w.y + w.height
              ? o.bounds.y + o.bounds.height + 8
              : Math.max(w.y + 8, o.bounds.y - 70),
          width: 240,
          height: 60,
        },
        escape(o.text),
        'padding:8px 10px;height:auto;white-space:pre-wrap;font-size:14px;border:1px solid var(--border);border-radius:4px;background:var(--panel);',
      );
      el.style.height = 'auto';
      el.style.top = `${Math.max(8, Math.min(parseFloat(el.style.top), w.height - el.offsetHeight - 8))}px`;
      el.dataset.overlay = 'annotation';
    }
  });
  for (const el of host.querySelectorAll<HTMLElement>('[data-layer]'))
    if (!active.has(el.dataset.layer!)) el.hidden = true;
}
