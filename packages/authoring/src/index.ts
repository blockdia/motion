export * from './spec.js';
import { planTyping } from './typing.js';
import { parseTutorial } from './spec.js';
import {
  descendants,
  targetPanelLayout,
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
type Root = { block: BlockDefinition; node: VisualNode; departure?: { id: string; asset: string } };
type Context = {
  targetScroll: number;
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
    (manifest.colorTheme ?? 'light') !== spec.defaults.theme ||
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
    targetScroll: targetPanelLayout(manifest, spec.initialTarget).scroll,
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
    targetScroll: initial.targetScroll!,
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
    button: 'left' | 'right' = 'left',
  ) {
    c.touched.add('cursor');
    if (duration === 0) {
      c.cursor = { ...to, pressed: false };
      emit(c, start, path, { cursor: c.cursor });
      return;
    }
    c.tracks.push({
      kind: 'cursor',
      start,
      end: start + duration,
      step: path,
      easing,
      from: { ...from },
      to: { ...to },
      pressed,
      button,
    });
    c.cursor = { ...to, pressed: false };
    emit(c, start + duration, path, { cursor: c.cursor });
  }
  function scrollDuration(distance: number) {
    return Math.max(0, (Math.log(1 / Math.max(1, Math.abs(distance))) / Math.log(0.3) - 1) * 0.06);
  }
  async function select(c: Context, category: string, t: number, duration: number, path: string) {
    const cat = catalogFor(c.targetId).categories.find((x) => x.key === category);
    if (!cat) fail('CATEGORY', path, `Unsupported category ${category}`);
    c.touched.add('toolbox');
    if (duration > 0) {
      const at = {
        x: manifest.layout.categories.x + manifest.layout.categories.width / 2,
        y: cat.y,
      };
      cursor(c, c.cursor, at, t, 0.2, path + ':approach', 'easeInOut', false);
      t += 0.2;
      cursor(c, at, at, t, 0.1, path + ':click', 'linear', true);
      t += 0.1;
      emit(c, t, path, { toolbox: { ...c.toolbox, category } });
    }
    const scroll = Math.min(
      cat.scroll ?? 0,
      Math.max(0, catalogFor(c.targetId).contentHeight - manifest.layout.toolbox.height),
    );
    if (duration > 0 && scroll !== c.toolbox.scroll)
      duration = Math.max(duration, scrollDuration(scroll - c.toolbox.scroll));
    if (duration > 0 && scroll !== c.toolbox.scroll)
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
      t = await select(c, e.category, t, duration === 0 ? 0 : 0.25, `${path}:category`);
    let scroll = c.toolbox.scroll;
    if (!visible()) scroll = Math.max(0, top - view.y - inset);
    scroll = Math.min(scroll, Math.max(0, catalogFor(c.targetId).contentHeight - view.height));
    if (scroll !== c.toolbox.scroll) {
      if (duration > 0) duration = Math.max(duration, scrollDuration(scroll - c.toolbox.scroll));
      if (duration > 0)
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
    if (to.name === 'next' ? target.next : target.inputs?.[to.name]?.block)
      fail('CONNECTION', path, `Connection ${to.id}.${to.name} is occupied`);
    const a = asset(parent.node.asset, path).anchors[target.id]?.connections[to.name];
    const b =
      asset(moving.node.asset, path).anchors[moving.block.id]?.connections[
        to.name === 'next' ? 'previous' : 'output'
      ] ?? asset(moving.node.asset, path).anchors[moving.block.id]?.connections.previous;
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
  // Invert the drag curve so previews depend on connection distance, not a fixed time percentage.
  // Pinned constants.js: SNAP_RADIUS=48, CONNECTING_SNAP_RADIUS=68 (workspace units).
  function previewProgress(
    from: Point,
    to: Point,
    radius: number,
    easing: 'linear' | 'easeInOut',
    arrival: boolean,
  ) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const ratio = Math.min(1, (radius * scale) / Math.max(distance, 0.001));
    const position = arrival ? 1 - ratio : ratio;
    if (easing === 'linear') return position;
    let low = 0,
      high = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (mid * mid * (3 - 2 * mid) < position) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
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
      const target = descendants(def).find((b) => b.id === dest.target!.id)!;
      if (to.kind === 'connection' && to.name !== 'next') {
        target.inputs ??= {};
        target.inputs[to.name] = {
          ...target.inputs[to.name],
          block: structuredClone(moving.block),
        };
      } else target.next = structuredClone(moving.block);
      const key = await adapter.prepare(def, path);
      joined = { block: def, node: { ...dest.parent.node, asset: key } };
      const finalAnchor = asset(key, path).anchors[moving.block.id];
      const movingAnchor = asset(moving.node.asset, path).anchors[moving.block.id];
      if (!finalAnchor || !movingAnchor) fail('RESOURCE', path, 'Missing joined block anchor');
      dest.point = {
        x: joined.node.x + (finalAnchor.x - movingAnchor.x) * scale,
        y: joined.node.y + (finalAnchor.y - movingAnchor.y) * scale,
      };
    }
    if (!drag) {
      const placed = joined ?? {
        block: moving.block,
        node: { ...moving.node, ...dest.point, opacity: 1, dragging: false },
      };
      c.roots.delete(moving.block.id);
      c.roots.set(placed.block.id, placed);
      emit(c, t, path, { remove: [moving.block.id], nodes: [placed.node] });
      return t + duration;
    }
    if (joined && duration > 0 && adapter.preparePreview) {
      const preview = await adapter.preparePreview(joined.block, moving.block.id, path);
      c.tracks.push({
        kind: 'preview',
        id: joined.block.id,
        asset: preview,
        start: t + duration * previewProgress(moving.node, dest.point, 48, easing, true),
        end: t + duration,
        step: path,
        easing: 'linear',
      });
    }
    if (moving.departure && duration > 0)
      c.tracks.push({
        kind: 'preview',
        ...moving.departure,
        start: t,
        end: t + duration * previewProgress(moving.node, dest.point, 68, easing, false),
        step: path + ':departure',
        easing: 'linear',
      });
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
  async function approachBlock(c: Context, id: string, t: number, path: string) {
    const { root, block } = locate(c, id, path);
    const a = asset(root.node.asset, path).anchors[id];
    if (!a) fail('CAPABILITY', path, 'Cannot drag hidden shadow');
    const key = await adapter.prepare(block, path);
    const point = { x: root.node.x + a.x * scale, y: root.node.y + a.y * scale };
    cursor(c, c.cursor, grab(key, point, path), t, 0.2, `${path}:approach`, 'easeInOut', false);
    return t + 0.2;
  }
  async function detach(c: Context, id: string, t: number, path: string): Promise<Root> {
    const { root, block } = locate(c, id, path);
    touch(c, root);
    const anchor = asset(root.node.asset, path).anchors[block.id];
    if (!anchor) fail('CAPABILITY', path, 'Cannot edit a hidden shadow');
    const moving: Root = {
      block: structuredClone(block),
      node: {
        ...root.node,
        id: block.id,
        x: root.node.x + anchor.x * scale,
        y: root.node.y + anchor.y * scale,
        asset: await adapter.prepare(block, path),
      },
    };
    if (block !== root.block) {
      const def = structuredClone(root.block);
      let removed = false;
      for (const parent of descendants(def)) {
        if (parent.next?.id === block.id) {
          delete parent.next;
          removed = true;
        }
        for (const input of Object.values(parent.inputs ?? {})) {
          if (input.shadow?.id === block.id) fail('CAPABILITY', path, 'Shadows cannot be detached');
          if (input.block?.id === block.id) {
            delete input.block;
            removed = true;
          }
        }
        for (const [name, input] of Object.entries(parent.inputs ?? {}))
          if (!input.shadow && !input.block) delete parent.inputs![name];
      }
      if (!removed) fail('CONNECTION', path, 'Missing parent connection');
      if (adapter.preparePreview)
        moving.departure = {
          id: root.block.id,
          asset: await adapter.preparePreview(root.block, id, path),
        };
      root.block = def;
      root.node.asset = await adapter.prepare(def, path);
      emit(c, t, path, { nodes: [root.node] });
    } else c.roots.delete(block.id);
    return moving;
  }
  async function contextGesture(
    c: Context,
    id: string,
    t: number,
    duration: number,
    path: string,
    remove: boolean,
  ) {
    const { root, block } = locate(c, id, path);
    touch(c, root);
    if (!adapter.prepareContextMenu)
      fail('CAPABILITY', path, 'Adapter cannot prepare context menus');
    const menu = await adapter.prepareContextMenu(root.block, id, path);
    const a = asset(root.node.asset, path).anchors[id];
    if (!a) fail('TARGET', path, 'Missing block anchor');
    const at = { x: root.node.x + (a.x + 20) * scale, y: root.node.y + (a.y + 16) * scale };
    cursor(c, c.cursor, at, t, 0.2, `${path}:approach`, 'easeInOut', false);
    t += 0.2;
    cursor(c, at, at, t, 0.1, `${path}:right-click`, 'linear', true, 'right');
    t += 0.1;
    const view = manifest.layout.workspace;
    const height = menu.options.length * menu.rowHeight + 8;
    if (height > view.height - 16 || menu.width > view.width - 16)
      fail('CAPABILITY', path, 'Context menu exceeds workspace');
    const panel = {
      x: Math.max(view.x + 8, Math.min(at.x, view.x + view.width - menu.width - 8)),
      y: Math.max(view.y + 8, Math.min(at.y, view.y + view.height - height - 8)),
      width: menu.width,
      height,
    };
    const selected = remove ? menu.options.findIndex((o) => o[1] === 'delete') : -1;
    if (remove && (selected < 0 || menu.enabled?.[selected] === false))
      fail('CAPABILITY', path, 'Block cannot be deleted from its context menu');
    const dest = remove
      ? { x: panel.x + 25, y: panel.y + 4 + (selected + 0.5) * menu.rowHeight }
      : { x: view.x + 10, y: view.y + 10 };
    const overlay = { ...menu, panel, above: false, checked: -1, hovered: -1 };
    c.tracks.push({
      kind: 'overlay',
      bounds: { ...at, width: 0, height: 0 },
      text: '',
      menu: overlay,
      start: t,
      end: t + duration,
      step: path,
      easing: 'linear',
    });
    cursor(c, at, dest, t, duration, `${path}:menu-item`, 'easeInOut', false);
    t += duration;
    c.tracks.push({
      kind: 'overlay',
      bounds: { ...at, width: 0, height: 0 },
      text: '',
      menu: { ...overlay, hovered: selected },
      start: t,
      end: t + 0.1,
      step: path,
      easing: 'linear',
    });
    cursor(c, dest, dest, t, 0.1, `${path}:menu-click`, 'linear', true);
    t += 0.1;
    if (remove) {
      if (!adapter.deleteBlock) fail('CAPABILITY', path, 'Adapter cannot perform context deletion');
      const remaining = await adapter.deleteBlock(root.block, block.id, path);
      const replacements: VisualNode[] = [];
      for (const { block: def, position } of remaining) {
        const node = {
          ...root.node,
          id: def.id,
          x: root.node.x + position.x * scale,
          y: root.node.y + position.y * scale,
          asset: await adapter.prepare(def, path),
        };
        replacements.push(node);
        c.roots.set(def.id, { block: def, node });
      }
      if (!remaining.some((r) => r.block.id === root.block.id)) c.roots.delete(root.block.id);
      emit(c, t, path, { remove: [root.block.id], nodes: replacements });
    }
    return t;
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
      if (c.targetId === s.targetId) return t;
      const panel = targetPanelLayout(manifest, s.targetId);
      if (s.mode !== 'direct') {
        if (panel.scroll !== c.targetScroll) {
          c.tracks.push({
            kind: 'targetScroll',
            from: c.targetScroll,
            to: panel.scroll,
            start: t,
            end: t + 0.2,
            step: path,
            easing: 'easeInOut',
          });
          t += 0.2;
          emit(c, t, path, { targetScroll: panel.scroll });
        }
        const at = {
          x: panel.bounds.x + panel.bounds.width / 2,
          y: panel.bounds.y + panel.bounds.height / 2,
        };
        cursor(c, c.cursor, at, t, 0.25, path, 'easeInOut', false);
        t += 0.25;
        cursor(c, at, at, t, 0.1, path + ':click', 'linear', true);
        t += 0.1;
      }
      c.targetScroll = panel.scroll;
      c.toolboxes.set(c.targetId, { ...c.toolbox });
      c.targetId = s.targetId;
      c.toolbox = { ...c.toolboxes.get(s.targetId)! };
      await adapter.selectTarget(s.targetId);
      emit(c, t, path, { targetId: c.targetId, toolbox: c.toolbox, targetScroll: c.targetScroll });
      return t;
    }
    await adapter.selectTarget(c.targetId);
    const duration =
      s.mode === 'direct'
        ? 0
        : (s.duration ??
          (s.op === 'type' ? 0.8 : s.op === 'selectCategory' || s.op === 'reveal' ? 0.25 : 1));
    const easing = 'easing' in s ? (s.easing ?? 'easeInOut') : 'easeInOut';
    if (s.op === 'selectCategory') return select(c, s.category, t, duration, path);
    if (s.op === 'reveal') return reveal(c, s.entry, t, duration, path);
    if (s.op === 'highlight' || s.op === 'annotate') {
      const { root, block } = locate(c, s.id, path);
      touch(c, root);
      const resource = asset(root.node.asset, path);
      const anchor = resource.anchors[block.id];
      if (!anchor) fail('TARGET', path, 'Missing visible block anchor');
      const fields = Object.values(anchor.fields);
      const width = Math.max(60, ...fields.map((f) => f.x + f.width - anchor.x));
      c.tracks.push({
        kind: 'overlay',
        start: t,
        end: t + duration,
        step: path,
        easing: 'linear',
        bounds: {
          x: root.node.x + (anchor.bounds?.x ?? anchor.x) * scale,
          y: root.node.y + (anchor.bounds?.y ?? anchor.y) * scale,
          width: (anchor.bounds?.width ?? Math.min(resource.box.width, width)) * scale,
          height: (anchor.bounds?.height ?? 32) * scale,
        },
        text: s.op === 'annotate' ? s.text : '',
      });
      return t + duration;
    }
    if (s.op === 'contextMenu' || (s.op === 'delete' && s.via === 'contextMenu'))
      return contextGesture(c, s.id, t, duration, path, s.op === 'delete');
    if (s.op === 'delete' || s.op === 'split') {
      if (s.mode !== 'direct') t = await approachBlock(c, s.id, t, path);
      const moving = await detach(c, s.id, t, path);
      if (s.op === 'delete') {
        if (s.mode === 'direct') {
          emit(c, t, path, { remove: [moving.block.id] });
          return t;
        }
        const from = { x: moving.node.x, y: moving.node.y };
        const sourceGrab = grab(moving.node.asset, from, path),
          view = manifest.layout.toolbox;
        const drop = { x: view.x + view.width / 2, y: view.y + Math.min(120, view.height / 2) };
        const to = { x: from.x + drop.x - sourceGrab.x, y: from.y + drop.y - sourceGrab.y };
        if (moving.departure)
          c.tracks.push({
            kind: 'preview',
            ...moving.departure,
            start: t,
            end: t + duration * previewProgress(from, to, 68, easing, false),
            step: path + ':departure',
            easing: 'linear',
          });
        emit(c, t, path, { nodes: [{ ...moving.node, dragging: true }] });
        c.tracks.push({
          kind: 'node',
          id: moving.block.id,
          start: t,
          end: t + duration,
          step: path,
          easing,
          from,
          to,
          opacityFrom: 1,
          opacityTo: 1,
        });
        cursor(c, sourceGrab, drop, t, duration, path, easing, true);
        emit(c, t + duration, path, { remove: [moving.block.id] });
        return t + duration;
      }
      c.roots.set(moving.block.id, moving);
      return place(c, moving, s.to, t, duration, path, easing, s.mode !== 'direct');
    }
    if (s.op === 'setField' || s.op === 'choose') {
      const { root, block } = locate(c, s.target.id, path);
      touch(c, root);
      if (!Object.hasOwn(block.fields ?? {}, s.target.name)) fail('FIELD', path, 'Unknown field');
      if (!asset(root.node.asset, path).anchors[block.id]?.fields[s.target.name])
        fail('CAPABILITY', path, 'Cannot edit a hidden field');
      if (s.op === 'choose') {
        if (!adapter.prepareMenu) fail('CAPABILITY', path, 'Adapter cannot prepare menus');
        const menu = await adapter.prepareMenu(root.block, s.target, path);
        const index = menu.options.findIndex((o) => o[1] === s.value);
        if (index < 0) fail('FIELD', path, 'Unknown menu option');
        const a = asset(root.node.asset, path).anchors[block.id]!.fields[s.target.name]!;
        const bounds = {
          x: root.node.x + a.x * scale,
          y: root.node.y + a.y * scale,
          width: a.width * scale,
          height: a.height * scale,
        };
        const at = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        cursor(c, c.cursor, at, t, 0.2, `${path}:approach`, 'easeInOut', false);
        t += 0.2;
        cursor(c, at, at, t, 0.1, `${path}:open-click`, 'linear', true);
        t += 0.1;
        const view = manifest.layout.workspace,
          height = menu.options.length * menu.rowHeight + 8;
        if (height > view.height - 16 || menu.width > view.width - 16)
          fail('CAPABILITY', path, 'Menu exceeds workspace');
        const above = bounds.y + bounds.height + height + 10 > view.y + view.height;
        const panel = {
          x: Math.max(
            view.x + 8,
            Math.min(at.x - menu.width / 2, view.x + view.width - menu.width - 8),
          ),
          y: above ? Math.max(view.y + 8, bounds.y - height - 10) : bounds.y + bounds.height + 10,
          width: menu.width,
          height,
        };
        const chosen = { x: panel.x + 40, y: panel.y + 4 + menu.rowHeight * (index + 0.5) };
        const start = t;
        if (adapter.prepareDropdown)
          c.tracks.push({
            kind: 'preview',
            id: root.block.id,
            asset: await adapter.prepareDropdown(root.block, s.target, path),
            start,
            end: start + duration + 0.12,
            step: path + ':dropdown',
            easing: 'linear',
          });
        cursor(c, at, chosen, t, duration, `${path}:option`, 'easeInOut', false);
        t += duration;
        cursor(c, chosen, chosen, t, 0.12, `${path}:select-click`, 'linear', true);
        const overlay = {
          ...menu,
          panel,
          above,
          checked: menu.options.findIndex((o) => o[1] === block.fields![s.target.name]),
          hovered: -1,
        };
        c.tracks.push({
          kind: 'overlay',
          start,
          end: t,
          step: path,
          easing: 'linear',
          bounds,
          text: '',
          menu: overlay,
        });
        c.tracks.push({
          kind: 'overlay',
          start: t,
          end: t + 0.12,
          step: path,
          easing: 'linear',
          bounds,
          text: '',
          menu: { ...overlay, hovered: index },
        });
        t += 0.12;
      }
      const def = structuredClone(root.block);
      descendants(def).find((b) => b.id === block.id)!.fields![s.target.name] = s.value;
      root.node.asset = await adapter.prepare(def, path);
      root.block = def;
      const end = s.op === 'choose' ? t : t + duration;
      emit(c, end, path, { nodes: [root.node] });
      return end;
    }
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
      const planned = await planTyping(s.value);
      const typingDuration = s.duration ?? Math.max(0.5, (planned.length - 1) * 0.07);
      const frames = [];
      for (let i = -1; i < planned.length; i++) {
        const part: (typeof planned)[number] = i < 0 ? { text: a.value } : planned[i]!;
        const asset = await adapter.prepareInput(
          root.block,
          {
            id: field.block.id,
            name: field.name,
            text: part.text,
            ...(part.preeditStart === undefined ? {} : { preeditStart: part.preeditStart }),
          },
          path,
        );
        if (!manifest.resources[asset]?.input)
          fail('RESOURCE', path, `Missing prepared input ${asset}`);
        frames.push({
          offset: i < 0 ? 0 : withdrawDuration + (i * typingDuration) / planned.length,
          asset,
          selected: i < 0,
          ...(part.preedit ? { preedit: true } : {}),
          ...(part.candidates ? { candidates: part.candidates } : {}),
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
      if (planned.some((frame) => frame.candidates)) candidates.unshift(candidates.pop()!);
      const parked = candidates.find(
        (point) => point.x > right || point.x + 24 < left || point.y > bottom || point.y + 28 < top,
      );
      if (!parked) fail('TARGET', path, 'No unobstructed cursor position beside input');
      cursor(c, c.cursor, parked, t, withdrawDuration, `${path}:withdraw`, 'easeInOut', false);
      const end = inputStart + withdrawDuration + typingDuration;
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
      const found = locate(c, s.id, path);
      let root = found.root;
      touch(c, root);
      if (s.mode === 'direct') {
        root = await detach(c, s.id, t, path);
        return place(c, root, s.to, t, 0, path, easing, false);
      }
      t = await approachBlock(c, s.id, t, path);
      root = await detach(c, s.id, t, path);
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
