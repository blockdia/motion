import { type TutorialBundle, type Step } from '@blockdia-motion/core';
import { parseTutorial } from './spec.js';
import { planTyping } from './typing.js';
import { adapterVersion } from './bundle-schema.js';
export { parseBundle } from './bundle-schema.js';
/** Publish only semantics; input-method sequences do not depend on font geometry. */
export async function bundleTutorial(input: unknown): Promise<TutorialBundle> {
  const tutorial = parseTutorial(input);
  const typing: TutorialBundle['typing'] = {};
  async function visit(steps: Step[]): Promise<void> {
    for (const step of steps) {
      if (step.op === 'sequence' || step.op === 'parallel') await visit(step.steps);
      if (step.op === 'type' && !Object.hasOwn(typing, step.value))
        Object.defineProperty(typing, step.value, {
          value: await planTyping(step.value),
          enumerable: true,
        });
    }
  }
  await visit(tutorial.steps);
  return { schemaVersion: 2, kind: 'blockdia-motion/tutorial', adapterVersion, tutorial, typing };
}
