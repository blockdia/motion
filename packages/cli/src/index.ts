import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTutorial, compile } from '@blockdia-motion/authoring';
import { assertResources, type CompiledScene } from '@blockdia-motion/core';
import { createAdapter } from '@blockdia-motion/asset-builder';
import { exportVideo } from '@blockdia-motion/renderer-video';
async function main() {
  const [command, input, output, ...args] = process.argv.slice(2);
  if (!input || !['compile', 'check', 'catalog', 'export'].includes(command ?? ''))
    throw Error(
      'Usage: motion compile <tutorial.json|tutorial.ts> <scene.json> | check <tutorial.json|tutorial.ts> | catalog <tutorial.json|tutorial.ts> <catalog.json> | export <scene.json> <video.mp4> [fps]',
    );
  if (command === 'export') {
    if (!output || args.length > 1) throw Error('export requires output.mp4 and optional fps');
    const scene = JSON.parse(await readFile(input, 'utf8')) as CompiledScene;
    assertResources(scene);
    await mkdir(dirname(resolve(output)), { recursive: true });
    const { font } = await import(pathToFileURL(resolve('scripts/server.mjs')).href);
    const report = await exportVideo(scene, {
      output: resolve(output),
      font,
      fps: args[0] ? Number(args[0]) : 30,
    });
    await writeFile(output + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (['compile', 'catalog'].includes(command!) && !output)
    throw Error('compile requires output scene.json');
  if (args.length || (command === 'check' && output)) throw Error('Unexpected arguments');
  const raw =
    extname(input) === '.json'
      ? JSON.parse(await readFile(input, 'utf8'))
      : (await import(pathToFileURL(resolve(input)).href)).default;
  const spec = parseTutorial(raw);
  const adapter = await createAdapter({ project: spec.project });
  try {
    if (command === 'catalog') {
      await mkdir(dirname(resolve(output!)), { recursive: true });
      await writeFile(output!, JSON.stringify(adapter.manifest, null, 2));
      console.log(JSON.stringify({ output, targets: Object.keys(adapter.manifest.targets) }));
      return;
    }
    const compiled = await compile(spec, adapter);
    if (output) {
      await mkdir(dirname(resolve(output)), { recursive: true });
      await writeFile(output, JSON.stringify(compiled, null, 2));
    }
    console.log(
      JSON.stringify({
        duration: compiled.duration,
        resources: Object.keys(compiled.manifest.resources).length,
        events: compiled.events.length,
        output: output ?? null,
      }),
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
