import { mkdir, writeFile } from 'node:fs/promises';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/all-api/tutorial.ts';
import './stage-fixture.mjs';
await mkdir('artifacts/p3', { recursive: true });
for (const locale of ['zh-CN', 'en']) {
  const bundle = await bundleTutorial({
    ...tutorial,
    defaults: { locale, theme: 'light' },
    stage: { clips: [{ src: '../media/stage.mp4', start: 0, in: 0, duration: 3 }] },
  });
  await writeFile(`artifacts/p3/tutorial.${locale}.json`, JSON.stringify(bundle));
}
