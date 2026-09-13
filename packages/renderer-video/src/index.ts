import { Resvg } from '@resvg/resvg-js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { assertResources, fail, frameCount, type CompiledScene } from '@blockdia-motion/core';
import { frameSvg, type RenderOptions } from '@blockdia-motion/renderer-browser';
export function rasterFrame(
  scene: CompiledScene,
  time: number,
  font: string,
  options: RenderOptions = {},
): Buffer {
  return new Resvg(frameSvg(time, scene, 'motion', undefined, options), {
    font: {
      fontFiles: [font],
      loadSystemFonts: false,
      defaultFontFamily: 'Motion Sans',
    },
  })
    .render()
    .asPng();
}
export async function exportVideo(
  scene: CompiledScene,
  options: { output: string; font: string; fps?: number } & RenderOptions,
) {
  assertResources(scene);
  if (
    createHash('sha256')
      .update(await readFile(options.font))
      .digest('hex') !== scene.manifest.source.fontSha256
  )
    fail('FONT', 'export', 'Font differs from prepared manifest');
  const fps = options.fps ?? 30,
    frames = frameCount(scene.duration, fps),
    temporary = `${options.output}.${randomUUID()}.tmp.mp4`;
  const encoder = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
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
  encoder.stderr.on('data', (data) => {
    stderr = (stderr + String(data)).slice(-6000);
  });
  const done = new Promise<void>((resolve, reject) => {
    encoder.on('error', reject);
    encoder.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`)),
    );
  });
  done.catch(() => {});
  encoder.stdin.on('error', () => {});
  const start = performance.now();
  let compositionMs = 0,
    peakRssBytes = process.memoryUsage().rss;
  try {
    for (let i = 0; i < frames; i++) {
      const before = performance.now(),
        png = rasterFrame(scene, i / fps, options.font, options);
      compositionMs += performance.now() - before;
      if (!encoder.stdin.write(png))
        await Promise.race([
          once(encoder.stdin, 'drain'),
          done.then(() => {
            throw Error('Encoder exited early');
          }),
        ]);
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    encoder.stdin.end();
    await done;
    await rename(temporary, options.output);
  } catch (error) {
    encoder.kill();
    await done.catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    fps,
    frames,
    tutorialDuration: scene.duration,
    encodedDuration: frames / fps,
    width: scene.manifest.viewport.width,
    height: scene.manifest.viewport.height,
    compositionMs,
    exportMs: performance.now() - start,
    nodePeakRssBytes: peakRssBytes,
    source: scene.manifest.source,
  };
}
