import {
  fail,
  type BlockDefinition,
  type Destination,
  type Ease,
  type FieldTarget,
  type Step,
  type TutorialSpec,
} from '@blockdia-motion/core';
type ObjectValue = Record<string, unknown>;
function object(value: unknown, path: string, allowed: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('SCHEMA', path, 'Expected object');
  const o = value as ObjectValue;
  for (const key of Object.keys(o))
    if (!allowed.includes(key)) fail('SCHEMA', path, `Unknown property ${key}`);
  return o;
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.length) fail('SCHEMA', path, 'Expected nonempty string');
}
function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || !value.length) fail('SCHEMA', path, 'Expected nonempty array');
}
function target(value: unknown, path: string, field = false) {
  const o = object(value, path, ['kind', 'id', 'name']);
  string(o.name, path);
  if (field) {
    if (o.kind !== 'field') fail('SCHEMA', path, 'Expected field target');
    string(o.id, path);
  } else if (o.kind === 'connection') {
    string(o.id, path);
    if (o.name !== 'next') fail('UNSUPPORTED', path, 'P1b supports next connections');
  } else if (o.kind !== 'workspaceSlot' || o.id !== undefined)
    fail('SCHEMA', path, 'Expected workspaceSlot or connection');
}
function block(value: unknown, path: string) {
  const o = object(value, path, ['id', 'opcode', 'fields', 'inputs', 'next']);
  string(o.id, path);
  string(o.opcode, path);
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(o.id))
    fail('SCHEMA', path, 'Block IDs must start with a letter and use letters, digits, _, ., :, -');
  if (o.fields !== undefined) {
    if (!o.fields || typeof o.fields !== 'object' || Array.isArray(o.fields))
      fail('SCHEMA', path, 'Expected fields object');
    for (const [k, v] of Object.entries(o.fields))
      if (typeof v !== 'string')
        fail('SCHEMA', `${path}.fields.${k}`, 'Field values must be strings');
  }
  if (o.inputs !== undefined) {
    if (!o.inputs || typeof o.inputs !== 'object' || Array.isArray(o.inputs))
      fail('SCHEMA', path, 'Expected inputs object');
    for (const [k, v] of Object.entries(o.inputs)) {
      const i = object(v, path, ['shadow', 'block']);
      // Replacing a shadow is P2; reject instead of losing one of the definitions.
      if (Object.keys(i).length !== 1)
        fail('UNSUPPORTED', path, 'Each P1b input requires exactly one shadow or block');
      block(i.shadow ?? i.block, `${path}.inputs.${k}`);
    }
  }
  if (o.next !== undefined) block(o.next, `${path}.next`);
}
function step(value: unknown, path: string) {
  if (!value || typeof value !== 'object') fail('SCHEMA', path, 'Expected step');
  const op = (value as ObjectValue).op;
  const keys: Record<string, string[]> = {
    sequence: ['steps'],
    parallel: ['steps'],
    wait: ['duration'],
    dragFromToolbox: ['entry', 'id', 'to', 'duration', 'easing'],
    create: ['blocks', 'to', 'duration', 'easing'],
    paste: ['blocks', 'to', 'duration', 'easing'],
    move: ['id', 'to', 'duration', 'easing'],
    connect: ['id', 'to', 'duration', 'easing'],
    type: ['target', 'value', 'duration', 'easing'],
    selectCategory: ['category', 'duration'],
    reveal: ['entry', 'duration'],
  };
  if (typeof op !== 'string' || !Object.hasOwn(keys, op))
    fail('UNSUPPORTED', path, `Unsupported operation ${String(op)}`);
  const o = object(value, path, ['op', ...keys[op]!]);
  if (
    o.duration !== undefined &&
    (typeof o.duration !== 'number' || !Number.isFinite(o.duration) || o.duration <= 0)
  )
    fail('DURATION', path, 'Duration must be finite and positive');
  if (o.easing !== undefined && o.easing !== 'linear' && o.easing !== 'easeInOut')
    fail('EASING', path, 'Unknown easing');
  if (op === 'sequence' || op === 'parallel') {
    array(o.steps, path);
    o.steps.forEach((s, i) => step(s, `${path}.steps[${i}]`));
  } else if (op === 'wait') {
    if (o.duration === undefined) fail('DURATION', path, 'Wait requires duration');
  } else if (op === 'type') {
    target(o.target, path, true);
    if (typeof o.value !== 'string') fail('SCHEMA', path, 'Expected text value');
  } else if (op === 'selectCategory') string(o.category, path);
  else if (op === 'reveal') string(o.entry, path);
  else {
    target(o.to, path);
    if (op === 'create' || op === 'paste') {
      array(o.blocks, path);
      o.blocks.forEach((b, i) => block(b, `${path}.blocks[${i}]`));
    } else {
      string(o.id, path);
      if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(o.id)) fail('SCHEMA', path, 'Invalid block ID');
    }
    if (op === 'dragFromToolbox') string(o.entry, path);
    if (op === 'connect' && (o.to as ObjectValue).kind !== 'connection')
      fail('SCHEMA', path, 'connect requires a connection target');
  }
}
export function parseTutorial(value: unknown): TutorialSpec {
  try {
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        typeof item === 'bigint' ||
        (typeof item === 'number' && !Number.isFinite(item))
      )
        throw Error('Tutorials must contain only JSON data');
      return item;
    });
    if (json === undefined) throw Error('Expected tutorial object');
    value = JSON.parse(json) as unknown;
  } catch (error) {
    fail('SCHEMA', 'tutorial', error instanceof Error ? error.message : String(error));
  }
  const o = object(value, 'tutorial', [
    'schemaVersion',
    'adapter',
    'viewport',
    'defaults',
    'steps',
  ]);
  if (o.schemaVersion !== 1 || o.adapter !== 'turbowarp')
    fail('SCHEMA', 'tutorial', 'Expected schemaVersion 1 and turbowarp adapter');
  const v = object(o.viewport, 'viewport', ['width', 'height']);
  if (v.width !== 1280 || v.height !== 720)
    fail('UNSUPPORTED', 'viewport', 'P1b uses the P1a 1280x720 layout');
  const d = object(o.defaults, 'defaults', ['theme', 'locale']);
  if (d.theme !== 'light' || d.locale !== 'zh-CN')
    fail('UNSUPPORTED', 'defaults', 'P1b supports light / zh-CN');
  array(o.steps, 'steps');
  o.steps.forEach((s, i) => step(s, `steps[${i}]`));
  return structuredClone(value) as TutorialSpec;
}
type Timing = { duration?: number; easing?: Ease };
export class SceneBuilder {
  ref(id: string) {
    return {
      id,
      connection: (name: 'next'): Destination => ({
        kind: 'connection',
        id,
        name,
      }),
      field: (name: string): FieldTarget => ({ kind: 'field', id, name }),
    };
  }
  workspace = {
    slot: (name: string): Destination => ({ kind: 'workspaceSlot', name }),
  };
  sequence(...steps: Step[]): Step {
    return { op: 'sequence', steps };
  }
  parallel(...steps: Step[]): Step {
    return { op: 'parallel', steps };
  }
  wait(duration: number): Step {
    return { op: 'wait', duration };
  }
  dragFromToolbox(entry: string, options: Timing & { id: string; to: Destination }): Step {
    return { op: 'dragFromToolbox', entry, ...options };
  }
  defineBlocks(blocks: BlockDefinition[]): BlockDefinition[] {
    return structuredClone(blocks);
  }
  create(blocks: BlockDefinition[], options: Timing & { to: Destination }): Step {
    return { op: 'create', blocks, ...options };
  }
  paste(blocks: BlockDefinition[], options: Timing & { to: Destination }): Step {
    return { op: 'paste', blocks, ...options };
  }
  move(id: string, to: Destination, timing: Timing = {}): Step {
    return { op: 'move', id, to, ...timing };
  }
  connect(id: string, to: Destination & { kind: 'connection' }, timing: Timing = {}): Step {
    return { op: 'connect', id, to, ...timing };
  }
  type(target: FieldTarget, value: string, timing: Timing = {}): Step {
    return { op: 'type', target, value, ...timing };
  }
  toolbox = {
    selectCategory: (category: string, duration?: number): Step => ({
      op: 'selectCategory',
      category,
      ...(duration === undefined ? {} : { duration }),
    }),
    reveal: (entry: string, duration?: number): Step => ({
      op: 'reveal',
      entry,
      ...(duration === undefined ? {} : { duration }),
    }),
  };
}
export function defineTutorial(
  config: Omit<TutorialSpec, 'steps'> & {
    build: (scene: SceneBuilder) => Step | Step[];
  },
): TutorialSpec {
  const { build, ...data } = config;
  const steps = build(new SceneBuilder());
  return parseTutorial({
    ...data,
    steps: Array.isArray(steps) ? steps : [steps],
  });
}
