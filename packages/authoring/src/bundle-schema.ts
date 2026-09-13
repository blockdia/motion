import { fail, type TutorialBundle, type Step } from '@blockdia-motion/core';
import { parseTutorial } from './spec.js';
export const adapterVersion = 'turbowarp-7c58de66-a2946eeb-client-1';
export function parseBundle(input: unknown): TutorialBundle {
  const b = input as TutorialBundle;
  if (
    !b ||
    b.schemaVersion !== 2 ||
    b.kind !== 'blockdia-motion/tutorial' ||
    b.adapterVersion !== adapterVersion
  )
    fail('SCHEMA', 'bundle', 'Expected current semantic tutorial bundle; recompile old scene.json');
  if (
    Object.keys(b).some(
      (k) => !['schemaVersion', 'kind', 'adapterVersion', 'tutorial', 'typing'].includes(k),
    )
  )
    fail('SCHEMA', 'bundle', 'Unknown bundle property');
  const tutorial = parseTutorial(b.tutorial);
  if (!b.typing || typeof b.typing !== 'object' || Array.isArray(b.typing))
    fail('SCHEMA', 'typing', 'Missing input sequences');
  function visit(steps: Step[]) {
    for (const step of steps) {
      if (step.op === 'sequence' || step.op === 'parallel') visit(step.steps);
      if (step.op !== 'type') continue;
      const frames = Object.hasOwn(b.typing, step.value) ? b.typing[step.value] : undefined;
      if (!Array.isArray(frames) || !frames.length || frames.at(-1)?.text !== step.value)
        fail('SCHEMA', 'typing', 'Incomplete input sequence');
      for (const f of frames)
        if (
          !f ||
          typeof f.text !== 'string' ||
          (f.preedit !== undefined && typeof f.preedit !== 'boolean') ||
          (f.preeditStart !== undefined &&
            (!Number.isInteger(f.preeditStart) ||
              f.preeditStart < 0 ||
              f.preeditStart > f.text.length)) ||
          (f.candidates !== undefined &&
            (!Array.isArray(f.candidates) || f.candidates.some((c) => typeof c !== 'string')))
        )
          fail('SCHEMA', 'typing', 'Invalid input frame');
    }
  }
  visit(tutorial.steps);
  return structuredClone({ ...b, tutorial });
}
