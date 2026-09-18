import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adapterVersion } from '../packages/authoring/dist/bundle-schema.js';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/playground');
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'player'), { recursive: true });
await cp(resolve(root, 'apps/playground/index.html'), resolve(output, 'index.html'));
await cp(resolve(root, 'apps/player/index.html'), resolve(output, 'player/index.html'));
const runtime = `artifacts/runtime/${adapterVersion}`;
await mkdir(resolve(output, runtime, '..'), { recursive: true });
await cp(resolve(root, runtime), resolve(output, runtime), { recursive: true });
for (const name of ['playground', 'all-api', 'basic-editing', 'structural-editing', 'targets']) {
  await mkdir(resolve(output, 'artifacts', name), { recursive: true });
  const files =
    name === 'playground' ? ['tutorial.zh-CN.json', 'tutorial.en.json'] : ['tutorial.json'];
  for (const file of files)
    await cp(resolve(root, 'artifacts', name, file), resolve(output, 'artifacts', name, file));
}
await mkdir(resolve(output, 'artifacts/media'), { recursive: true });
await cp(resolve(root, 'artifacts/media/stage.mp4'), resolve(output, 'artifacts/media/stage.mp4'));
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Static playground: ${output}`);
