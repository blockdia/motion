import { fail, type BlockDefinition } from '@blockdia-motion/core';
export const blocksCommit = '7c58de666658df1bb447d010132aa3914c10f41e';
export const guiCommit = 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff';
// Aliases identify real generated entries; definitions and defaults belong to Blockly.
export const entryAliases: Record<string, string> = {
  'events.whenFlagClicked': 'event_whenflagclicked',
  'motion.moveSteps': 'motion_movesteps',
  'looks.say': 'looks_say',
};
export function resolveField(block: BlockDefinition, name: string, step: string) {
  const mapping: Record<string, Record<string, [string, string]>> = {
    motion_movesteps: { steps: ['STEPS', 'NUM'] },
    looks_say: { message: ['MESSAGE', 'TEXT'] },
  };
  const alias = mapping[block.opcode]?.[name];
  if (alias) {
    const input = block.inputs?.[alias[0]];
    const child = input?.shadow ?? input?.block;
    if (!child || !Object.hasOwn(child.fields ?? {}, alias[1]))
      fail('FIELD', step, `Missing field ${block.id}.${name}`);
    return { block: child, name: alias[1] };
  }
  if (!Object.hasOwn(block.fields ?? {}, name))
    fail('FIELD', step, `Unknown field ${block.id}.${name}`);
  return { block, name };
}
