import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PreparationAdapter, ProjectContext, FontOptions } from '@blockdia-motion/core';
const runtimeVersion = 'turbowarp-7c58de66-a2946eeb-client-1';
export async function openBrowser(options: { root?: string; font?: string } = {}) {
  const root = resolve(options.root ?? process.cwd());
  const { serve } = await import(pathToFileURL(resolve(root, 'scripts/server.mjs')).href);
  const server = await serve(0, { font: options.font });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${server.url}/artifacts/runtime/${runtimeVersion}/prepare.html`);
    if (!(await page.evaluate(() => typeof (window as any).prepareTutorial === 'function')))
      throw Error('Missing preparation runtime; run runtime:build');
    const instance = browser;
    return {
      server,
      browser,
      page,
      runtimeUrl: `${server.url}/artifacts/runtime/${runtimeVersion}/`,
      async close() {
        try {
          await instance.close();
        } finally {
          await server.close();
        }
      },
    };
  } catch (error) {
    await browser?.close();
    await server.close();
    throw error;
  }
}
export async function createAdapter(options: {
  root?: string;
  project: ProjectContext;
  locale?: 'zh-CN' | 'en';
  theme?: 'light' | 'dark';
  font?: FontOptions;
}): Promise<PreparationAdapter & { dispose(): Promise<void> }> {
  const host = await openBrowser(options.root ? { root: options.root } : {});
  const { page } = host;
  try {
    const manifest = await page.evaluate(
      async (options) => {
        const session = await (window as any).createPreparationSession(options);
        (window as any).adapter = session;
        return session.manifest;
      },
      {
        project: options.project,
        locale: options.locale ?? 'zh-CN',
        theme: options.theme ?? 'light',
        font: options.font ?? { family: 'system-ui, sans-serif' },
      },
    );
    let disposed = false;
    const call = async (name: string, args: unknown[]) => {
      if (disposed) throw Error('LIFECYCLE: Preparation session disposed');
      const data = await page.evaluate(
        async ({ name, args }) => {
          const a = (window as any).adapter;
          const result = await a[name](...args);
          return { result, manifest: a.manifest };
        },
        { name, args },
      );
      Object.assign(manifest, data.manifest);
      return data.result;
    };
    return {
      manifest,
      selectTarget: (id) => call('selectTarget', [id]),
      prepare: (...a) => call('prepare', a),
      prepareInput: (...a) => call('prepareInput', a),
      prepareMenu: (...a) => call('prepareMenu', a),
      prepareContextMenu: (...a) => call('prepareContextMenu', a),
      prepareDropdown: (...a) => call('prepareDropdown', a),
      preparePreview: (...a) => call('preparePreview', a),
      deleteBlock: (...a) => call('deleteBlock', a),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await page.evaluate(() => (window as any).adapter.dispose());
        } finally {
          await host.close();
        }
      },
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}
