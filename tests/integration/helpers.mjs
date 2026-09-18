import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { mkdir } from 'node:fs/promises';
export async function rendererHarness(scene) {
  const host = await openBrowser();
  await host.page.goto(host.runtimeUrl + 'player.html');
  await host.page.evaluate(async (scene) => {
    const { createShell, createSceneRenderer, loadNativeShell } = await import(
      './modules/renderer-browser/dom.js'
    );
    const container = document.getElementById('player');
    container.replaceChildren();
    window.shell = createShell(
      container,
      scene.manifest.fontFamily ?? 'system-ui, sans-serif',
      scene.manifest.locale,
      await loadNativeShell(
        new URL('./', location.href).href,
        scene.manifest.locale,
        scene.manifest.colorTheme ?? 'light',
      ),
    );
    window.renderer = createSceneRenderer(window.shell, scene);
    window.draw = (time, view = { x: 0, y: 0, zoom: 1 }, options = {}) =>
      window.renderer.draw(time, view, options);
    window.draw(0);
  }, scene);
  return {
    ...host,
    async draw(time, view, options) {
      await host.page.evaluate(({ time, view, options }) => window.draw(time, view, options), {
        time,
        view,
        options,
      });
    },
    async screenshot(name) {
      await mkdir('artifacts/browser-tests', { recursive: true });
      return host.page
        .locator('.motion-scene')
        .screenshot({ path: `artifacts/browser-tests/${name}.png` });
    },
  };
}
