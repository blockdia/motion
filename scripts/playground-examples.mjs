import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/all-api/tutorial.ts';
import basic from '../examples/basic-editing/tutorial.ts';
import structural from '../examples/structural-editing/tutorial.ts';
import './stage-fixture.mjs';

for (const [name, spec] of [
  ['all-api', tutorial],
  ['basic-editing', basic],
  ['structural-editing', structural],
]) {
  await mkdir(`artifacts/${name}`, { recursive: true });
  await writeFile(`artifacts/${name}/tutorial.json`, JSON.stringify(await bundleTutorial(spec)));
}
await mkdir('artifacts/playground', { recursive: true });
for (const locale of ['zh-CN', 'en']) {
  const bundle = await bundleTutorial({
    ...tutorial,
    defaults: { locale, theme: 'light' },
    stage: { clips: [{ src: '../media/stage.mp4', start: 0, in: 0, duration: 3 }] },
  });
  await writeFile(`artifacts/playground/tutorial.${locale}.json`, JSON.stringify(bundle));
}
execFileSync(process.execPath, ['scripts/target-example.mjs'], { stdio: 'inherit' });
