import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  fail,
  type BlockDefinition,
  type Manifest,
  type PreparationAdapter,
  type Resource,
} from '@blockdia-motion/core';
import {
  blocksCommit,
  guiCommit,
  catalog,
  categories,
  supported,
  resolveField,
} from '@blockdia-motion/adapter-turbowarp';
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function createAdapter(
  options: { root?: string; entries?: string[]; categories?: string[] } = {},
): Promise<PreparationAdapter & { dispose(): Promise<void> }> {
  const root = resolve(options.root ?? process.cwd());
  const { serve, font } = await import(pathToFileURL(root + '/scripts/server.mjs').href);
  const { layout, anchors } = await import(
    pathToFileURL(root + '/adapters/turbowarp/layout.mjs').href
  );
  const { chrome } = await import(pathToFileURL(root + '/adapters/turbowarp/chrome.mjs').href);
  const build = JSON.parse(await readFile(root + '/.cache/turbowarp/build.json', 'utf8')) as {
    commit: string;
    files: Record<string, string>;
  };
  if (build.commit !== blocksCommit)
    fail('SOURCE', 'prepare', 'Unexpected Blockly source commit; run p0:bootstrap');
  for (const [file, expected] of Object.entries(build.files))
    if (hash(await readFile(root + '/.cache/turbowarp/' + file)) !== expected)
      fail('SOURCE', 'prepare', `Build hash mismatch: ${file}`);
  const source = {
    blocks: blocksCommit,
    gui: guiCommit,
    fontSha256: hash(await readFile(font)),
    buildFiles: build.files,
  };
  const requested = options.entries ?? catalog.map((e) => e.key);
  for (const key of requested)
    if (!catalog.some((e) => e.key === key))
      fail('TOOLBOX_ENTRY', 'prepare', `Unknown entry ${key}`);
  const entries = catalog.filter((e) => requested.includes(e.key));
  const selectedCategories =
    options.categories ?? (options.entries === undefined ? categories.map((c) => c.key) : []);
  for (const key of selectedCategories)
    if (!categories.some((c) => c.key === key))
      fail('CATEGORY', 'prepare', `Unsupported category ${key}`);
  const available = categories.filter(
    (c) => selectedCategories.includes(c.key) || entries.some((e) => e.category === c.key),
  );
  const manifest: Manifest = {
    schemaVersion: 1,
    adapter: 'turbowarp',
    source,
    viewport: { width: 1280, height: 720 },
    locale: 'zh-CN',
    theme: '',
    chrome: chrome({
      toolboxHeadings: false,
      availableCategories: available.map((c) => c.label),
    }),
    layout,
    slots: {
      ...anchors.workspace,
      secondary: { x: 450, y: 365 },
      lower: { x: 440, y: 520 },
    },
    categories: available,
    toolbox: [],
    resources: {},
  };
  const server = await serve();
  let browser: Browser | undefined;
  let disposed = false;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(server.url + '/packages/asset-builder/prepare.html');
    await page.evaluate((rules) => (window as any).startPreparation(rules), supported);
    async function prepareResource(
      def: BlockDefinition,
      step: string,
      editing?: { id: string; name: string; text: string },
    ): Promise<string> {
      if (disposed) fail('LIFECYCLE', step, 'Preparation session disposed');
      const key =
        'r' +
        hash(
          JSON.stringify(
            canonical({
              protocol: 2,
              source,
              locale: manifest.locale,
              definition: def,
              editing,
            }),
          ),
        ).slice(0, 24);
      if (!manifest.resources[key]) {
        try {
          const result = (await page.evaluate(
            ({ key, def, editing }) => (window as any).prepareBlock(key, def, editing),
            { key, def, editing },
          )) as { resource: Resource; theme: string };
          manifest.resources[key] = result.resource;
          manifest.theme = result.theme;
        } catch (error) {
          fail('BLOCKLY', step, error instanceof Error ? error.message : String(error));
        }
      }
      return key;
    }
    const adapter = {
      manifest,
      field: resolveField,
      prepare: (def: BlockDefinition, step: string) => prepareResource(def, step),
      prepareInput: (
        def: BlockDefinition,
        editing: { id: string; name: string; text: string },
        step: string,
      ) => prepareResource(def, step, editing),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          if (!(await page.evaluate(() => (window as any).disposePreparation())))
            fail('LIFECYCLE', 'prepare', 'Blockly workspace not disposed');
        } finally {
          try {
            await browser?.close();
          } finally {
            await server.close();
          }
        }
      },
    } satisfies PreparationAdapter & { dispose(): Promise<void> };
    const rows = new Map<string, number>();
    for (const e of entries) {
      const definition = structuredClone(e.definition) as BlockDefinition;
      const asset = await adapter.prepare(definition, `toolbox:${e.key}`);
      const bounds = manifest.resources[asset]!.box;
      const top = rows.get(e.category) ?? layout.toolbox.y + 44;
      const y = top - bounds.y * layout.blockScale;
      manifest.toolbox.push({
        ...e,
        definition,
        asset,
        position: { x: 69, y },
      });
      rows.set(e.category, top + bounds.height * layout.blockScale + 26);
    }
    return adapter;
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
    throw error;
  }
}
