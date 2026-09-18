import { spawn } from 'node:child_process';
import { readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { frameCount, type TutorialBundle } from '@blockdia-motion/core';
import { parseBundle } from '@blockdia-motion/authoring/bundle-schema';
import { openBrowser } from '@blockdia-motion/asset-builder';
import type { RenderOptions } from '@blockdia-motion/renderer-browser';
import { FrameCache } from './cache.js';
import { monitorMemory } from './memory.js';
import { createCompositor } from './compositor.js';

export interface ExportProgress {
  phase: 'prepared' | 'frames' | 'encoding';
  completed: number;
  frames: number;
}
export interface ExportOptions extends RenderOptions {
  output: string;
  font: string;
  fps?: number;
  backend?: 'composite' | 'screenshot';
  /** Output scales the fixed 1280x720 logical canvas; even 16:9 dimensions, at most 4K. */
  width?: number;
  height?: number;
  /** Maximum frames per ordered batch; screenshot backend uses independent pages. */
  concurrency?: number;
  cacheBytes?: number;
  encoderThreads?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  resourceBaseUrl?: string;
  root?: string;
}
export async function exportVideo(input: TutorialBundle, options: ExportOptions) {
  const bundle = parseBundle(input);
  const backend = options.backend ?? 'composite';
  if (!['composite', 'screenshot'].includes(backend)) throw Error('Unknown video backend');
  const fps = options.fps ?? 30,
    width = options.width ?? 1280,
    height = options.height ?? 720,
    concurrency = options.concurrency ?? 1,
    cacheBytes = options.cacheBytes ?? 32 * 1024 * 1024,
    encoderThreads = options.encoderThreads ?? 2;
  frameCount(1, fps);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width % 2 ||
    height % 2 ||
    width * 9 !== height * 16 ||
    width > 3840
  )
    throw Error('Output requires even 16:9 dimensions, at most 3840x2160');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw Error('Concurrency must be an integer in [1,4]');
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 0 || cacheBytes > 256 * 1024 * 1024)
    throw Error('Cache budget must be an integer in [0,268435456] bytes');
  if (!Number.isInteger(encoderThreads) || encoderThreads < 1 || encoderThreads > 16)
    throw Error('Encoder threads must be an integer in [1,16]');
  if (!options.font) throw Error('Video export requires an explicit font file');
  options.signal?.throwIfAborted();
  const fontSha256 = createHash('sha256')
    .update(await readFile(options.font))
    .digest('hex');
  options.signal?.throwIfAborted();
  const start = performance.now(),
    memory = monitorMemory(),
    cache = new FrameCache(cacheBytes);
  const life = new AbortController();
  let host: Awaited<ReturnType<typeof openBrowser>> | undefined,
    encoder: ReturnType<typeof spawn> | undefined,
    done: Promise<void> | undefined;
  let compositor: Awaited<ReturnType<typeof createCompositor>> | undefined;
  const temporary = `${options.output}.${randomUUID()}.tmp.mp4`;
  const cancel = () =>
    life.abort(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
  life.signal.addEventListener(
    'abort',
    () => {
      encoder?.kill('SIGKILL');
      void host?.close().catch(() => {});
    },
    { once: true },
  );
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  // Remove each listener after its operation: a shared never-settled cancellation Promise
  // would retain one Promise.race reaction per frame for the entire video.
  async function guarded<T>(work: Promise<T>): Promise<T> {
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(life.signal.reason);
      life.signal.addEventListener('abort', abort, { once: true });
      if (life.signal.aborted) abort();
    });
    try {
      return await Promise.race([work, cancelled]);
    } finally {
      life.signal.removeEventListener('abort', abort);
    }
  }
  try {
    host = await openBrowser(options);
    life.signal.throwIfAborted();
    const pages = [host.page];
    for (let i = 1; backend === 'screenshot' && i < concurrency; i++) {
      pages.push(await guarded(host.page.context().newPage()));
    }
    const durations = [];
    // Sequential preparation bounds Blockly/VM peaks; browser HTTP cache is shared by the first page's context.
    for (const page of pages) {
      await guarded(page.setViewportSize({ width, height }));
      await guarded(page.goto(host.runtimeUrl + 'player.html'));
      durations.push(
        await guarded(
          page.evaluate(
            async ({
              bundle,
              fontUrl,
              runtimeUrl,
              base,
              cursorMotion,
              cursorClickEffect,
              width,
            }) => {
              document.getElementById('player')!.style.width = width + 'px';
              (window as any).player = await (window as any).mountTutorial(bundle, {
                font: { family: 'Motion Export', url: fontUrl },
                runtimeUrl,
                resourceBaseUrl: base,
                cursorMotion,
                cursorClickEffect,
              });
              await document.fonts.ready;
              return {
                duration: (window as any).player.duration as number,
                preparation: (window as any).player.preparationStats as {
                  assetPreparationMs: number;
                  resources: number;
                  resourceContentBytes: number;
                },
              };
            },
            {
              bundle,
              fontUrl: host.server.url + '/font.ttf',
              runtimeUrl: host.runtimeUrl,
              base: new URL(options.resourceBaseUrl ?? '/', host.server.url).href,
              cursorMotion: options.cursorMotion ?? 'linear',
              cursorClickEffect: options.cursorClickEffect ?? 'circle',
              width,
            },
          ),
        ),
      );
    }
    const duration = durations[0]!.duration,
      frames = frameCount(duration, fps);
    if (durations.some((d) => d.duration !== duration))
      throw Error('Worker preparation produced inconsistent durations');
    if (backend === 'composite') {
      const scene = await guarded(
        host.page.evaluate(() => (window as any).player.getPreparedScene()),
      );
      compositor = await guarded(
        createCompositor(host.page, scene, {
          width,
          height,
          font: options.font,
          cacheBytes,
          runtimeUrl: host.runtimeUrl,
          hasMedia: Boolean(bundle.tutorial.stage?.clips.length),
          ...(options.cursorMotion ? { cursorMotion: options.cursorMotion } : {}),
          ...(options.cursorClickEffect ? { cursorClickEffect: options.cursorClickEffect } : {}),
        }),
      );
    }
    const preparationMs = performance.now() - start;
    options.onProgress?.({ phase: 'prepared', completed: 0, frames });
    life.signal.throwIfAborted();
    encoder = spawn(
      'ffmpeg',
      [
        '-y',
        '-benchmark',
        '-f',
        backend === 'composite' ? 'rawvideo' : 'image2pipe',
        ...(backend === 'composite'
          ? ['-pixel_format', 'rgba', '-video_size', `${width}x${height}`]
          : ['-vcodec', 'png']),
        '-framerate',
        String(fps),
        '-i',
        'pipe:0',
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        String(encoderThreads),
        '-preset',
        'fast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        temporary,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    encoder.stderr!.on('data', (data) => {
      stderr = (stderr + String(data)).slice(-6000);
    });
    done = new Promise<void>((resolve, reject) => {
      encoder!.once('error', reject);
      encoder!.once('close', (code) =>
        code === 0 ? resolve() : reject(Error(stderr || `FFmpeg exited ${code}`)),
      );
    });
    let inputEnded = false;
    void done.then(
      () => {
        if (!inputEnded) life.abort(Error('Encoder exited early'));
      },
      (error) => life.abort(error),
    );
    encoder.stdin!.on('error', (error) => life.abort(error));
    const pipe = encoder.stdin!;
    let compositionMs = 0,
      compositionWorkerMs = 0,
      pipeAndBackpressureMs = 0,
      peakQueuedFrameBytes = 0,
      peakQueuedFrames = 0,
      screenshots = 0;
    // Video pixels change independently of DOM markup: disable frame reuse whenever media is present.
    const cacheEnabled =
      backend === 'screenshot' && cacheBytes > 0 && !bundle.tutorial.stage?.clips.length;
    for (let i = 0; i < frames; i += concurrency) {
      life.signal.throwIfAborted();
      const before = performance.now();
      const batch = await guarded(
        Promise.all(
          Array.from({ length: Math.min(concurrency, frames - i) }, async (_, offset) => {
            const workerStart = performance.now();
            if (compositor) {
              const pixels = await guarded(compositor.frame((i + offset) / fps));
              compositionWorkerMs += performance.now() - workerStart;
              return pixels;
            }
            const page = pages[offset]!;
            const key = await guarded(
              page.evaluate(
                async ({ time, cacheEnabled }) => {
                  await (window as any).player.renderAt(time);
                  if (!cacheEnabled) return '';
                  const markup = document.querySelector('.motion-scene')!.outerHTML;
                  const digest = await crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(markup),
                  );
                  return Array.from(new Uint8Array(digest), (b) =>
                    b.toString(16).padStart(2, '0'),
                  ).join('');
                },
                { time: (i + offset) / fps, cacheEnabled },
              ),
            );
            let png = key ? cache.get(key) : undefined;
            if (!png) {
              png = await guarded(
                page.locator('.motion-scene').screenshot({ type: 'png', animations: 'disabled' }),
              );
              screenshots++;
              if (key) cache.set(key, png);
            }
            compositionWorkerMs += performance.now() - workerStart;
            return png;
          }),
        ),
      );
      compositionMs += performance.now() - before;
      peakQueuedFrames = Math.max(peakQueuedFrames, batch.length);
      peakQueuedFrameBytes = Math.max(
        peakQueuedFrameBytes,
        batch.reduce((sum, png) => sum + png.length, 0),
      );
      const pipeStart = performance.now();
      for (const png of batch) {
        life.signal.throwIfAborted();
        if (!pipe.write(png)) {
          let drain: () => void = () => {};
          const drained = new Promise<void>((resolve) => {
            drain = resolve;
            pipe.once('drain', drain);
          });
          try {
            await guarded(drained);
          } finally {
            pipe.removeListener('drain', drain);
          }
        }
      }
      pipeAndBackpressureMs += performance.now() - pipeStart;
      options.onProgress?.({
        phase: 'frames',
        completed: Math.min(i + batch.length, frames),
        frames,
      });
    }
    const flushStart = performance.now();
    options.onProgress?.({ phase: 'encoding', completed: frames, frames });
    life.signal.throwIfAborted();
    inputEnded = true;
    pipe.end();
    await guarded(done);
    const encoderFlushMs = performance.now() - flushStart;
    const timing = stderr.match(/bench: utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/);
    life.signal.throwIfAborted();
    await rename(temporary, options.output);
    await memory.stop();
    return {
      fps,
      backend,
      frames,
      tutorialDuration: duration,
      encodedDuration: frames / fps,
      width,
      height,
      concurrency,
      encoderThreads,
      encoding: timing
        ? {
            cpuUserMs: Number(timing[1]) * 1000,
            cpuSystemMs: Number(timing[2]) * 1000,
            wallMs: Number(timing[3]) * 1000,
          }
        : null,
      preparation: durations.map((d) => d.preparation),
      preparationMs,
      compositionMs,
      compositionWorkerMs,
      pipeAndBackpressureMs,
      encoderFlushMs,
      exportMs: performance.now() - start,
      nodePeakRssBytes: memory.report.nodePeakRssBytes,
      memory: memory.report,
      queue: { peakFrames: peakQueuedFrames, peakBytes: peakQueuedFrameBytes },
      cache: {
        enabled: backend === 'composite' ? cacheBytes > 0 : cacheEnabled,
        limitBytes: cacheBytes,
        peakBytes: compositor?.cache.peakBytes ?? cache.peakBytes,
        hits: compositor?.cache.hits ?? cache.hits,
        misses: compositor?.cache.misses ?? cache.misses,
        screenshots,
        evictions: compositor?.cache.evictions ?? cache.evictions,
        kind: backend === 'composite' ? 'skia-rgba-layers' : 'png-frames',
      },
      layers: compositor?.stats ?? null,
      fixedLayerBytes: compositor?.fixedLayerBytes ?? 0,
      source: {
        browser: host.browser.version(),
        fontSha256,
        adapterVersion: bundle.adapterVersion,
        locale: bundle.tutorial.defaults.locale,
        theme: bundle.tutorial.defaults.theme,
      },
    };
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    encoder?.kill('SIGKILL');
    await done?.catch(() => {});
    try {
      await host?.close();
    } finally {
      await memory.stop();
      cache.clear();
      compositor?.dispose();
      await rm(temporary, { force: true });
    }
  }
}
