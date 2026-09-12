import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  fail,
  descendants,
  type BlockDefinition,
  type Manifest,
  type PreparationAdapter,
  type Resource,
  type ProjectContext,
  type TargetCatalog,
  type ToolboxEntry,
} from '@blockdia-motion/core';
import { blocksCommit, guiCommit } from '@blockdia-motion/adapter-turbowarp';
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
export async function createAdapter(options: {
  root?: string;
  project: ProjectContext;
}): Promise<PreparationAdapter & { dispose(): Promise<void> }> {
  const root = resolve(options.root ?? process.cwd());
  const { serve, font } = await import(pathToFileURL(root + '/scripts/server.mjs').href);
  const { layout, anchors, catalogLayout } = await import(
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
  const catalogBuild = JSON.parse(await readFile(root + '/.cache/catalog/build.json', 'utf8'));
  if (
    catalogBuild.gui !== guiCommit ||
    hash(await readFile(root + '/.cache/catalog/editor.js')) !== catalogBuild.bundleSha256
  )
    fail('SOURCE', 'prepare', 'Catalog bridge mismatch; run p1c:bootstrap');
  for (const [file, expected] of Object.entries(catalogBuild.inputs))
    if (hash(await readFile(root + '/' + file)) !== expected)
      fail('SOURCE', 'prepare', `Catalog input changed: ${file}; run p1c:bootstrap`);
  const source = {
    blocks: blocksCommit,
    gui: guiCommit,
    fontSha256: hash(await readFile(font)),
    buildFiles: build.files,
    catalog: {
      bundleSha256: catalogBuild.bundleSha256,
      lockSha256: catalogBuild.lockSha256,
      contextSha256: hash(JSON.stringify(canonical(options.project))),
      preparationSha256: hash(
        (
          await Promise.all(
            [
              'packages/asset-builder/prepare.js',
              'adapters/turbowarp/layout.mjs',
              'adapters/turbowarp/chrome.mjs',
            ].map((p) => readFile(root + '/' + p, 'utf8')),
          )
        ).join('\n'),
      ),
      randomSeed: 0x4d6f7469,
      browser: '',
      protocol: 3,
    },
  };
  const manifest: Manifest = {
    schemaVersion: 1,
    adapter: 'turbowarp',
    source,
    viewport: { width: 1280, height: 720 },
    locale: 'zh-CN',
    theme: '',
    chrome: chrome({
      targetPanel: true,
      toolboxHeadings: false,
      toolboxScrollbar: false,
      availableCategories: [],
    }),
    project: structuredClone(options.project),
    targets: {},
    layout,
    slots: anchors.workspace,
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
    source.catalog.browser = browser.version();
    const page = await browser.newPage();
    await page.goto(server.url + '/packages/asset-builder/prepare.html');
    await page.evaluate((project) => (window as any).startPreparation(project), options.project);
    let targetId = options.project.targets[0]!.id;
    async function prepareResource(
      def: BlockDefinition,
      step: string,
      editing?: { id: string; name: string; text: string },
    ): Promise<string> {
      if (disposed) fail('LIFECYCLE', step, 'Preparation session disposed');
      if (descendants(def).some((b) => b.mutation))
        fail(
          'CAPABILITY',
          step,
          'Mutation-bearing blocks are rendered in catalogs; workspace mutation operations are not supported',
        );
      const key =
        'r' +
        hash(
          JSON.stringify(
            canonical({
              protocol: 3,
              targetId,
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
          const message = error instanceof Error ? error.message : String(error);
          fail(message.includes('CAPABILITY:') ? 'CAPABILITY' : 'BLOCKLY', step, message);
        }
      }
      return key;
    }
    const adapter = {
      manifest,
      async selectTarget(id: string) {
        if (!options.project.targets.some((t) => t.id === id))
          fail('TARGET', 'prepare', `Unknown target ${id}`);
        if (disposed) fail('LIFECYCLE', 'prepare', 'Preparation session disposed');
        targetId = id;
        await page.evaluate((id) => (window as any).selectPreparationTarget(id), id);
      },
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
    for (const target of options.project.targets) {
      const extracted = (await page.evaluate(
        (id) => (window as any).extractCatalog(id),
        target.id,
      )) as {
        categories: TargetCatalog['categories'];
        decorations: TargetCatalog['decorations'];
        contentHeight: number;
        xml: string;
        theme: string;
        entries: {
          category: string;
          definition: BlockDefinition;
          metadata: NonNullable<ToolboxEntry['metadata']>;
          resource: Resource;
          position: { x: number; y: number };
        }[];
      };
      const catalog: TargetCatalog = {
        categories: extracted.categories.map((c, i) => ({
          ...c,
          y: layout.categories.y + catalogLayout.categoryOffset + i * catalogLayout.categoryStep,
        })),
        toolbox: [],
        decorations: extracted.decorations.map((d) => ({
          ...d,
          position: { x: layout.toolbox.x + d.position.x, y: layout.toolbox.y + d.position.y },
        })),
        contentHeight: extracted.contentHeight,
        xml: extracted.xml,
      };
      const occurrences = new Map<string, number>();
      for (const [i, e] of extracted.entries.entries()) {
        const identity = `${e.category}.${e.definition.opcode}.${hash(JSON.stringify(canonical(e.definition))).slice(0, 16)}`;
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        const key = occurrence === 1 ? identity : `${identity}.${occurrence}`;
        const asset = `catalog-${target.id}-${i}`;
        manifest.resources[asset] = e.resource;
        const mutation = descendants(e.definition).some((b) => b.mutation);
        const declared = new Set(
          options.project.targets
            .filter((t) => t.isStage || t.id === target.id)
            .flatMap((t) => t.variables.map((v) => v.id)),
        );
        const implicitVariable = Object.values(e.metadata).some((b) =>
          Object.values(b.fields).some((f) => f.kind === 'variable' && !declared.has(f.value)),
        );
        const reason = mutation
          ? 'Mutation-bearing toolbox blocks are discoverable and rendered; mutation editing/drag is not supported yet'
          : implicitVariable
            ? 'Editor-generated variable default requires an explicit project declaration before dragging'
            : undefined;
        catalog.toolbox.push({
          key,
          category: e.category,
          definition: e.definition,
          metadata: e.metadata,
          asset,
          capability: { prepare: true, drag: !reason, ...(reason ? { reason } : {}) },
          position: { x: layout.toolbox.x + e.position.x, y: layout.toolbox.y + e.position.y },
        });
      }
      manifest.targets[target.id] = catalog;
      manifest.theme = extracted.theme;
    }
    await adapter.selectTarget(options.project.targets[0]!.id);
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
