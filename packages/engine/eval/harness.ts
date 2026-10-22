// Shared by the accuracy evaluations (eval/) and the regression guard (test/guard.test.ts):
// a sentence becomes the keys a Sebeolsik typist presses, is typed in one mode from a fresh
// line, and the result is compared word by word with the sentence.

import type { Engine, Lang } from '../src/engine';
import { textToKeys } from '../src/keys';
import type { LayoutId } from '../src/layout';

/** Hangul runs (with attached , . ? !) become Sebeolsik keys; everything else is typed as is. */
export function keysFor(sentence: string, layout: LayoutId = '3f'): string {
  return sentence
    .split(' ')
    .map((w) => (/[가-힣]/.test(w) ? w.replace(/[가-힣?!.,]+/g, (k) => textToKeys(k, layout)) : w))
    .join(' ');
}

export interface SentenceStat {
  words: number;
  wrong: number;
  /** "sentence  =>  what came out" for every sentence with a wrong word */
  bad: string[];
}

/** Type each sentence in `mode` (reset, keys, enter) and count wrong words. Sentences that cannot be typed are skipped. */
export function runSentences(engine: Engine, sentences: string[], mode: Lang, layout: LayoutId = '3f'): SentenceStat {
  const st: SentenceStat = { words: 0, wrong: 0, bad: [] };
  if (engine.layoutId !== layout) engine.setLayout(layout);
  for (const s of sentences) {
    let keys: string;
    try {
      keys = keysFor(s, layout);
    } catch {
      continue;
    }
    engine.process({ type: 'reset' });
    engine.setMode(mode);
    for (const ch of keys) engine.process(ch === ' ' ? { type: 'space' } : { type: 'key', ch });
    const out = engine.process({ type: 'enter' }).text.replace(/\n$/, '');
    const a = s.split(' ');
    const b = out.split(' ');
    st.words += a.length;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    st.wrong += n;
    if (n) st.bad.push(`${s}  =>  ${out}`);
  }
  return st;
}

/** Type one token alone (reset, keys, space) and return what came out. */
export function typeAlone(engine: Engine, keys: string, mode: Lang): string {
  engine.process({ type: 'reset' });
  engine.setMode(mode);
  for (const ch of keys) engine.process({ type: 'key', ch });
  return engine.process({ type: 'space' }).text.replace(/ $/, '');
}
