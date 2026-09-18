import {
  fail,
  canonicalJson,
  type TutorialBundle,
  type FontOptions,
  type CompiledScene,
  type CursorMotion,
} from '@blockdia-motion/core';
import { parseBundle, adapterVersion } from '@blockdia-motion/authoring/bundle-schema';
import { prepareInBrowser } from '@blockdia-motion/asset-builder/browser';
import {
  createShell,
  createSceneRenderer,
  loadNativeShell,
  element,
  type WorkspaceView,
  type RenderOptions,
} from './dom.js';
import { createStage } from './stage.js';
export type { WorkspaceView, RenderOptions } from './dom.js';
export type { CursorMotion } from '@blockdia-motion/core';
export type CursorClickEffect = 'circle' | 'shrink';
export interface PlayerOptions extends RenderOptions {
  font?: FontOptions;
  resourceBaseUrl?: string;
  runtimeUrl?: string;
  loadVariant?: (
    options: { locale: 'zh-CN' | 'en'; theme: 'light' | 'dark' },
    signal: AbortSignal,
  ) => Promise<TutorialBundle>;
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
let fontGeneration = 0;
export function mountPlayer(host: HTMLElement, input: TutorialBundle, options: PlayerOptions = {}) {
  let bundle = parseBundle(input),
    font = options.font ?? { family: '"Helvetica Neue", Helvetica, Arial, sans-serif' };
  let cursorMotion = options.cursorMotion ?? 'linear',
    cursorClickEffect = options.cursorClickEffect ?? 'circle';
  function checkMotion(v: CursorMotion) {
    if (!['linear', 'curve'].includes(v)) fail('UNSUPPORTED', 'player', 'Unknown cursor motion');
  }
  function checkEffect(v: CursorClickEffect) {
    if (!['circle', 'shrink'].includes(v))
      fail('UNSUPPORTED', 'player', 'Unknown cursor click effect');
  }
  checkMotion(cursorMotion);
  checkEffect(cursorClickEffect);
  const base = new URL(options.resourceBaseUrl ?? '.', document.baseURI).href;
  const runtime = new URL(
    options.runtimeUrl ?? `/artifacts/runtime/${adapterVersion}/`,
    document.baseURI,
  ).href;
  host.replaceChildren();
  const frame = element(
    'div',
    host,
    'position:relative;width:100%;aspect-ratio:1280/720;overflow:hidden;touch-action:none',
  );
  frame.className = 'motion-frame';
  frame.tabIndex = 0;
  frame.setAttribute('aria-label', 'Workspace: drag to pan, scroll to zoom');
  const footer = element('footer', host, 'display:flex;gap:12px;align-items:center;flex-wrap:wrap');
  const button = element('button', footer);
  button.textContent = '播放';
  button.disabled = true;
  const range = element('input', footer, 'flex:1;min-width:120px');
  range.type = 'range';
  range.min = '0';
  range.step = 'any';
  range.value = '0';
  range.disabled = true;
  range.setAttribute('aria-label', '播放时间');
  const output = element('output', footer);
  const status = element('p', host);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let compiled: CompiledScene | undefined,
    renderer: ReturnType<typeof createSceneRenderer> | undefined,
    stage: Awaited<ReturnType<typeof createStage>> | undefined;
  let preparationStats:
    | { assetPreparationMs: number; resources: number; resourceContentBytes: number }
    | undefined;
  let root: HTMLElement | undefined,
    activeLife: AbortController | undefined,
    pending: AbortController | undefined;
  let time = 0,
    playing = false,
    disposed = false,
    request = 0,
    lastClock = 0,
    epoch = 0;
  let view: WorkspaceView = { x: 0, y: 0, zoom: 1 };
  let drag: { id: number; x: number; y: number } | undefined;
  const fonts = new Set<FontFace>();
  const signalLife = new AbortController();
  function fit() {
    if (root) root.style.transform = `scale(${frame.clientWidth / 1280})`;
  }
  const resize = new ResizeObserver(fit);
  resize.observe(frame);
  function render() {
    if (!compiled || disposed) return;
    renderer!.draw(time, view, { cursorMotion, cursorClickEffect });
    range.max = String(compiled.duration);
    range.value = String(time);
    output.value = `${time.toFixed(2)} / ${compiled.duration.toFixed(2)} s`;
    button.textContent =
      compiled.manifest.locale === 'en' ? (playing ? 'Pause' : 'Play') : playing ? '暂停' : '播放';
  }
  function pause() {
    playing = false;
    epoch++;
    cancelAnimationFrame(request);
    stage?.pause();
    render();
  }
  function endDrag() {
    if (drag && frame.hasPointerCapture(drag.id)) frame.releasePointerCapture(drag.id);
    drag = undefined;
  }
  function resetView() {
    endDrag();
    view = { x: 0, y: 0, zoom: 1 };
    render();
  }
  function report(error: unknown) {
    if (!disposed) {
      pause();
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  async function prepare(next: TutorialBundle, nextFont: FontOptions) {
    pause();
    endDrag();
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    host.setAttribute('aria-busy', 'true');
    status.textContent = next.tutorial.defaults.locale === 'en' ? 'Preparing…' : '正在准备…';
    button.disabled = range.disabled = true;
    const container = element(
      'div',
      frame,
      'position:absolute;left:0;top:0;visibility:hidden;width:1280px;height:720px',
    );
    let freshRenderer: ReturnType<typeof createSceneRenderer> | undefined,
      freshStage: Awaited<ReturnType<typeof createStage>> | undefined,
      loadedFont: FontFace | undefined;
    try {
      if (!nextFont.family.trim()) throw Error('Font family is required');
      const resolvedFont = {
        ...nextFont,
        ...(nextFont.url
          ? { family: `MotionFont${++fontGeneration}`, url: new URL(nextFont.url, base).href }
          : {}),
      };
      if (resolvedFont.url) {
        loadedFont = await abortable(
          new FontFace(resolvedFont.family, `url(${JSON.stringify(resolvedFont.url)})`).load(),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        document.fonts.add(loadedFont);
      }
      await abortable(document.fonts.load(`16px ${resolvedFont.family}`), controller.signal);
      await abortable(document.fonts.ready, controller.signal);
      controller.signal.throwIfAborted();
      const template = await loadNativeShell(
        runtime,
        next.tutorial.defaults.locale,
        next.tutorial.defaults.theme,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const shell = createShell(
        container,
        resolvedFont.family,
        next.tutorial.defaults.locale,
        template,
      );
      const assetStart = performance.now();
      const scene = await prepareInBrowser(next, {
        runtimeUrl: runtime,
        font: resolvedFont,
        layout: shell.layout,
        signal: controller.signal,
      });
      const assetPreparationMs = performance.now() - assetStart;
      controller.signal.throwIfAborted();
      freshRenderer = createSceneRenderer(shell, scene);
      freshStage = await createStage(
        shell.stage,
        next.tutorial.stage?.clips ?? [],
        base,
        controller.signal,
      );
      const nextTime = Math.min(time, scene.duration);
      freshRenderer.draw(nextTime, { x: 0, y: 0, zoom: 1 }, { cursorMotion, cursorClickEffect });
      await freshStage.renderAt(nextTime);
      controller.signal.throwIfAborted();
      stage?.dispose();
      renderer?.dispose();
      activeLife?.abort();
      for (const face of fonts) document.fonts.delete(face);
      fonts.clear();
      if (loadedFont) fonts.add(loadedFont);
      root = shell.root;
      frame.append(root);
      container.remove();
      compiled = scene;
      const encoder = new TextEncoder();
      preparationStats = {
        assetPreparationMs,
        resources: Object.keys(scene.manifest.resources).length,
        resourceContentBytes: Object.values(scene.manifest.resources).reduce(
          (sum, resource) => sum + encoder.encode(resource.content).length,
          0,
        ),
      };
      renderer = freshRenderer;
      stage = freshStage;
      activeLife = controller;
      bundle = next;
      font = nextFont;
      time = nextTime;
      view = { x: 0, y: 0, zoom: 1 };
      fit();
      render();
      status.textContent = '';
    } catch (error) {
      freshStage?.dispose();
      freshRenderer?.dispose();
      container.remove();
      if (loadedFont && !fonts.has(loadedFont)) document.fonts.delete(loadedFont);
      if (!controller.signal.aborted) {
        status.textContent = error instanceof Error ? error.message : String(error);
        throw error;
      }
      throw controller.signal.reason;
    } finally {
      if (pending === controller) {
        pending = undefined;
        if (!disposed) {
          host.setAttribute('aria-busy', 'false');
          button.disabled = range.disabled = !compiled;
        }
      }
    }
  }
  const ready = prepare(bundle, font);
  void ready.catch(() => {});
  // Serialize exact seeks so late decoder events cannot overwrite a newer requested frame.
  let seeks = Promise.resolve();
  function seek(t: number): Promise<void> {
    if (!Number.isFinite(t) || t < 0) return Promise.reject(Error('Invalid seek time'));
    if (disposed) return Promise.resolve();
    pause();
    const generation = ++epoch;
    const work = seeks
      .catch(() => {})
      .then(async () => {
        await ready;
        if (disposed || generation !== epoch) return;
        if (pending) throw Error('Tutorial preparation in progress');
        time = Math.min(t, compiled!.duration);
        resetView();
        await stage!.renderAt(time);
        if (disposed || generation !== epoch) return;
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      });
    seeks = work;
    return work;
  }
  async function tick(now: number, token: number) {
    if (!playing || disposed || token !== epoch || !compiled) return;
    const next = Math.min(compiled.duration, time + Math.max(0, now - lastClock) / 1000);
    const started = performance.now();
    try {
      await stage!.renderAt(next, true);
      if (!playing || disposed || token !== epoch) return;
      time = next;
      render();
      lastClock = performance.now();
      if (lastClock - started < 50) lastClock = now;
      if (time === compiled.duration) {
        pause();
        await stage!.renderAt(time);
        return;
      }
      request = requestAnimationFrame((n) => void tick(n, token));
    } catch (error) {
      if (!disposed && token === epoch) report(error);
    }
  }
  function play() {
    if (disposed || pending || !compiled) return;
    resetView();
    if (time >= compiled.duration) time = 0;
    playing = true;
    const token = ++epoch;
    lastClock = performance.now();
    render();
    cancelAnimationFrame(request);
    request = requestAnimationFrame((n) => void tick(n, token));
  }
  function point(e: MouseEvent) {
    const r = frame.getBoundingClientRect();
    return { x: ((e.clientX - r.x) * 1280) / r.width, y: ((e.clientY - r.y) * 720) / r.height };
  }
  function inside(p: { x: number; y: number }) {
    if (!compiled) return false;
    const { workspace: w, toolbox: b } = compiled.manifest.layout;
    return p.x >= b.x + b.width && p.x < w.x + w.width && p.y >= w.y && p.y < w.y + w.height;
  }
  function zoomAt(p: { x: number; y: number }, amount: number) {
    if (!compiled) return;
    const w = compiled.manifest.layout.workspace,
      scale = compiled.manifest.layout.blockScale,
      zoom = Math.max(0.3 / scale, Math.min(3 / scale, view.zoom * 1.2 ** amount)),
      ratio = zoom / view.zoom;
    view = {
      x: p.x - w.x - (p.x - w.x - view.x) * ratio,
      y: p.y - w.y - (p.y - w.y - view.y) * ratio,
      zoom,
    };
    render();
  }
  function action(e: Event) {
    const control = (e.target as Element).closest('[data-view-action]');
    if (!control || pending || !compiled) return false;
    e.preventDefault();
    pause();
    endDrag();
    const name = control.getAttribute('data-view-action'),
      { workspace: w, toolbox: b } = compiled.manifest.layout;
    if (name === 'reset') resetView();
    else
      zoomAt(
        { x: (b.x + b.width + w.x + w.width) / 2, y: w.y + w.height / 2 },
        name === 'in' ? 1 : -1,
      );
    return true;
  }
  const on = { signal: signalLife.signal };
  button.addEventListener('click', () => (playing ? pause() : play()), on);
  range.addEventListener('input', () => void seek(Number(range.value)).catch(report), on);
  frame.addEventListener('click', action, on);
  frame.addEventListener(
    'pointerdown',
    (e) => {
      if (pending || e.button !== 0 || (e.target as Element).closest('[data-view-action]')) return;
      const p = point(e);
      if (!inside(p)) return;
      e.preventDefault();
      pause();
      drag = { id: e.pointerId, ...p };
      frame.setPointerCapture(e.pointerId);
    },
    on,
  );
  frame.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      const p = point(e);
      view.x += p.x - drag.x;
      view.y += p.y - drag.y;
      drag = { id: drag.id, ...p };
      render();
    },
    on,
  );
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    frame.addEventListener(event, endDrag, on);
  frame.addEventListener(
    'wheel',
    (e) => {
      if (pending) return;
      const p = point(e);
      if (!inside(p)) return;
      e.preventDefault();
      pause();
      endDrag();
      const k = e.deltaMode === 1 ? 15 : 1;
      if (e.ctrlKey) zoomAt(p, (-e.deltaY * k) / 50);
      else {
        const horizontal = e.shiftKey && e.deltaX === 0;
        view.x -= (horizontal ? e.deltaY : e.deltaX) * k;
        view.y -= horizontal ? 0 : e.deltaY * k;
        render();
      }
    },
    { ...on, passive: false },
  );
  frame.addEventListener(
    'keydown',
    (e) => {
      if (pending || !compiled) return;
      if ((e.key === 'Enter' || e.key === ' ') && action(e)) return;
      if ((e.target as Element).closest('button')) return;
      if (e.key === '0') {
        e.preventDefault();
        pause();
        resetView();
        return;
      }
      const v: Record<string, [number, number]> = {
        ArrowLeft: [30, 0],
        ArrowRight: [-30, 0],
        ArrowUp: [0, 30],
        ArrowDown: [0, -30],
      };
      if (v[e.key]) {
        e.preventDefault();
        pause();
        view.x += v[e.key]![0];
        view.y += v[e.key]![1];
        render();
      }
    },
    on,
  );
  async function setOptions(next: {
    locale: 'zh-CN' | 'en';
    theme: 'light' | 'dark';
    font?: FontOptions;
  }) {
    if (disposed) return;
    if (!['zh-CN', 'en'].includes(next.locale) || !['light', 'dark'].includes(next.theme))
      fail('UNSUPPORTED', 'player', 'Unknown variant');
    pause();
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    host.setAttribute('aria-busy', 'true');
    button.disabled = range.disabled = true;
    status.textContent = next.locale === 'en' ? 'Preparing…' : '正在准备…';
    try {
      let updated = bundle;
      if (next.locale !== bundle.tutorial.defaults.locale) {
        if (!options.loadVariant) throw Error('No language variant loader configured');
        updated = parseBundle(await options.loadVariant(next, controller.signal));
      }
      controller.signal.throwIfAborted();
      if (disposed) return;
      if (
        canonicalJson(updated.tutorial.project) !== canonicalJson(bundle.tutorial.project) ||
        canonicalJson(updated.tutorial.viewport) !== canonicalJson(bundle.tutorial.viewport) ||
        updated.tutorial.defaults.locale !== next.locale
      )
        throw Error('Variant project, viewport or language mismatch');
      updated = structuredClone(updated);
      updated.tutorial.defaults.theme = next.theme;
      pending = undefined;
      await prepare(updated, next.font ?? font);
    } catch (error) {
      if (!controller.signal.aborted && !disposed) {
        status.textContent = String(error);
        throw error;
      }
    } finally {
      if (pending === controller) {
        pending = undefined;
        if (!disposed) {
          host.setAttribute('aria-busy', 'false');
          button.disabled = range.disabled = !compiled;
        }
      }
    }
  }
  return {
    ready,
    seek,
    renderAt: seek,
    play,
    pause,
    resetView,
    setOptions,
    setCursorMotion(v: CursorMotion) {
      checkMotion(v);
      cursorMotion = v;
      render();
    },
    setCursorClickEffect(v: CursorClickEffect) {
      checkEffect(v);
      cursorClickEffect = v;
      render();
    },
    get time() {
      return time;
    },
    get duration() {
      return compiled?.duration ?? 0;
    },
    get preparationStats() {
      return preparationStats ? { ...preparationStats } : undefined;
    },
    /** Detached export data: callers cannot mutate the active player's scene. */
    getPreparedScene(): CompiledScene {
      if (!compiled || pending || disposed) throw Error('Player scene is not ready');
      return structuredClone(compiled);
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
    get cursorMotion() {
      return cursorMotion;
    },
    get cursorClickEffect() {
      return cursorClickEffect;
    },
    dispose() {
      if (disposed) return;
      pause();
      endDrag();
      disposed = true;
      pending?.abort();
      activeLife?.abort();
      signalLife.abort();
      resize.disconnect();
      stage?.dispose();
      renderer?.dispose();
      for (const face of fonts) document.fonts.delete(face);
      fonts.clear();
      compiled = undefined;
      preparationStats = undefined;
      renderer = undefined;
      stage = undefined;
      root = undefined;
      options = {};
      host.replaceChildren();
      host.removeAttribute('aria-busy');
    },
  };
}
