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
  type FontOptions,
} from '@blockdia-motion/core';
import { blocksCommit, guiCommit } from '@blockdia-motion/adapter-turbowarp';
import {
  layout as defaultLayout,
  anchors,
  catalogLayout,
} from '@blockdia-motion/adapter-turbowarp/layout';
const hash = async (data: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
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
export async function createSession(options: {
  project: ProjectContext;
  locale?: 'zh-CN' | 'en';
  theme?: 'light' | 'dark';
  font?: FontOptions;
  layout?: Manifest['layout'];
}): Promise<PreparationAdapter & { dispose(): Promise<void> }> {
  const locale = options.locale ?? 'zh-CN',
    colorTheme = options.theme ?? 'light';
  const layout = options.layout ?? defaultLayout;
  const font = options.font ?? { family: 'system-ui, sans-serif' };
  const source = { blocks: blocksCommit, gui: guiCommit, buildFiles: {} };
  const manifest: Manifest = {
    schemaVersion: 1,
    adapter: 'turbowarp',
    source,
    viewport: { width: 1280, height: 720 },
    locale,
    colorTheme,
    fontFamily: font.family,
    theme: '',
    project: structuredClone(options.project),
    targets: {},
    layout,
    slots: anchors.workspace,
    resources: {},
  };
  let disposed = false;
  const page = {
    async evaluate<A = undefined, R = unknown>(fn: (arg: A) => R, arg?: A): Promise<Awaited<R>> {
      return await fn(arg as A);
    },
  };
  await (window as any).startPreparation(options.project, locale, colorTheme, font);
  manifest.appearance = (window as any).editorAppearance;
  let targetId = options.project.targets[0]!.id;
  async function prepareResource(
    def: BlockDefinition,
    step: string,
    editing?: { id: string; name: string; text: string; preeditStart?: number },
    markerId?: string,
    dropdown?: { id: string; name: string },
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
      (
        await hash(
          JSON.stringify(
            canonical({
              protocol: 10,
              targetId,
              source,
              locale: manifest.locale,
              theme: colorTheme,
              definition: def,
              editing,
              markerId,
              dropdown,
            }),
          ),
        )
      ).slice(0, 24);
    if (!manifest.resources[key]) {
      try {
        const result = (await page.evaluate(
          ({ key, def, editing, markerId, dropdown }) =>
            (window as any).prepareBlock(key, def, editing, markerId, dropdown),
          { key, def, editing, markerId, dropdown },
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
    async prepareContextMenu(
      def: BlockDefinition,
      id: string,
      step: string,
    ): Promise<import('@blockdia-motion/core').PreparedMenu> {
      try {
        return await page.evaluate(({ def, id }) => (window as any).prepareContextMenu(def, id), {
          def,
          id,
        });
      } catch (error) {
        return fail('CAPABILITY', step, String(error));
      }
    },
    async deleteBlock(
      def: BlockDefinition,
      id: string,
      step: string,
    ): Promise<{ block: BlockDefinition; position: import('@blockdia-motion/core').Point }[]> {
      try {
        return await page.evaluate(({ def, id }) => (window as any).deleteBlock(def, id), {
          def,
          id,
        });
      } catch (error) {
        return fail('BLOCKLY', step, String(error));
      }
    },
    async prepareMenu(
      def: BlockDefinition,
      target: import('@blockdia-motion/core').FieldTarget,
      step: string,
    ): Promise<import('@blockdia-motion/core').PreparedMenu> {
      try {
        return await page.evaluate(({ def, target }) => (window as any).prepareMenu(def, target), {
          def,
          target,
        });
      } catch (error) {
        return fail('CAPABILITY', step, String(error));
      }
    },
    prepareDropdown: (def, target, step) =>
      prepareResource(def, step, undefined, undefined, target),
    preparePreview: (def, id, step) => prepareResource(def, step, undefined, id),
    prepare: (def: BlockDefinition, step: string) => prepareResource(def, step),
    prepareInput: (
      def: BlockDefinition,
      editing: { id: string; name: string; text: string; preeditStart?: number },
      step: string,
    ) => prepareResource(def, step, editing),
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (!(window as any).disposePreparation())
        fail('LIFECYCLE', 'prepare', 'Workspace disposal failed');
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
      const identity = `${e.category}.${e.definition.opcode}.${(await hash(JSON.stringify(canonical(e.definition)))).slice(0, 16)}`;
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
}
