import { mkdir, writeFile } from 'node:fs/promises';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import tutorial from '../examples/basic-editing/tutorial.ts';
await mkdir('artifacts/p1b', { recursive: true });
await writeFile('artifacts/p1b/tutorial.json', JSON.stringify(await bundleTutorial(tutorial)));
