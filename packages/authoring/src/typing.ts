import {
  candidates,
  loadDictionary,
  loadScriptTables,
  ReverseIndex,
  segment,
  writeSyllable,
} from '@kensio/pinyinjs';
import { fileSource } from '@kensio/pinyinjs/node';
import { fileURLToPath } from 'node:url';

type TypingFrame = {
  text: string;
  preedit?: boolean;
  preeditStart?: number;
  candidates?: string[];
};
async function loadInputDictionary() {
  const source = fileSource(
    fileURLToPath(new URL('../data/', import.meta.resolve('@kensio/pinyinjs'))),
  );
  const [dictionary, tables] = await Promise.all([
    loadDictionary(source, 'full'),
    loadScriptTables(source),
  ]);
  return { dictionary, tables, index: ReverseIndex.of(dictionary) };
}
let inputDictionary: ReturnType<typeof loadInputDictionary> | undefined;
/** Dictionary-driven, deterministic tutorial input; loaded only for Han text. */
export async function planTyping(value: string): Promise<TypingFrame[]> {
  const frames: TypingFrame[] = [{ text: '' }];
  let committed = '';
  function direct(text: string) {
    for (const { segment: character } of new Intl.Segmenter('zh-CN', {
      granularity: 'grapheme',
    }).segment(text)) {
      committed += character;
      frames.push({ text: committed });
    }
  }
  if (!/\p{Script=Han}/u.test(value)) {
    direct(value);
    return frames;
  }
  const { dictionary, tables, index } = await (inputDictionary ??= loadInputDictionary().catch(
    (error) => {
      inputDictionary = undefined;
      throw error;
    },
  ));
  for (const word of segment(dictionary, value)) {
    if (!word.reading.length) {
      direct(word.text);
      continue;
    }
    const syllables = word.reading.map((syllable) =>
      writeSyllable(syllable, 'none').replaceAll('ü', 'v'),
    );
    const spelling = syllables.join(' ');
    const boundaries = syllables.map((_, i) => syllables.slice(0, i + 1).join(' ').length);
    for (let i = 1; i <= spelling.length; i++) {
      const query = spelling.slice(0, i);
      // The library matches whole readings. If the next syllable is unfinished,
      // retain candidates for the completed prefix, never for untyped syllables.
      let found = [...candidates(index, query, { limit: 5, script: { prefer: 'Hans', tables } })];
      if (!found.length) {
        const end = boundaries.filter((end) => end <= i).at(-1);
        if (end)
          found = [
            ...candidates(index, spelling.slice(0, end), {
              limit: 5,
              script: { prefer: 'Hans', tables },
            }),
          ];
      }
      if (i === spelling.length) found = [...new Set([word.text, ...found])].slice(0, 5);
      frames.push({
        text: committed + query,
        preedit: true,
        preeditStart: committed.length,
        ...(found.length ? { candidates: found } : {}),
      });
    }
    committed += word.text;
    frames.push({ text: committed });
  }
  return frames;
}
