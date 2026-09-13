export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Ease = 'linear' | 'easeInOut';
/** Stable JSON representation for context equality and content-addressed resources. */
export function canonicalJson(value: unknown): string {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
      );
    return value;
  }
  return JSON.stringify(sorted(value));
}
export interface ProjectContext {
  targets: ProjectTarget[];
}
export interface ProjectTarget {
  id: string;
  name: string;
  isStage: boolean;
  x: number;
  y: number;
  size: number;
  direction: number;
  visible: boolean;
  costumes: string[];
  sounds: string[];
  variables: { id: string; name: string; type: '' | 'list' | 'broadcast_msg' }[];
  procedures: {
    code: string;
    argumentIds: string[];
    argumentNames: string[];
    argumentDefaults: string[];
    warp: boolean;
  }[];
}
/** An explicit empty project; callers may replace every part before preparing. */
export function defaultProject(): ProjectContext {
  return {
    targets: [
      {
        id: 'stage',
        name: '舞台',
        isStage: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        visible: true,
        costumes: ['背景1'],
        sounds: [],
        variables: [],
        procedures: [],
      },
      {
        id: 'sprite',
        name: '角色1',
        isStage: false,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        visible: true,
        costumes: ['造型1'],
        sounds: [],
        variables: [],
        procedures: [],
      },
    ],
  };
}
export interface BlockDefinition {
  id: string;
  opcode: string;
  fields?: Record<string, string>;
  inputs?: Record<string, { shadow?: BlockDefinition; block?: BlockDefinition }>;
  mutation?: string;
  next?: BlockDefinition;
}
export type Destination =
  | { kind: 'workspaceSlot'; name: string }
  | { kind: 'connection'; id: string; name: string };
export type FieldTarget = { kind: 'field'; id: string; name: string };
export type Step = StepOperation & { mode?: 'direct' };
type StepOperation =
  | { op: 'sequence'; steps: Step[] }
  | { op: 'parallel'; steps: Step[] }
  | { op: 'wait'; duration: number }
  | {
      op: 'dragFromToolbox';
      entry: string;
      id: string;
      to: Destination;
      duration?: number;
      easing?: Ease;
    }
  | {
      op: 'create' | 'paste';
      blocks: BlockDefinition[];
      to: Destination;
      duration?: number;
      easing?: Ease;
    }
  | {
      op: 'move' | 'connect';
      id: string;
      to: Destination;
      duration?: number;
      easing?: Ease;
    }
  | {
      op: 'type';
      target: FieldTarget;
      value: string;
      duration?: number;
      easing?: Ease;
    }
  | { op: 'split'; id: string; to: Destination; duration?: number; easing?: Ease }
  | { op: 'delete'; id: string; via?: 'toolbox' | 'contextMenu'; duration?: number }
  | { op: 'contextMenu'; id: string; duration?: number }
  | { op: 'highlight'; id: string; duration?: number }
  | { op: 'annotate'; id: string; text: string; duration?: number }
  | { op: 'setField' | 'choose'; target: FieldTarget; value: string; duration?: number }
  | { op: 'selectTarget'; targetId: string }
  | { op: 'selectCategory'; category: string; duration?: number }
  | { op: 'reveal'; entry: string; duration?: number };
export interface TutorialSpec {
  schemaVersion: 1;
  adapter: 'turbowarp';
  project: ProjectContext;
  initialTarget: string;
  viewport: { width: 1280; height: 720 };
  defaults: { theme: 'light'; locale: 'zh-CN' };
  steps: Step[];
}
export interface Anchor extends Point {
  bounds?: Rect;
  opcode: string;
  fields: Record<string, Rect & { value: string }>;
  connections: Record<string, Point>;
}
export interface PreparedInput {
  /** Measured width before the composing text, in resource units. */
  preeditOffset?: number;
  bounds: Rect;
  text: string;
  radius: number;
  borderWidth: number;
  fontSize: number;
  fontWeight: string;
  baseline: number;
  textWidth: number;
  padding: number;
  fill: string;
  stroke: string;
  textColor: string;
  shadowColor: string;
  shadowWidth: number;
}
/** Shared input alignment and scroll geometry for text, caret and IME. */
export function inputTextLayout(a: PreparedInput) {
  const b = a.bounds;
  const innerWidth = Math.max(0, b.width - 2 * a.padding);
  const textX =
    a.textWidth <= innerWidth
      ? b.x + (b.width - a.textWidth) / 2
      : b.x + b.width - a.padding - a.textWidth;
  const caret = Math.min(b.x + b.width - a.padding, textX + a.textWidth);
  const preeditX = textX + (a.preeditOffset ?? 0);
  return {
    innerWidth,
    textX,
    caret,
    preeditX,
    visiblePreeditX: Math.max(b.x + a.padding, Math.min(caret, preeditX)),
  };
}
export interface PreparedMenu {
  options: [string, string][];
  width: number;
  rowHeight: number;
  fontSize: number;
  fill: string;
  stroke: string;
  context?: boolean;
  enabled?: boolean[];
}
export interface Overlay {
  bounds: Rect;
  text: string;
  ime?: string[];
  imeAnchor?: Point;
  menu?: PreparedMenu & { panel: Rect; checked: number; hovered: number; above: boolean };
}
export interface InputFrame {
  preedit?: boolean;
  candidates?: string[];
  offset: number;
  asset: string;
  selected: boolean;
}
export interface Resource {
  input?: PreparedInput;
  content: string;
  box: Rect;
  anchors: Record<string, Anchor>;
}
export interface ToolboxEntry {
  key: string;
  category: string;
  definition: BlockDefinition;
  capability?: { prepare: boolean; drag: boolean; reason?: string };
  metadata?: Record<
    string,
    {
      fields: Record<
        string,
        { value: string; kind: string; options?: [string, string][]; actions?: string[] }
      >;
      inputs: string[];
      connections: string[];
    }
  >;
  asset: string;
  position: Point;
}
export interface TargetCatalog {
  categories: { key: string; label: string; y: number; scroll?: number; color?: string }[];
  toolbox: ToolboxEntry[];
  decorations: {
    kind: 'label' | 'button' | 'separator' | 'checkbox';
    text: string;
    position: Point;
    width: number;
    height: number;
    callback?: string;
  }[];
  contentHeight: number;
  xml: string;
}
export interface Manifest {
  schemaVersion: 1;
  adapter: string;
  source: {
    catalog?: {
      bundleSha256: string;
      lockSha256: string;
      contextSha256: string;
      preparationSha256: string;
      randomSeed: number;
      browser: string;
      protocol: number;
    };
    blocks: string;
    gui: string;
    fontSha256: string;
    buildFiles: Record<string, string>;
  };
  viewport: { width: number; height: number };
  locale: string;
  theme: string;
  chrome: string;
  layout: {
    workspace: Rect;
    toolbox: Rect;
    editor: Rect;
    categories: Rect;
    spriteList: Rect;
    backdrop: Rect;
    blockScale: number;
    toolboxPadding: number;
    stackGap: number;
  };
  project: ProjectContext;
  targets: Record<string, TargetCatalog>;
  slots: Record<string, Point>;
  resources: Record<string, Resource>;
}
export type VisualNode = Point & {
  targetId: string;
  id: string;
  asset: string;
  opacity: number;
  dragging: boolean;
};
export interface ToolboxState {
  category: string;
  scroll: number;
}
export interface SceneState {
  targetScroll?: number;
  targetId: string;
  nodes: VisualNode[];
  cursor: Point & { pressed: boolean; button?: 'left' | 'right' };
  toolbox: ToolboxState;
}
export interface Event {
  targetScroll?: number;
  time: number;
  step: string;
  targetId?: string;
  remove?: string[];
  nodes?: VisualNode[];
  cursor?: SceneState['cursor'];
  toolbox?: ToolboxState;
}
export type Track = {
  start: number;
  end: number;
  step: string;
  easing: Ease;
} & (
  | {
      kind: 'node';
      id: string;
      from: Point;
      to: Point;
      opacityFrom: number;
      opacityTo: number;
    }
  | { kind: 'cursor'; from: Point; to: Point; pressed: boolean; button?: 'left' | 'right' }
  | { kind: 'scroll'; from: number; to: number }
  | { kind: 'targetScroll'; from: number; to: number }
  | { kind: 'preview'; id: string; asset: string }
  | { kind: 'input'; id: string; frames: InputFrame[] }
  | ({ kind: 'overlay' } & Overlay)
);
export interface CompiledScene {
  schemaVersion: 1;
  duration: number;
  manifest: Manifest;
  initial: SceneState;
  events: Event[];
  tracks: Track[];
  finalTargets: Record<string, BlockDefinition[]>;
}
export interface Snapshot extends SceneState {
  overlays: Overlay[];
  time: number;
  input: {
    origin: Point;
    scale: number;
    appearance: PreparedInput;
    selected: boolean;
    preedit?: boolean;
  } | null;
}
export class MotionError extends Error {
  constructor(
    public code: string,
    public step: string,
    message: string,
  ) {
    super(`${code} at ${step}: ${message}`);
    this.name = 'MotionError';
  }
}
export function fail(code: string, step: string, message: string): never {
  throw new MotionError(code, step, message);
}
export function descendants(block: BlockDefinition): BlockDefinition[] {
  return [
    block,
    ...Object.values(block.inputs ?? {}).flatMap((i) =>
      [i.shadow, i.block].filter((b): b is BlockDefinition => !!b).flatMap(descendants),
    ),
    ...(block.next ? descendants(block.next) : []),
  ];
}
export interface PreparationAdapter {
  manifest: Manifest;
  selectTarget(targetId: string): Promise<void>;
  prepare(block: BlockDefinition, step: string): Promise<string>;
  preparePreview?(block: BlockDefinition, id: string, step: string): Promise<string>;
  prepareContextMenu?(block: BlockDefinition, id: string, step: string): Promise<PreparedMenu>;
  deleteBlock?(
    block: BlockDefinition,
    id: string,
    step: string,
  ): Promise<{ block: BlockDefinition; position: Point }[]>;
  prepareMenu?(block: BlockDefinition, target: FieldTarget, step: string): Promise<PreparedMenu>;
  prepareInput(
    block: BlockDefinition,
    editing: { id: string; name: string; text: string; preeditStart?: number },
    step: string,
  ): Promise<string>;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function evaluate(time: number, scene: CompiledScene): Snapshot {
  if (!Number.isFinite(time) || time < 0)
    fail('TIME', 'evaluate', 'Time must be finite and nonnegative');
  const t = Math.min(time, scene.duration);
  const state: Snapshot = {
    ...structuredClone(scene.initial),
    time: t,
    input: null,
    overlays: [],
  };
  const nodes = new Map(state.nodes.map((n) => [n.id, n]));
  for (const event of scene.events) {
    if (event.time > t) break;
    event.remove?.forEach((id) => nodes.delete(id));
    event.nodes?.forEach((n) => nodes.set(n.id, { ...n }));
    if (event.targetScroll !== undefined) state.targetScroll = event.targetScroll;
    if (event.targetId) state.targetId = event.targetId;
    if (event.cursor) state.cursor = { ...event.cursor };
    if (event.toolbox) state.toolbox = { ...event.toolbox };
  }
  for (const track of scene.tracks) {
    if (t < track.start || t >= track.end) continue;
    const progress = (t - track.start) / (track.end - track.start);
    const p = track.easing === 'easeInOut' ? progress * progress * (3 - 2 * progress) : progress;
    if (track.kind === 'node') {
      const n = nodes.get(track.id);
      if (!n) fail('TARGET', track.step, `Missing animated node ${track.id}`);
      n.x = mix(track.from.x, track.to.x, p);
      n.y = mix(track.from.y, track.to.y, p);
      n.opacity = mix(track.opacityFrom, track.opacityTo, p);
    } else if (track.kind === 'overlay') state.overlays.push(structuredClone(track));
    else if (track.kind === 'cursor')
      state.cursor = {
        x: mix(track.from.x, track.to.x, p),
        y: mix(track.from.y, track.to.y, p),
        pressed: track.pressed,
        ...(track.button ? { button: track.button } : {}),
      };
    else if (track.kind === 'scroll') state.toolbox.scroll = mix(track.from, track.to, p);
    else if (track.kind === 'targetScroll') state.targetScroll = mix(track.from, track.to, p);
    else if (track.kind === 'preview') {
      const node = nodes.get(track.id);
      if (!node) fail('TARGET', track.step, 'Missing preview parent');
      node.asset = track.asset;
    } else {
      const frame = track.frames.filter((frame) => track.start + frame.offset <= t).at(-1);
      const n = nodes.get(track.id);
      if (!n || !frame) fail('TARGET', track.step, 'Missing input frame or node');
      const prepared = scene.manifest.resources[frame.asset];
      if (!prepared?.input) fail('RESOURCE', track.step, `Missing input resource ${frame.asset}`);
      n.asset = frame.asset;
      state.input = {
        origin: { x: n.x, y: n.y },
        scale: scene.manifest.layout.blockScale,
        appearance: structuredClone(prepared.input),
        selected: frame.selected,
        ...(frame.preedit || frame.candidates ? { preedit: true } : {}),
      };
      if (frame.candidates) {
        const bounds = prepared.input.bounds,
          scale = scene.manifest.layout.blockScale;
        state.overlays.push({
          bounds: {
            x: n.x + bounds.x * scale,
            y: n.y + bounds.y * scale,
            width: bounds.width * scale,
            height: bounds.height * scale,
          },
          text: '',
          ime: [...frame.candidates],
          imeAnchor: {
            x: n.x + inputTextLayout(prepared.input).visiblePreeditX * scale,
            y: n.y + (bounds.y + bounds.height) * scale,
          },
        });
      }
    }
  }
  state.nodes = [...nodes.values()].filter((n) => n.targetId === state.targetId);
  for (const node of state.nodes)
    if (!scene.manifest.resources[node.asset])
      fail('RESOURCE', 'evaluate', `Missing resource ${node.asset}`);
  return state;
}
/** Export samples the half-open interval [0, duration); an off-grid duration rounds up. */
export function frameCount(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 120)
    fail('EXPORT', 'frames', 'Positive duration and integer fps in [1,120] required');
  return Math.ceil(Number((duration * fps).toPrecision(14)));
}
export function assertResources(scene: CompiledScene): void {
  if (!scene || scene.schemaVersion !== 1 || scene.manifest?.schemaVersion !== 1)
    fail('SCHEMA', 'scene', 'Unsupported compiled schema');
  const m = scene.manifest;
  if (
    !Number.isFinite(scene.duration) ||
    scene.duration <= 0 ||
    !Array.isArray(scene.events) ||
    !Array.isArray(scene.tracks) ||
    !Array.isArray(scene.initial?.nodes)
  )
    fail('SCHEMA', 'scene', 'Invalid compiled timeline');
  if (
    !m.resources ||
    !m.project ||
    !Array.isArray(m.project.targets) ||
    !m.targets ||
    typeof m.targets !== 'object' ||
    !Object.hasOwn(m.targets, scene.initial?.targetId) ||
    typeof m.theme !== 'string' ||
    typeof m.chrome !== 'string' ||
    typeof m.source?.fontSha256 !== 'string'
  )
    fail('SCHEMA', 'manifest', 'Incomplete manifest');
  const point = (p: Point | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const rect = (r: Rect | undefined) =>
    point(r) &&
    !!r &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width >= 0 &&
    r.height >= 0;
  if (
    !m.viewport ||
    !Number.isFinite(m.viewport.width) ||
    !Number.isFinite(m.viewport.height) ||
    m.viewport.width <= 0 ||
    m.viewport.height <= 0 ||
    !m.layout ||
    !rect(m.layout.workspace) ||
    !rect(m.layout.toolbox) ||
    !rect(m.layout.editor) ||
    !rect(m.layout.spriteList) ||
    !rect(m.layout.backdrop) ||
    !(m.layout.blockScale > 0) ||
    !Number.isFinite(m.layout.blockScale) ||
    !Number.isFinite(m.layout.toolboxPadding) ||
    m.layout.toolboxPadding < 0 ||
    m.layout.toolboxPadding * 2 >= m.layout.toolbox.height ||
    !Number.isFinite(m.layout.stackGap) ||
    m.layout.stackGap < 0
  )
    fail('SCHEMA', 'manifest', 'Invalid layout');
  function resource(key: string) {
    if (!Object.hasOwn(m.resources, key) || !m.resources[key]?.content)
      fail('RESOURCE', 'scene', `Missing resource ${key}`);
  }
  function node(n: VisualNode) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      !point(n) ||
      !Number.isFinite(n.opacity) ||
      n.opacity < 0 ||
      n.opacity > 1
    )
      fail('SCHEMA', 'scene', 'Invalid visual node');
    if (!Object.hasOwn(m.targets, n.targetId))
      fail('TARGET', 'scene', `Unknown node target ${n.targetId}`);
    resource(n.asset);
  }
  if (
    (scene.initial.targetScroll !== undefined &&
      (!Number.isFinite(scene.initial.targetScroll) || scene.initial.targetScroll < 0)) ||
    !point(scene.initial.cursor) ||
    !scene.initial.toolbox ||
    !Number.isFinite(scene.initial.toolbox.scroll)
  )
    fail('SCHEMA', 'scene', 'Invalid initial state');
  scene.initial.nodes.forEach(node);
  let previousTime = 0;
  for (const event of scene.events) {
    if (
      !event ||
      !Number.isFinite(event.time) ||
      event.time < previousTime ||
      event.time > scene.duration
    )
      fail('SCHEMA', 'scene', 'Events must be sorted within duration');
    if (
      event.targetScroll !== undefined &&
      (!Number.isFinite(event.targetScroll) || event.targetScroll < 0)
    )
      fail('SCHEMA', 'scene', 'Invalid target scroll');
    previousTime = event.time;
    if (event.targetId !== undefined && !Object.hasOwn(m.targets, event.targetId))
      fail('TARGET', 'scene', 'Unknown switched target');
    if (event.nodes !== undefined) {
      if (!Array.isArray(event.nodes)) fail('SCHEMA', 'scene', 'Invalid event nodes');
      event.nodes.forEach(node);
    }
    if (
      event.remove !== undefined &&
      (!Array.isArray(event.remove) || event.remove.some((id) => typeof id !== 'string'))
    )
      fail('SCHEMA', 'scene', 'Invalid removed IDs');
    if (event.cursor && !point(event.cursor)) fail('SCHEMA', 'scene', 'Invalid cursor');
    if (event.toolbox && !Number.isFinite(event.toolbox.scroll))
      fail('SCHEMA', 'scene', 'Invalid toolbox scroll');
  }
  for (const track of scene.tracks) {
    if (
      !track ||
      !Number.isFinite(track.start) ||
      !Number.isFinite(track.end) ||
      track.start < 0 ||
      track.end <= track.start ||
      track.end > scene.duration ||
      !['linear', 'easeInOut'].includes(track.easing)
    )
      fail('SCHEMA', 'scene', 'Invalid animation interval or easing');
    if (track.kind === 'node' || track.kind === 'cursor') {
      if (!point(track.from) || !point(track.to))
        fail('SCHEMA', 'scene', 'Invalid animation points');
    } else if (track.kind === 'scroll' || track.kind === 'targetScroll') {
      if (!Number.isFinite(track.from) || !Number.isFinite(track.to))
        fail('SCHEMA', 'scene', 'Invalid scroll animation');
    } else if (track.kind === 'preview') {
      if (!Object.hasOwn(m.resources, track.asset)) fail('RESOURCE', track.step, 'Missing preview');
    } else if (track.kind === 'overlay') {
      if (!rect(track.bounds) || typeof track.text !== 'string')
        fail('SCHEMA', 'scene', 'Invalid overlay');
      if (track.menu) {
        const m = track.menu;
        if (
          !rect(m.panel) ||
          !Array.isArray(m.options) ||
          !m.options.length ||
          m.options.some(
            (o) => !Array.isArray(o) || o.length !== 2 || o.some((v) => typeof v !== 'string'),
          ) ||
          !Number.isFinite(m.rowHeight) ||
          m.rowHeight <= 0 ||
          !Number.isFinite(m.fontSize) ||
          m.fontSize <= 0 ||
          !Number.isInteger(m.checked) ||
          m.checked < -1 ||
          m.checked >= m.options.length ||
          !Number.isInteger(m.hovered) ||
          m.hovered < -1 ||
          m.hovered >= m.options.length ||
          typeof m.fill !== 'string' ||
          typeof m.stroke !== 'string'
        )
          fail('SCHEMA', 'scene', 'Invalid menu');
      }
    } else if (track.kind === 'input') {
      if (!Array.isArray(track.frames) || !track.frames.length || track.frames[0]?.offset !== 0)
        fail('SCHEMA', 'scene', 'Invalid input frames');
      let previous = -1;
      for (const frame of track.frames) {
        if (frame.preedit !== undefined && typeof frame.preedit !== 'boolean')
          fail('SCHEMA', 'scene', 'Invalid preedit flag');
        if (
          frame.candidates !== undefined &&
          (!Array.isArray(frame.candidates) ||
            !frame.candidates.length ||
            frame.candidates.some((v) => typeof v !== 'string' || !v))
        )
          fail('SCHEMA', 'scene', 'Invalid IME candidates');
        resource(frame.asset);
        const input = m.resources[frame.asset]?.input;
        if (
          !Number.isFinite(frame.offset) ||
          frame.offset <= previous ||
          frame.offset >= track.end - track.start ||
          !input ||
          !rect(input.bounds) ||
          typeof input.text !== 'string'
        )
          fail('SCHEMA', 'scene', 'Invalid prepared input frame');
        if (
          input.preeditOffset !== undefined &&
          (!Number.isFinite(input.preeditOffset) ||
            input.preeditOffset < 0 ||
            input.preeditOffset > input.textWidth)
        )
          fail('SCHEMA', 'scene', 'Invalid preedit offset');
        for (const value of [
          input.radius,
          input.borderWidth,
          input.fontSize,
          input.textWidth,
          input.padding,
          input.shadowWidth,
        ])
          if (!Number.isFinite(value) || value < 0)
            fail('SCHEMA', 'scene', 'Invalid input metrics');
        if (!Number.isFinite(input.baseline)) fail('SCHEMA', 'scene', 'Invalid text baseline');
        previous = frame.offset;
      }
    } else fail('SCHEMA', 'scene', 'Unsupported animation kind');
  }
  for (const target of m.project.targets) {
    const catalog = m.targets[target.id];
    if (
      !catalog ||
      !Array.isArray(catalog.toolbox) ||
      !Array.isArray(catalog.categories) ||
      !Array.isArray(catalog.decorations) ||
      !Number.isFinite(catalog.contentHeight) ||
      catalog.contentHeight < 0
    )
      fail('SCHEMA', 'catalog', `Invalid target catalog ${target.id}`);
    const keys = new Set<string>();
    for (const entry of catalog.toolbox) {
      if (keys.has(entry.key)) fail('SCHEMA', 'catalog', 'Duplicate entry identity');
      keys.add(entry.key);
    }
    for (const d of catalog.decorations)
      if (!rect({ ...d.position, width: d.width, height: d.height }))
        fail('SCHEMA', 'catalog', 'Invalid decoration bounds');
  }
  for (const entry of Object.values(m.targets).flatMap((t) => t.toolbox)) {
    if (!point(entry.position)) fail('SCHEMA', 'toolbox', 'Invalid entry position');
    resource(entry.asset);
  }
}

// Shared sprite tile geometry for cursor targeting and browser/video rendering.
export function targetPanelLayout(manifest: Manifest, targetId: string, offset?: number) {
  const list = manifest.layout.spriteList;
  const sprites = manifest.project.targets.filter((t) => !t.isStage);
  const columns = 5,
    gap = 8,
    tileHeight = 64,
    rowHeight = 72;
  const tileWidth = (list.width - gap) / columns - gap;
  const index = sprites.findIndex((t) => t.id === targetId);
  const maxScroll = Math.max(
    0,
    Math.ceil(sprites.length / columns) * rowHeight + gap - (list.height - 64),
  );
  const scroll = Math.min(
    maxScroll,
    Math.max(0, offset ?? Math.floor(index / columns) * rowHeight),
  );
  const tile = (i: number): Rect => ({
    x: list.x + gap + (i % columns) * (tileWidth + gap),
    y: list.y + gap + Math.floor(i / columns) * rowHeight - scroll,
    width: tileWidth,
    height: tileHeight,
  });
  const bounds = index < 0 ? { ...manifest.layout.backdrop, height: 84 } : tile(index);
  return { tile, bounds, scroll, maxScroll, tileHeight, tileWidth };
}
