import { openBrowser } from '../packages/asset-builder/dist/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
const h = await openBrowser();
try {
  h.page.on('pageerror', (error) => console.error(error));
  h.page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(msg.text());
  });
  await h.page.goto(h.server.url + '/');
  await h.page.waitForFunction(() => window.ready === true, {}, { timeout: 60000 });
  const frame = h.page.frames().find((frame) => frame.parentFrame());
  await frame.evaluate(() => window.player.seek(1.5));
  await mkdir('artifacts/browser-tests', { recursive: true });
  await h.page.screenshot({ path: 'artifacts/browser-tests/playground.png', fullPage: true });
  await writeFile(
    'artifacts/browser-tests/smoke.json',
    JSON.stringify(
      await frame.evaluate(() => ({
        iframes: document.querySelectorAll('[data-motion-preparation]').length,
        time: window.player.time,
        duration: window.player.duration,
        stage: document.querySelector('video:not([hidden])')?.currentTime,
      })),
      null,
      2,
    ),
  );
  console.log('Smoke passed');
} finally {
  await h.close();
}
