import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { frameCount, type TutorialBundle } from '@blockdia-motion/core';
import { parseBundle } from '@blockdia-motion/authoring/bundle-schema';
import { openBrowser } from '@blockdia-motion/asset-builder';
import type { RenderOptions } from '@blockdia-motion/renderer-browser';
export async function exportVideo(
  input: TutorialBundle,
  options: {
    output: string;
    font: string;
    fps?: number;
    resourceBaseUrl?: string;
    root?: string;
  } & RenderOptions,
) {
  const bundle = parseBundle(input);
  if (!options.font) throw Error('Video export requires an explicit font file');
  const fontSha256 = createHash('sha256')
    .update(await readFile(options.font))
    .digest('hex');
  const fps = options.fps ?? 30;
  frameCount(1, fps);
  const start = performance.now();
  const host = await openBrowser(options);
  const temporary = `${options.output}.${randomUUID()}.tmp.mp4`;
  let encoder: ReturnType<typeof spawn> | undefined;
  try {
    await host.page.goto(host.runtimeUrl + 'player.html');
    await host.page.evaluate(
      async ({ bundle, fontUrl, runtimeUrl, base, cursorMotion, cursorClickEffect }) => {
        (window as any).player = await (window as any).mountTutorial(bundle, {
          font: { family: 'Motion Export', url: fontUrl },
          runtimeUrl,
          resourceBaseUrl: base,
          cursorMotion,
          cursorClickEffect,
        });
      },
      {
        bundle,
        fontUrl: host.server.url + '/font.ttf',
        runtimeUrl: host.runtimeUrl,
        base: new URL(options.resourceBaseUrl ?? '/', host.server.url).href,
        cursorMotion: options.cursorMotion ?? 'linear',
        cursorClickEffect: options.cursorClickEffect ?? 'circle',
      },
    );
    const duration = (await host.page.evaluate(() => (window as any).player.duration)) as number,
      frames = frameCount(duration, fps);
    const preparationMs = performance.now() - start;
    encoder = spawn(
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
    encoder.stderr!.on('data', (data) => (stderr = (stderr + String(data)).slice(-6000)));
    const done = new Promise<void>((resolve, reject) => {
      encoder!.on('error', reject);
      encoder!.on('close', (code) =>
        code === 0 ? resolve() : reject(Error(stderr || `FFmpeg exited ${code}`)),
      );
    });
    void done.catch(() => {});
    encoder.stdin!.on('error', () => {});
    let compositionMs = 0,
      nodePeakRssBytes = process.memoryUsage().rss;
    for (let i = 0; i < frames; i++) {
      const before = performance.now();
      await host.page.evaluate((t) => (window as any).player.renderAt(t), i / fps);
      const png = await host.page
        .locator('.motion-scene')
        .screenshot({ type: 'png', animations: 'disabled' });
      compositionMs += performance.now() - before;
      if (!encoder.stdin!.write(png))
        await Promise.race([
          once(encoder.stdin!, 'drain'),
          done.then(() => {
            throw Error('Encoder exited early');
          }),
        ]);
      nodePeakRssBytes = Math.max(nodePeakRssBytes, process.memoryUsage().rss);
    }
    encoder.stdin!.end();
    await done;
    await rename(temporary, options.output);
    return {
      fps,
      frames,
      tutorialDuration: duration,
      encodedDuration: frames / fps,
      width: 1280,
      height: 720,
      preparationMs,
      compositionMs,
      exportMs: performance.now() - start,
      nodePeakRssBytes,
      source: {
        browser: host.browser.version(),
        fontSha256,
        adapterVersion: bundle.adapterVersion,
        locale: bundle.tutorial.defaults.locale,
        theme: bundle.tutorial.defaults.theme,
      },
    };
  } catch (error) {
    encoder?.kill();
    await rm(temporary, { force: true });
    throw error;
  } finally {
    await host.close();
  }
}
