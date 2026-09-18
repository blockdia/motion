import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleTutorial, parseBundle } from '@blockdia-motion/authoring/bundle';
import { createAdapter, openBrowser } from '@blockdia-motion/asset-builder';
import { exportVideo, type ExportOptions } from '@blockdia-motion/renderer-video';
async function main() {
  const [command, input, output, ...args] = process.argv.slice(2);
  if (!input || !['compile', 'check', 'catalog', 'export'].includes(command ?? ''))
    throw Error(
      'Usage: motion compile <tutorial.json|tutorial.ts> <tutorial.json> | check <tutorial.json|tutorial.ts> | catalog <tutorial.json|tutorial.ts> <catalog.json> | export <bundle.json> <video.mp4> [fps] --font <font-file> [--size 1920x1080] [--concurrency 1] [--cache-mib 32] [--encoder-threads 2] [--backend composite|screenshot]',
    );
  const raw =
    extname(input) === '.json'
      ? JSON.parse(await readFile(input, 'utf8'))
      : (await import(pathToFileURL(resolve(input)).href)).default;
  const bundle =
    raw.kind === 'blockdia-motion/tutorial' ? parseBundle(raw) : await bundleTutorial(raw);
  if (command === 'check') {
    if (output || args.length) throw Error('check takes one input');
    const host = await openBrowser();
    try {
      await host.page.goto(host.runtimeUrl + 'player.html');
      await host.page.evaluate(
        async ({ bundle, base }) => {
          await (window as any).mountTutorial(bundle, { resourceBaseUrl: base });
        },
        {
          bundle,
          base:
            host.server.url +
            '/' +
            relative(process.cwd(), dirname(resolve(input)))
              .split(sep)
              .join('/') +
            '/',
        },
      );
      console.log('Tutorial prepared and validated');
    } finally {
      await host.close();
    }
    return;
  }
  if (!output) throw Error(command + ' requires output');
  await mkdir(dirname(resolve(output)), { recursive: true });
  if (command === 'export') {
    const config: Partial<ExportOptions> = {};
    if (args[0] && !args[0].startsWith('--')) config.fps = Number(args.shift());
    const seen = new Set<string>();
    while (args.length) {
      const flag = args.shift()!,
        value = args.shift();
      if (!value || value.startsWith('--') || seen.has(flag))
        throw Error('Invalid export arguments');
      seen.add(flag);
      switch (flag) {
        case '--backend':
          if (value !== 'composite' && value !== 'screenshot') throw Error('Unknown backend');
          config.backend = value;
          break;
        case '--font':
          config.font = resolve(value);
          break;
        case '--size': {
          const match = value.match(/^(\d+)x(\d+)$/);
          if (!match) throw Error('--size requires WIDTHxHEIGHT');
          config.width = Number(match[1]);
          config.height = Number(match[2]);
          break;
        }
        case '--concurrency':
          config.concurrency = Number(value);
          break;
        case '--cache-mib':
          config.cacheBytes = Number(value) * 1024 * 1024;
          break;
        case '--encoder-threads':
          config.encoderThreads = Number(value);
          break;
        default:
          throw Error('Unexpected export argument: ' + flag);
      }
    }
    if (!config.font) throw Error('export requires --font <font-file>');
    const base =
      '/' +
      relative(process.cwd(), dirname(resolve(input)))
        .split(sep)
        .join('/') +
      '/';
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException('Export cancelled', 'AbortError'));
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    let report;
    try {
      report = await exportVideo(bundle, {
        ...config,
        output: resolve(output),
        font: config.font,
        resourceBaseUrl: base,
        signal: controller.signal,
      });
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
    await writeFile(output + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (args.length) throw Error('Unexpected arguments');
  if (command === 'compile') {
    // Keep media references relative to the emitted bundle after moving it from the source directory.
    for (const clip of bundle.tutorial.stage?.clips ?? [])
      if (!/^(?:[a-z]+:|\/)/i.test(clip.src))
        clip.src = relative(dirname(resolve(output)), resolve(dirname(resolve(input)), clip.src))
          .split(sep)
          .join('/');
    await writeFile(output, JSON.stringify(bundle));
    console.log(JSON.stringify({ output, bytes: Buffer.byteLength(JSON.stringify(bundle)) }));
    return;
  }
  const adapter = await createAdapter({
    project: bundle.tutorial.project,
    ...bundle.tutorial.defaults,
  });
  try {
    const targets = Object.fromEntries(
      Object.entries(adapter.manifest.targets).map(([id, c]) => [
        id,
        {
          categories: c.categories.map(({ key, label, color }) => ({ key, label, color })),
          toolbox: c.toolbox.map(({ asset: _, position: __, ...e }) => e),
        },
      ]),
    );
    await writeFile(
      output,
      JSON.stringify({ adapterVersion: bundle.adapterVersion, targets }, null, 2),
    );
  } finally {
    await adapter.dispose();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
