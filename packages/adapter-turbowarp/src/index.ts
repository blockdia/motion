import { fail, type BlockDefinition } from '@blockdia-motion/core';
export const blocksCommit = '7c58de666658df1bb447d010132aa3914c10f41e';
export const guiCommit = 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff';
export const catalog = [
  {
    key: 'events.whenFlagClicked',
    category: 'events',
    definition: { id: 'entry', opcode: 'event_whenflagclicked' },
  },
  {
    key: 'motion.moveSteps',
    category: 'motion',
    definition: {
      id: 'entry',
      opcode: 'motion_movesteps',
      inputs: {
        STEPS: {
          shadow: {
            id: 'entry.STEPS',
            opcode: 'math_number',
            fields: { NUM: '10' },
          },
        },
      },
    },
  },
  {
    key: 'looks.say',
    category: 'looks',
    definition: {
      id: 'entry',
      opcode: 'looks_say',
      inputs: {
        MESSAGE: {
          shadow: {
            id: 'entry.MESSAGE',
            opcode: 'text',
            fields: { TEXT: '你好！' },
          },
        },
      },
    },
  },
] satisfies { key: string; category: string; definition: BlockDefinition }[];
export const categories = [
  { key: 'motion', label: '运动', y: 109 },
  { key: 'looks', label: '外观', y: 158 },
  { key: 'events', label: '事件', y: 256 },
];
// Exact supported definitions; editor behavior is still checked in the pinned Blockly build.
export const supported: Record<string, { fields: string[]; inputs: string[] }> = {
  event_whenflagclicked: { fields: [], inputs: [] },
  motion_movesteps: { fields: [], inputs: ['STEPS'] },
  looks_say: { fields: [], inputs: ['MESSAGE'] },
  math_number: { fields: ['NUM'], inputs: [] },
  text: { fields: ['TEXT'], inputs: [] },
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
