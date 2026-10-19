// Word-level accuracy on Tatoeba sentences typed in both modes.
// Run: sh scripts/fetch_eval_data.sh && npx vitest run --config vitest.eval.config.ts
// Optional: EVAL_N=2000 EVAL_PARAMS='{"holdMargin":3.5}'

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { Engine, textToKeys, type Lang } from '../src/index';

const RAW = join(__dirname, '..', '..', '..', 'data', 'raw', 'tatoeba');
const N = Number(process.env.EVAL_N || 1500);
const params = process.env.EVAL_PARAMS ? JSON.parse(process.env.EVAL_PARAMS) : {};

function load(file: string, ok: RegExp): string[] {
  const path = join(RAW, file);
  if (!existsSync(path)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.split('\t')[2]?.trim().replace(/\s+/g, ' ');
    if (!s || !ok.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  // deterministic spread over the file
  const step = Math.max(1, Math.floor(out.length / N));
  return out.filter((_, i) => i % step === 0).slice(0, N);
}

interface Stat {
  words: number;
  wrong: number;
  examples: string[];
}

function run(engine: Engine, sentences: string[], toKeys: (s: string) => string, mode: Lang): Stat {
  const st: Stat = { words: 0, wrong: 0, examples: [] };
  for (const s of sentences) {
    engine.process({ type: 'reset' });
    engine.setMode(mode);
    let keys: string;
    try {
      keys = toKeys(s);
    } catch {
      continue;
    }
    for (const ch of keys) {
      if (ch === ' ') engine.process({ type: 'space' });
      else engine.process({ type: 'key', ch });
    }
    const out = engine.process({ type: 'enter' }).text.replace(/\n$/, '');
    const a = s.split(' ');
    const b = out.split(' ');
    st.words += a.length;
    let bad = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bad++;
    st.wrong += bad;
    if (bad && st.examples.length < 25) st.examples.push(`${s}  =>  ${out}`);
  }
  return st;
}

test('accuracy', () => {
  const ko = load('kor_sentences.tsv', /^[가-힣 .,?!0-9]+$/);
  const en = load('eng_sentences_sample.tsv', /^[A-Za-z .,?!'0-9-]+$/);
  if (!ko.length || !en.length) {
    console.log('eval data missing; run scripts/fetch_eval_data.sh');
    return;
  }
  const engine = new Engine({ params });
  const t0 = performance.now();
  const rows: Array<[string, Stat]> = [
    ['ko typed in A (should convert)', run(engine, ko, (s) => textToKeys(s), 'en')],
    ['ko typed in 가 (should stay)', run(engine, ko, (s) => textToKeys(s), 'ko')],
    ['en typed in A (should stay)', run(engine, en, (s) => s, 'en')],
    ['en typed in 가 (should convert)', run(engine, en, (s) => s, 'ko')],
  ];
  const ms = performance.now() - t0;
  for (const [name, st] of rows) {
    console.log(`\n## ${name}: ${st.wrong}/${st.words} wrong words (${((1000 * st.wrong) / st.words).toFixed(1)} per 1000)`);
    for (const e of st.examples) console.log('  ' + e);
  }
  console.log(`\nsentences: ko=${ko.length} en=${en.length}, ${ms.toFixed(0)} ms`);
});
