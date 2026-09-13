import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';
test('relocated static runtime loads without checkout, Node endpoints or full GUI scripts', async () => {
  const prefix = '/artifacts/static-deployment/';
  await mkdir('.' + prefix, { recursive: true });
  await cp('artifacts/runtime/turbowarp-7c58de66-a2946eeb-client-1', '.' + prefix + 'runtime', {
    recursive: true,
  });
  await cp('artifacts/media/stage.mp4', '.' + prefix + 'stage.mp4');
  const b = await bundleTutorial({
    ...tutorial,
    steps: [{ op: 'wait', duration: 1 }],
    stage: { clips: [{ src: 'stage.mp4', start: 0, in: 0, duration: 1 }] },
  });
  await writeFile('.' + prefix + 'tutorial.json', JSON.stringify(b));
  const h = await openBrowser();
  try {
    const unexpected = [];
    await h.page.route('**/*', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith(prefix)) {
        unexpected.push(path);
        return route.abort();
      }
      return route.continue();
    });
    await h.page.goto(h.server.url + prefix + 'runtime/player.html');
    await h.page.evaluate(async (prefix) => {
      const b = await (await fetch(prefix + 'tutorial.json')).json();
      await window.mountTutorial(b, {
        resourceBaseUrl: new URL(prefix + 'tutorial.json', location.href).href,
      });
      await window.player.seek(0.5);
    }, prefix);
    assert.deepEqual(unexpected, []);
    assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
    assert.equal(await h.page.locator('video:not([hidden])').count(), 1);
    await h.page.evaluate(() => window.player.dispose());
  } finally {
    await h.close();
  }
});
