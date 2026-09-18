import { createHash } from 'node:crypto';
import { renderAsync } from '@resvg/resvg-js';
import { evaluate, targetPanelLayout, type CompiledScene, type Rect } from '@blockdia-motion/core';
import type { openBrowser } from '@blockdia-motion/asset-builder';
import type { RenderOptions } from '@blockdia-motion/renderer-browser';
import { BitmapCache, blit, bitmapFromPng, createBitmap, type Bitmap } from './bitmap.js';
type Page = Awaited<ReturnType<typeof openBrowser>>['page'];
const svg = (width: number, height: number, content: string, viewBox = `0 0 ${width} ${height}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${viewBox}">${content}</svg>`;
export const decodePng = bitmapFromPng;
export async function createCompositor(
  page: Page,
  scene: CompiledScene,
  options: {
    width: number;
    height: number;
    font: string;
    cacheBytes: number;
    runtimeUrl: string;
    hasMedia: boolean;
  } & RenderOptions,
) {
  const { width, height } = options,
    ratio = width / 1280,
    m = scene.manifest;
  const cache = new BitmapCache(options.cacheBytes);
  const pending = new Map<string, Promise<Bitmap>>();
  const stats = {
    uiCaptures: 0,
    svgRasterizations: 0,
    svgRasterizationMs: 0,
    uiCaptureMs: 0,
    blitMs: 0,
    mediaMs: 0,
    mediaFrames: 0,
    frameReadbackMs: 0,
    surfacePoolPeakFrames: 0,
    surfacePoolPeakBytes: 0,
  };
  await page.evaluate(
    async ({ scene, runtimeUrl, ratio, cursorMotion, cursorClickEffect }) => {
      const { createExportCapture } = await import(
        runtimeUrl + 'modules/renderer-browser/export.js'
      );
      document.getElementById('player')!.style.visibility = 'hidden';
      (window as any).capture = await createExportCapture(scene, runtimeUrl, ratio, {
        cursorMotion,
        cursorClickEffect,
      });
    },
    {
      scene,
      runtimeUrl: options.runtimeUrl,
      ratio,
      cursorMotion: options.cursorMotion ?? 'linear',
      cursorClickEffect: options.cursorClickEffect ?? 'circle',
    },
  );
  let disposed = false;
  const surfaces: Bitmap[] = [];
  let surfaceCount = 0;
  let captureQueue: Promise<unknown> = Promise.resolve();
  async function get(key: string, make: () => Promise<Bitmap>): Promise<Bitmap> {
    if (disposed) throw Error('Compositor disposed');
    const hit = cache.get(key);
    if (hit) return hit;
    const active = pending.get(key);
    if (active) return active;
    const task = make()
      .then((value) => {
        if (!disposed) cache.set(key, value);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  async function capture(key: string, time: number, kind: string, index = 0, fixed = false) {
    const make = () => {
      const task = captureQueue
        .catch(() => {})
        .then(async () => {
          const start = performance.now();
          const rect = await page.evaluate(
            ({ time, kind, index }) => (window as any).capture.prepare(time, kind, index) as Rect,
            { time, kind, index },
          );
          const png = await page.screenshot({
            clip: rect,
            omitBackground: true,
            type: 'png',
            animations: 'disabled',
          });
          stats.uiCaptures++;
          const image = await decodePng(png, Math.round(rect.width), Math.round(rect.height));
          stats.uiCaptureMs += performance.now() - start;
          image.rect = rect;
          return image;
        });
      captureQueue = task;
      return task;
    };
    return (fixed ? make() : get('ui:' + key, make)) as Promise<Bitmap & { rect: Rect }>;
  }
  const scaled = (r: Rect): Rect => ({
    x: r.x * ratio,
    y: r.y * ratio,
    width: r.width * ratio,
    height: r.height * ratio,
  });
  const w = scaled(m.layout.workspace),
    b = scaled(m.layout.toolbox),
    scale = m.layout.blockScale * ratio;
  const hashes = new Map<string, string>();
  function identity(asset: string) {
    let key = hashes.get(asset);
    if (!key) {
      const resource = m.resources[asset]!;
      // Semantic block IDs do not affect paint; preserve IDs if a supplied theme selects them.
      const content = m.theme.includes('data-id')
        ? resource.content
        : resource.content.replace(/ data-id="[^"]*"/g, '');
      key = createHash('sha256').update(content).update(JSON.stringify(resource.box)).digest('hex');
      hashes.set(asset, key);
    }
    return key;
  }
  async function resource(asset: string, drag: boolean) {
    const r = m.resources[asset]!,
      pad = drag ? 24 : 2,
      left = Math.floor(r.box.x * scale) - pad,
      top = Math.floor(r.box.y * scale) - pad,
      iw = Math.ceil((r.box.x + r.box.width) * scale) - left + pad,
      ih = Math.ceil((r.box.y + r.box.height) * scale) - top + pad;
    const image = await get(`svg:${identity(asset)}:${drag}`, async () => {
      const start = performance.now();
      const theme = m.theme.replace(/font-family\s*:[^;}]+/g, 'font-family:sans-serif');
      const filter = drag
        ? '<defs><filter id="motion-drag-shadow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .333 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
        : '';
      const content = r.content.replace(/font-family="[^"]*"/g, 'font-family="sans-serif"');
      const source = svg(
        iw,
        ih,
        `<style>${theme}</style>${filter}<g transform="translate(${-left},${-top}) scale(${scale})" ${drag ? 'filter="url(#motion-drag-shadow)"' : ''}>${content}</g>`,
      );
      const result = await renderAsync(source, {
        font: { loadSystemFonts: false, fontFiles: [options.font] },
      });
      const bitmap = await bitmapFromPng(result.asPng(), result.width, result.height);
      stats.svgRasterizations++;
      stats.svgRasterizationMs += performance.now() - start;
      return bitmap;
    });
    return { image, left, top };
  }
  // Small fixed cursor sprites; rotation/press scaling are applied during composition.
  const cursor = await (async () => {
    const result = await renderAsync(
      svg(
        48 * ratio,
        56 * ratio,
        `<g transform="scale(${ratio}) translate(4,4)"><path d="M0 0 L0 23 L6 17 L11 28 L16 25 L11 15 L20 15 Z" fill="#242938" stroke="white" stroke-width="2"/></g>`,
      ),
      { font: { loadSystemFonts: false } },
    );
    return bitmapFromPng(result.asPng(), result.width, result.height);
  })();
  const base = await capture('base', 0, 'base', 0, true),
    flyout = await capture('flyout', 0, 'flyout', 0, true),
    controls = await capture('controls', 0, 'controls', 0, true);
  // Constant canvas layers are pinned once. Their footprint is reported separately from the LRU budget.
  const fixedLayerBytes =
    base.byteLength + flyout.byteLength + controls.byteLength + cursor.byteLength;
  return {
    stats,
    cache,
    fixedLayerBytes,
    async frame(time: number): Promise<Buffer> {
      const snapshot = evaluate(time, scene, options),
        catalog = m.targets[snapshot.targetId]!;
      if (disposed) throw Error('Compositor disposed');
      let surface = surfaces.pop();
      if (!surface) {
        surface = createBitmap(width, height);
        surfaceCount++;
        stats.surfacePoolPeakFrames = surfaceCount;
        stats.surfacePoolPeakBytes = surfaceCount * width * height * 4;
      }
      const canvas = surface.surface;
      try {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        let start = performance.now();
        blit(canvas, width, height, base, 0, 0);
        stats.blitMs += performance.now() - start;
        for (const [kind, key] of [
          ['categories', `categories:${snapshot.targetId}:${snapshot.toolbox.category}`],
          ['properties', `properties:${snapshot.targetId}`],
          ['backdrop', `backdrop:${snapshot.targetId}`],
        ]) {
          const image = await capture(key!, time, kind!);
          const at = performance.now();
          blit(canvas, width, height, image, image.rect.x, image.rect.y);
          stats.blitMs += performance.now() - at;
        }
        const drawResource = async (
          asset: string,
          x: number,
          y: number,
          opacity = 1,
          drag = false,
          clip = w,
        ) => {
          const { image, left, top } = await resource(asset, drag);
          const at = performance.now();
          blit(canvas, width, height, image, x * ratio + left, y * ratio + top, clip, opacity);
          stats.blitMs += performance.now() - at;
        };
        for (const node of snapshot.nodes.filter((n) => !n.dragging))
          await drawResource(node.asset, node.x, node.y, node.opacity);
        start = performance.now();
        const flyoutRect = flyout.rect;
        blit(canvas, width, height, flyout, flyoutRect.x, flyoutRect.y);
        stats.blitMs += performance.now() - start;
        for (const entry of catalog.toolbox) {
          const r = m.resources[entry.asset]!.box,
            y = entry.position.y - snapshot.toolbox.scroll;
          if (
            y + r.y * m.layout.blockScale < m.layout.toolbox.y + m.layout.toolbox.height &&
            y + (r.y + r.height) * m.layout.blockScale > m.layout.toolbox.y
          )
            await drawResource(entry.asset, entry.position.x, y, 1, false, b);
        }
        for (const [i, decoration] of catalog.decorations.entries()) {
          const key = `decoration:${snapshot.targetId}:${i}`,
            image = await capture(key, time, 'decoration', i);
          const source = image.rect,
            at = performance.now();
          // Captured at logical y=toolbox.y; restore the catalog's scrollable position.
          blit(
            canvas,
            width,
            height,
            image,
            source.x,
            source.y +
              (decoration.position.y - m.layout.toolbox.y - snapshot.toolbox.scroll) * ratio,
            b,
          );
          stats.blitMs += performance.now() - at;
        }
        const barKey = `scrollbar:${snapshot.targetId}`,
          scrollbar = await capture(barKey, time, 'scrollbar'),
          bar = scrollbar.rect;
        start = performance.now();
        blit(
          canvas,
          width,
          height,
          scrollbar,
          bar.x,
          bar.y +
            (snapshot.toolbox.scroll / Math.max(catalog.contentHeight, m.layout.toolbox.height)) *
              m.layout.toolbox.height *
              ratio,
          b,
        );
        stats.blitMs += performance.now() - start;
        // Target cards are independent sprites, so scrolling never invalidates the full UI bitmap.
        const panel = targetPanelLayout(m, snapshot.targetId, snapshot.targetScroll);
        const sprites = m.project.targets.filter((t) => !t.isStage);
        for (const [i, target] of sprites.entries()) {
          const key = `card:${target.id}:${target.id === snapshot.targetId}`,
            image = await capture(key, time, 'card', i),
            source = image.rect,
            tile = scaled(panel.tile(i));
          const padX = m.layout.spriteList.x * ratio - source.x,
            padY = m.layout.spriteList.y * ratio - source.y;
          start = performance.now();
          blit(
            canvas,
            width,
            height,
            image,
            tile.x - padX,
            tile.y - padY,
            scaled(m.layout.spriteList),
          );
          stats.blitMs += performance.now() - start;
        }
        if (options.hasMedia) {
          const at = performance.now();
          const task = captureQueue
            .catch(() => {})
            .then(() =>
              page.evaluate(
                (time) =>
                  (window as any).capture.media(time) as Promise<{
                    png: string;
                    rect: Rect;
                  } | null>,
                time,
              ),
            );
          captureQueue = task;
          const media = await task;
          if (media) {
            const image = await decodePng(
              Buffer.from(media.png, 'base64'),
              media.rect.width,
              media.rect.height,
            );
            blit(canvas, width, height, image, media.rect.x, media.rect.y);
            stats.mediaFrames++;
          }
          stats.mediaMs += performance.now() - at;
        }
        for (const node of snapshot.nodes.filter((n) => n.dragging))
          await drawResource(node.asset, node.x, node.y, node.opacity, true);
        if (snapshot.input || snapshot.overlays.length) {
          const key = createHash('sha256')
            .update(JSON.stringify({ input: snapshot.input, overlays: snapshot.overlays }))
            .digest('hex');
          const count =
            (snapshot.input ? 1 : 0) +
            snapshot.overlays.reduce((sum, o) => sum + (o.menu || o.ime ? 1 : o.text ? 2 : 1), 0);
          for (let i = 0; i < count; i++) {
            const overlayKey = `overlay:${key}:${i}`,
              image = await capture(overlayKey, time, 'overlay', i),
              r = image.rect;
            start = performance.now();
            blit(canvas, width, height, image, r.x, r.y, w);
            stats.blitMs += performance.now() - start;
          }
        }
        start = performance.now();
        blit(canvas, width, height, controls, controls.rect.x, controls.rect.y);
        const { x, y, rotation = 0, pressed, button } = snapshot.cursor;
        if (pressed && options.cursorClickEffect !== 'shrink') {
          const click = await get('click:' + button, async () => {
            const result = await renderAsync(
              svg(
                36 * ratio,
                36 * ratio,
                `<circle cx="18" cy="18" r="15" fill="${button === 'right' ? '#4c97ff' : '#ff4c4c'}" opacity=".18" transform="scale(${ratio})"/>`,
              ),
              { font: { loadSystemFonts: false } },
            );
            return bitmapFromPng(result.asPng(), result.width, result.height);
          });
          blit(canvas, width, height, click, x * ratio - 18 * ratio, y * ratio - 18 * ratio);
        }
        blit(
          canvas,
          width,
          height,
          cursor,
          (x - 4) * ratio,
          (y - 4) * ratio,
          undefined,
          1,
          rotation,
          4 * ratio,
          4 * ratio,
          pressed && options.cursorClickEffect === 'shrink' ? 0.75 : 1,
        );
        stats.blitMs += performance.now() - start;
        const readback = performance.now();
        const output = canvas.data(); // Independent premultiplied RGBA; final canvas is opaque.
        stats.frameReadbackMs += performance.now() - readback;
        return output;
      } finally {
        if (!disposed) surfaces.push(surface);
      }
    },
    dispose() {
      disposed = true;
      surfaces.length = 0;
      cache.clear();
      hashes.clear();
    },
  };
}
