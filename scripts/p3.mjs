import { mkdir, writeFile } from 'node:fs/promises';
import { compile } from '../packages/authoring/dist/index.js';
import { createAdapter } from '../packages/asset-builder/dist/index.js';
import tutorial from '../examples/all-api/tutorial.ts';

await mkdir('artifacts/p3', { recursive: true });
for (const locale of ['zh-CN', 'en']) {
  const adapter = await createAdapter({ project: tutorial.project, locale });
  try {
    const scene = await compile({ ...tutorial, defaults: { locale, theme: 'light' } }, adapter);
    await writeFile(`artifacts/p3/scene.${locale}.json`, JSON.stringify(scene));
    console.log(
      `${locale}: ${scene.duration}s, ${Object.keys(scene.manifest.resources).length} assets`,
    );
  } finally {
    await adapter.dispose();
  }
}
