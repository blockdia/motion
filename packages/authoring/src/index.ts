export * from './spec.js';
import {
  type PreparationAdapter,
  type CompiledScene,
  type TypingFrame,
} from '@blockdia-motion/core';
import { compilePrepared } from './compiler.js';
import { bundleTutorial } from './bundle.js';
/** Node convenience entry for catalog/semantic tests. Browser preparation passes published input frames. */
export async function compile(
  input: unknown,
  adapter: PreparationAdapter,
  typing?: Record<string, TypingFrame[]>,
): Promise<CompiledScene> {
  const prepared = typing ?? (await bundleTutorial(input)).typing;
  return compilePrepared(input, adapter, prepared);
}
