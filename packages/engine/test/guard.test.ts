// Regression guard: hard sentences must keep passing, and the word lists the engine ships
// with must not change more than they do today ("wrongly changing a word is worse than
// leaving it", see docs/superpowers/specs/2026-10-22-accuracy-design.md).

import { describe, expect, it } from 'vitest';
import { Engine, textToKeys, type Lang } from '../src/index';
import enJson from '../src/generated/en.json';
import koJson from '../src/generated/ko.json';
import { parseZipfGroups } from '../src/lexicon';
import { runSentences, typeAlone } from '../eval/harness';
import { HARD, IDENTIFIERS } from './fixtures/hard';

/** en.json words that come out Korean when typed alone in English mode (hr → 내, kg → 그 …). */
const EN_CHANGE_CEILING = 76;
/** ko.json eojeols that come out English when typed alone in Korean mode. */
const KO_CHANGE_CEILING = 1;

function wordsOf(data: { words: string }): string[] {
  const out: string[] = [];
  parseZipfGroups(data.words, (w) => out.push(w));
  return out;
}

describe('어려운 문장', () => {
  const engine = new Engine();
  const select = (status: 'pass' | 'known', mode: Lang) =>
    HARD.filter((h) => h.status === status && (h.modes ?? ['en', 'ko']).includes(mode)).map((h) => h.text);

  it('pass 항목은 두 모드에서 모두 맞는다', () => {
    const bad: string[] = [];
    for (const mode of ['en', 'ko'] as Lang[]) {
      const r = runSentences(engine, select('pass', mode), mode);
      bad.push(...r.bad.map((b) => `[${mode}] ${b}`));
    }
    expect(bad).toEqual([]);
  });

  it('known 항목 현황 (단언 없음)', () => {
    for (const mode of ['en', 'ko'] as Lang[]) {
      const r = runSentences(engine, select('known', mode), mode);
      console.log(`known typed in ${mode}: ${r.wrong}/${r.words} wrong\n  ${r.bad.join('\n  ')}`);
    }
  });
});

describe('바꾸면 안 되는 목록', () => {
  const engine = new Engine();

  it('코드 식별자는 A 모드에서 그대로', () => {
    const changed = IDENTIFIERS.filter((w) => typeAlone(engine, w, 'en') !== w).map((w) => `${w} → ${typeAlone(engine, w, 'en')}`);
    expect(changed).toEqual([]);
  });

  it(`en.json 단어를 A 모드로 쳐도 바뀌는 수가 ${EN_CHANGE_CEILING} 이하`, { timeout: 120000 }, () => {
    const changed: string[] = [];
    for (const w of wordsOf(enJson)) {
      const out = typeAlone(engine, w, 'en');
      if (out !== w) changed.push(`${w} → ${out}`);
    }
    console.log(`en.json: ${changed.length} changed\n  ${changed.join('  ')}`);
    expect(changed.length).toBeLessThanOrEqual(EN_CHANGE_CEILING);
  });

  it(`ko.json 어절을 가 모드로 쳐도 바뀌는 수가 ${KO_CHANGE_CEILING} 이하`, { timeout: 120000 }, () => {
    const changed: string[] = [];
    for (const w of wordsOf(koJson)) {
      let keys: string;
      try {
        keys = textToKeys(w);
      } catch {
        continue;
      }
      const out = typeAlone(engine, keys, 'ko');
      if (out !== w) changed.push(`${w} → ${out}`);
    }
    console.log(`ko.json: ${changed.length} changed\n  ${changed.join('  ')}`);
    expect(changed.length).toBeLessThanOrEqual(KO_CHANGE_CEILING);
  });
});
