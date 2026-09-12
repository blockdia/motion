export * from './spec.js';
import { parseTutorial } from './spec.js';
import {
  descendants,
  canonicalJson,
  fail,
  assertResources,
  type BlockDefinition,
  type CompiledScene,
  type Destination,
  type Event,
  type Point,
  type PreparationAdapter,
  type SceneState,
  type Step,
  type ToolboxEntry,
  type Track,
  type VisualNode,
} from '@blockdia-motion/core';
type Root = { block: BlockDefinition; node: VisualNode };
type Context = {
  roots: Map<string, Root>;
  targetId: string;
  toolboxes: Map<string, SceneState['toolbox']>;
  cursor: SceneState['cursor'];
  toolbox: SceneState['toolbox'];
  events: Event[];
  tracks: Track[];
  touched: Set<string>;
};
export async function compile(input: unknown, adapter: PreparationAdapter): Promise<CompiledScene> {
  const spec = parseTutorial(input),
    manifest = adapter.manifest;
  if (
    manifest.adapter !== spec.adapter ||
    manifest.locale !== spec.defaults.locale ||
    manifest.viewport.width !== spec.viewport.width ||
    manifest.viewport.height !== spec.viewport.height
  )
    fail('ADAPTER', 'tutorial', 'Adapter layout or locale mismatch');
  if (canonicalJson(manifest.project) !== canonicalJson(spec.project))
    fail('CONTEXT', 'tutorial', 'Adapter project context mismatch; prepare this project');
  const catalogFor = (id: string) => {
    const catalog = Object.hasOwn(manifest.targets, id) ? manifest.targets[id] : undefined;
    if (!catalog) fail('TARGET', 'tutorial', `Missing catalog for ${id}`);
    return catalog;
  };
  await adapter.selectTarget(spec.initialTarget);
  const initial: SceneState = {
    targetId: spec.initialTarget,
    nodes: [],
    cursor: {
      x: manifest.layout.workspace.x + manifest.layout.workspace.width / 2,
      y: manifest.layout.workspace.y + manifest.layout.workspace.height / 2,
      pressed: false,
    },
    toolbox: { category: catalogFor(spec.initialTarget).categories[0]?.key ?? '', scroll: 0 },
  };
  const context: Context = {
    roots: new Map(),
    targetId: initial.targetId,
    toolboxes: new Map(
      spec.project.targets.map((t) => [
        t.id,
        { category: catalogFor(t.id).categories[0]?.key ?? '', scroll: 0 },
      ]),
    ),
    cursor: { ...initial.cursor },
    toolbox: { ...initial.toolbox },
    events: [],
    tracks: [],
    touched: new Set(),
  };
  const scale = manifest.layout.blockScale;
  function entry(c: Context, key: string, path: string): ToolboxEntry {
    const found = catalogFor(c.targetId).toolbox.find((e) => e.key === key);
    if (!found) fail('TOOLBOX_ENTRY', path, `Unknown entry ${key}`);
    return found;
  }
  function locate(c: Context, id: string, path: string) {
    for (const root of c.roots.values()) {
      const block = descendants(root.block).find((b) => b.id === id);
      if (block) {
        if (root.node.targetId !== c.targetId)
          fail(
            'TARGET_SCOPE',
            path,
            `Block ${id} belongs to ${root.node.targetId}, current target is ${c.targetId}`,
          );
        return { root, block };
      }
    }
    return fail('TARGET', path, `Block ${id} does not exist at this step`);
  }
  function touch(c: Context, root: Root) {
    descendants(root.block).forEach((b) => c.touched.add(`block:${b.id}`));
  }
  function asset(key: string, path: string) {
    const a = manifest.resources[key];
    if (!a) fail('RESOURCE', path, `Missing resource ${key}`);
    return a;
  }
  function grab(key: string, point: Point, path: string): Point {
    const box = asset(key, path).box;
    return {
      x: point.x + (box.x + Math.min(box.width / 2, 42)) * scale,
      y: point.y + (box.y + Math.min(box.height / 2, 24)) * scale,
    };
  }
  function emit(c: Context, time: number, path: string, patch: Omit<Event, 'time' | 'step'>) {
    c.events.push({ time, step: path, ...structuredClone(patch) });
  }
  function cursor(
    c: Context,
    from: Point,
    to: Point,
    start: number,
    duration: number,
    path: string,
    easing: 'linear' | 'easeInOut',
    pressed: boolean,
  ) {
    c.touched.add('cursor');
    c.tracks.push({
      kind: 'cursor',
      start,
      end: start + duration,
      step: path,
      easing,
      from: { ...from },
      to: { ...to },
      pressed,
    });
    c.cursor = { ...to, pressed: false };
    emit(c, start + duration, path, { cursor: c.cursor });
  }
  async function select(c: Context, category: string, t: number, duration: number, path: string) {
    const cat = catalogFor(c.targetId).categories.find((x) => x.key === category);
    if (!cat) fail('CATEGORY', path, `Unsupported category ${category}`);
    c.touched.add('toolbox');
    cursor(
      c,
      c.cursor,
      {
        x: manifest.layout.categories.x + manifest.layout.categories.width / 2,
        y: cat.y,
      },
      t,
      duration,
      path,
      'easeInOut',
      false,
    );
    const scroll = Math.min(
      cat.scroll ?? 0,
      Math.max(0, catalogFor(c.targetId).contentHeight - manifest.layout.toolbox.height),
    );
    if (scroll !== c.toolbox.scroll)
      c.tracks.push({
        kind: 'scroll',
        start: t,
        end: t + duration,
        step: path,
        easing: 'easeInOut',
        from: c.toolbox.scroll,
        to: scroll,
      });
    c.toolbox = { category, scroll };
    emit(c, t + duration, path, { toolbox: c.toolbox });
    return t + duration;
  }
  async function reveal(c: Context, key: string, t: number, duration: number, path: string) {
    const e = entry(c, key, path);
    c.touched.add('toolbox');
    const box = asset(e.asset, path).box,
      view = manifest.layout.toolbox;
    const top = e.position.y + box.y * scale,
      height = box.height * scale;
    const inset = manifest.layout.toolboxPadding;
    const visibleHeight = Math.min(height, view.height - inset * 2);
    const visible = () =>
      top - c.toolbox.scroll >= view.y + inset &&
      top + visibleHeight - c.toolbox.scroll <= view.y + view.height - inset;
    // A continuous flyout can already expose entries belonging to a neighbouring category.
    if (visible()) return t;
    if (c.toolbox.category !== e.category)
      t = await select(c, e.category, t, 0.25, `${path}:category`);
    let scroll = c.toolbox.scroll;
    if (!visible()) scroll = Math.max(0, top - view.y - inset);
    scroll = Math.min(scroll, Math.max(0, catalogFor(c.targetId).contentHeight - view.height));
    if (scroll !== c.toolbox.scroll) {
      c.tracks.push({
        kind: 'scroll',
        start: t,
        end: t + duration,
        step: path,
        easing: 'easeInOut',
        from: c.toolbox.scroll,
        to: scroll,
      });
      c.toolbox = { ...c.toolbox, scroll };
      t += duration;
      emit(c, t, path, { toolbox: c.toolbox });
    }
    return t;
  }
  function destination(
    c: Context,
    to: Destination,
    moving: Root,
    path: string,
  ): { point: Point; parent?: Root; target?: BlockDefinition } {
    if (to.kind === 'workspaceSlot') {
      const point = Object.hasOwn(manifest.slots, to.name) ? manifest.slots[to.name] : undefined;
      if (!point) fail('TARGET', path, `Unknown workspace slot ${to.name}`);
      c.touched.add(`slot:${to.name}`);
      return { point: { ...point } };
    }
    const { root: parent, block: target } = locate(c, to.id, path);
    touch(c, parent);
    if (parent.block.id === moving.block.id)
      fail('CONNECTION', path, 'Cannot connect a stack to itself');
    if (target.next) fail('CONNECTION', path, `Connection ${to.id}.next is occupied`);
    const a = asset(parent.node.asset, path).anchors[target.id]?.connections.next;
    const b = asset(moving.node.asset, path).anchors[moving.block.id]?.connections.previous;
    if (!a || !b) fail('CONNECTION', path, 'Missing next or previous connection');
    return {
      parent,
      target,
      point: {
        x: parent.node.x + (a.x - b.x) * scale,
        y: parent.node.y + (a.y - b.y) * scale,
      },
    };
  }
  async function place(
    c: Context,
    moving: Root,
    to: Destination,
    t: number,
    duration: number,
    path: string,
    easing: 'linear' | 'easeInOut',
    drag: boolean,
  ) {
    const dest = destination(c, to, moving, path);
    // Prepare the completed connection before producing any timeline data.
    let joined: Root | undefined;
    if (dest.parent && dest.target) {
      const def = structuredClone(dest.parent.block);
      descendants(def).find((b) => b.id === dest.target!.id)!.next = structuredClone(moving.block);
      const key = await adapter.prepare(def, path);
      joined = { block: def, node: { ...dest.parent.node, asset: key } };
    }
    if (!drag) {
      const placed = joined ?? {
        block: moving.block,
        node: { ...moving.node, ...dest.point, opacity: 1, dragging: false },
      };
      c.roots.set(placed.block.id, placed);
      emit(c, t, path, { nodes: [placed.node] });
      return t + duration;
    }
    const from = { x: moving.node.x, y: moving.node.y };
    emit(c, t, path, {
      nodes: [{ ...moving.node, dragging: drag, opacity: 1 }],
    });
    c.tracks.push({
      kind: 'node',
      id: moving.block.id,
      start: t,
      end: t + duration,
      step: path,
      easing,
      from,
      to: dest.point,
      opacityFrom: 1,
      opacityTo: 1,
    });
    if (drag)
      cursor(
        c,
        grab(moving.node.asset, from, path),
        grab(moving.node.asset, dest.point, path),
        t,
        duration,
        path,
        easing,
        true,
      );
    moving.node = {
      ...moving.node,
      ...dest.point,
      dragging: false,
      opacity: 1,
    };
    if (joined) {
      c.roots.delete(moving.block.id);
      c.roots.set(joined.block.id, joined);
      emit(c, t + duration, path, {
        remove: [moving.block.id],
        nodes: [joined.node],
      });
    } else {
      c.roots.set(moving.block.id, moving);
      emit(c, t + duration, path, { nodes: [moving.node] });
    }
    return t + duration;
  }
  function ensureNew(c: Context, def: BlockDefinition, path: string) {
    const existing = new Set(
      [...c.roots.values()].flatMap((r) => descendants(r.block).map((b) => b.id)),
    );
    for (const b of descendants(def)) {
      if (existing.has(b.id))
        fail('DUPLICATE_ID', path, `Duplicate instance ${b.id}; explicitly remap pasted IDs`);
      existing.add(b.id);
      c.touched.add(`block:${b.id}`);
    }
  }
  async function run(s: Step, c: Context, t: number, path: string): Promise<number> {
    if (s.op === 'sequence') {
      for (const [i, child] of s.steps.entries()) t = await run(child, c, t, `${path}.steps[${i}]`);
      return t;
    }
    if (s.op === 'parallel') {
      function switches(step: Step): boolean {
        return (
          step.op === 'selectTarget' ||
          ((step.op === 'parallel' || step.op === 'sequence') && step.steps.some(switches))
        );
      }
      if (s.steps.some(switches))
        fail('PARALLEL_CONFLICT', path, 'Target switching must be sequenced');
      const branches: { context: Context; end: number }[] = [];
      for (const [i, child] of s.steps.entries()) {
        const branch: Context = {
          ...structuredClone(c),
          events: [],
          tracks: [],
          touched: new Set(),
        };
        const end = await run(child, branch, t, `${path}.steps[${i}]`);
        for (const earlier of branches)
          for (const key of branch.touched)
            if (earlier.context.touched.has(key))
              fail(
                'PARALLEL_CONFLICT',
                path,
                `Branches both access ${key}; explicitly sequence them`,
              );
        branches.push({ context: branch, end });
      }
      for (const { context: branch } of branches) {
        for (const [id] of c.roots) if (branch.touched.has(`block:${id}`)) c.roots.delete(id);
        for (const [id, root] of branch.roots)
          if (branch.touched.has(`block:${id}`)) c.roots.set(id, root);
        if (branch.touched.has('cursor')) c.cursor = branch.cursor;
        if (branch.touched.has('toolbox')) c.toolbox = branch.toolbox;
        branch.touched.forEach((key) => c.touched.add(key));
        c.events.push(...branch.events);
        c.tracks.push(...branch.tracks);
      }
      return Math.max(t, ...branches.map((b) => b.end));
    }
    if (s.op === 'wait') return t + s.duration;
    if (s.op === 'selectTarget') {
      catalogFor(s.targetId);
      c.toolboxes.set(c.targetId, { ...c.toolbox });
      c.targetId = s.targetId;
      c.toolbox = { ...c.toolboxes.get(s.targetId)! };
      await adapter.selectTarget(s.targetId);
      emit(c, t, path, { targetId: c.targetId, toolbox: c.toolbox });
      return t;
    }
    await adapter.selectTarget(c.targetId);
    const duration =
      s.duration ??
      (s.op === 'type' ? 0.8 : s.op === 'selectCategory' || s.op === 'reveal' ? 0.25 : 1);
    const easing = 'easing' in s ? (s.easing ?? 'easeInOut') : 'easeInOut';
    if (s.op === 'selectCategory') return select(c, s.category, t, duration, path);
    if (s.op === 'reveal') return reveal(c, s.entry, t, duration, path);
    if (s.op === 'type') {
      const { root, block } = locate(c, s.target.id, path);
      touch(c, root);
      if (!Object.hasOwn(block.fields ?? {}, s.target.name))
        fail('FIELD', path, `Unknown field ${block.id}.${s.target.name}`);
      const field = { block, name: s.target.name };
      const a = asset(root.node.asset, path).anchors[field.block.id]?.fields[field.name];
      if (!a) fail('FIELD', path, `Missing field anchor ${s.target.id}.${s.target.name}`);
      const def = structuredClone(root.block);
      const actual = descendants(def).find((b) => b.id === field.block.id)!;
      actual.fields = { ...actual.fields, [field.name]: s.value };
      const key = await adapter.prepare(def, path);
      const at = {
        x: root.node.x + a.x * scale,
        y: root.node.y + a.y * scale,
        width: a.width * scale,
        height: a.height * scale,
      };
      cursor(
        c,
        c.cursor,
        { x: at.x + at.width / 2, y: at.y + at.height / 2 },
        t,
        0.2,
        `${path}:approach`,
        'easeInOut',
        false,
      );
      t += 0.2;
      const inputStart = t;
      const withdrawDuration = 0.2;
      const characters = [
        ...new Intl.Segmenter(spec.defaults.locale, { granularity: 'grapheme' }).segment(s.value),
      ].map((part) => part.segment);
      const frames = [];
      for (let i = -1; i <= characters.length; i++) {
        const text = i < 0 ? a.value : characters.slice(0, i).join('');
        const asset = await adapter.prepareInput(
          root.block,
          { id: field.block.id, name: field.name, text },
          path,
        );
        if (!manifest.resources[asset]?.input)
          fail('RESOURCE', path, `Missing prepared input ${asset}`);
        frames.push({
          offset: i < 0 ? 0 : withdrawDuration + (i * duration) / (characters.length + 1),
          asset,
          selected: i < 0,
        });
      }
      // Park outside the union of every prepared field shape, including its focus ring.
      const bounds = frames.map((frame) => manifest.resources[frame.asset]!.input!);
      const left =
        root.node.x +
        Math.min(...bounds.map((input) => input.bounds.x - input.shadowWidth)) * scale;
      const top =
        root.node.y +
        Math.min(...bounds.map((input) => input.bounds.y - input.shadowWidth)) * scale;
      const right =
        root.node.x +
        Math.max(
          ...bounds.map((input) => input.bounds.x + input.bounds.width + input.shadowWidth),
        ) *
          scale;
      const bottom =
        root.node.y +
        Math.max(
          ...bounds.map((input) => input.bounds.y + input.bounds.height + input.shadowWidth),
        ) *
          scale;
      const view = manifest.layout.workspace;
      const candidates = [
        { x: right + 18, y: (top + bottom) / 2 },
        { x: (left + right) / 2, y: bottom + 18 },
        { x: left - 42, y: (top + bottom) / 2 },
        { x: (left + right) / 2, y: top - 46 },
      ].map((point) => ({
        x: Math.max(view.x + 4, Math.min(view.x + view.width - 28, point.x)),
        y: Math.max(view.y + 4, Math.min(view.y + view.height - 32, point.y)),
      }));
      const parked = candidates.find(
        (point) => point.x > right || point.x + 24 < left || point.y > bottom || point.y + 28 < top,
      );
      if (!parked) fail('TARGET', path, 'No unobstructed cursor position beside input');
      cursor(c, c.cursor, parked, t, withdrawDuration, `${path}:withdraw`, 'easeInOut', false);
      const end = inputStart + withdrawDuration + duration;
      c.tracks.push({
        kind: 'input',
        id: root.block.id,
        start: inputStart,
        end,
        step: path,
        easing: 'linear',
        frames,
      });
      root.block = def;
      root.node.asset = key;
      emit(c, end, path, { nodes: [root.node] });
      return end;
    }

    if (s.op === 'move' || s.op === 'connect') {
      const { root, block } = locate(c, s.id, path);
      if (block !== root.block)
        fail('UNSUPPORTED', path, 'Moving a connected child requires P2 split');
      touch(c, root);
      cursor(
        c,
        c.cursor,
        grab(root.node.asset, root.node, path),
        t,
        0.2,
        `${path}:approach`,
        'easeInOut',
        false,
      );
      t += 0.2;
      return place(c, root, s.to, t, duration, path, easing, true);
    }
    if (s.op === 'dragFromToolbox') {
      const source = entry(c, s.entry, path),
        def = structuredClone(source.definition);
      if (source.capability && !source.capability.drag)
        fail('CAPABILITY', path, source.capability.reason ?? 'Entry cannot be dragged');
      const original = def.id;
      for (const b of descendants(def))
        b.id = b.id === original ? s.id : `${s.id}${b.id.slice(original.length)}`;
      ensureNew(c, def, path);
      const key = await adapter.prepare(def, path);
      t = await reveal(c, s.entry, t, 0.25, `${path}:reveal`);
      const point = {
        x: source.position.x,
        y: source.position.y - c.toolbox.scroll,
      };
      cursor(c, c.cursor, grab(key, point, path), t, 0.2, `${path}:approach`, 'easeInOut', false);
      t += 0.2;
      const moving: Root = {
        block: def,
        node: {
          targetId: c.targetId,
          id: def.id,
          asset: key,
          ...point,
          opacity: 1,
          dragging: true,
        },
      };
      return place(c, moving, s.to, t, duration, path, easing, true);
    }
    if (s.op === 'create' || s.op === 'paste') {
      if (s.blocks.length > 1 && s.to.kind === 'connection')
        fail('CONNECTION', path, 'Multiple roots require a workspace slot');
      let offset = 0;
      for (const source of s.blocks) {
        const def = structuredClone(source);
        ensureNew(c, def, path);
        const key = await adapter.prepare(def, path);
        const point =
          s.to.kind === 'workspaceSlot'
            ? Object.hasOwn(manifest.slots, s.to.name)
              ? manifest.slots[s.to.name]
              : undefined
            : { x: 0, y: 0 };
        if (!point) fail('TARGET', path, `Unknown slot`);
        const moving: Root = {
          block: def,
          node: {
            targetId: c.targetId,
            id: def.id,
            asset: key,
            x: point.x,
            y: point.y + offset,
            opacity: 1,
            dragging: false,
          },
        };
        // Multiple pasted roots are laid out vertically using measured geometry.
        if (s.to.kind === 'workspaceSlot') {
          c.touched.add(`slot:${s.to.name}`);
          c.roots.set(def.id, moving);
          emit(c, t, path, { nodes: [moving.node] });
        } else await place(c, moving, s.to, t, duration, path, easing, false);
        offset += (asset(key, path).box.height + manifest.layout.stackGap) * scale;
      }
      return t + duration;
    }
    return fail('UNSUPPORTED', path, 'Unknown operation');
  }
  let duration = 0;
  for (const [i, step] of spec.steps.entries())
    duration = await run(step, context, duration, `steps[${i}]`);
  if (!Number.isFinite(duration) || duration <= 0)
    fail('DURATION', 'tutorial', 'Tutorial duration must be finite and positive');
  const result: CompiledScene = {
    schemaVersion: 1,
    duration,
    manifest: structuredClone(manifest),
    initial,
    events: context.events.sort((a, b) => a.time - b.time),
    tracks: context.tracks,
    finalTargets: Object.fromEntries(
      spec.project.targets.map((target) => [
        target.id,
        [...context.roots.values()]
          .filter((r) => r.node.targetId === target.id)
          .map((r) => r.block),
      ]),
    ),
  };
  assertResources(result);
  return result;
}
