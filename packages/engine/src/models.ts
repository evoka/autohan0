// Language models built once from the generated word lists.

import enJson from './generated/en.json';
import koJson from './generated/ko.json';
import { Combiner, jamoKind } from './hangul';
import { defaultCombiner } from './layout';
import { Lexicon, parseZipfGroups, zipfToFreq, type LexEntry } from './lexicon';
import { NgramModel } from './lm';

export interface WordListData {
  coveredMass: number;
  words: string; // "zz word word ..." lines
  morphemes?: string;
}

export interface EngineData {
  en: WordListData;
  ko: WordListData;
}

export interface LangModel {
  lex: Lexicon;
  lm: NgramModel;
  /** log of the probability mass not covered by the word list (weight of the n-gram model) */
  logUncovered: number;
}

export interface Models {
  en: LangModel;
  ko: LangModel;
  /** Korean particles/endings/counters that follow an English word or a number (AI로, deploy했는데, 3시). */
  josa: Lexicon;
  comb: Combiner;
  /** precomposed syllables that occur in the Korean word lists (긘 is not one) */
  seenSyllables: Set<string>;
}

export const EN_ORDER = 5;
export const KO_ORDER = 5;
const LM_FLOOR = 0.1;
const KIND_CLASS: Record<string, number> = { cho: 0, jung: 1, jong: 2, sym: 3 };

// Particles / endings / nouns attached to English words in Korean text, counters
// after numbers (3시, 10개) and label nouns after a letter (n제, x축, B급), with rough weights.
const JOSA = `
제 2 축 2 급 2 팀 2 반 1 형 1 호 1 호선 1 사 1 값 2 차 1 언어 1 세대 1 타입 1 라인 1 학점 1 등급 1 버튼 1 키 2 모드 1
로 10 으로 6 에 10 에서 8 에게 3 한테 3 도 8 는 10 은 8 을 10 를 10 이 10 가 10 의 6 와 4 과 4
랑 3 이랑 2 만 4 까지 3 부터 3 처럼 2 보다 2 이나 2 나 2 라고 2 이라고 2 에는 3 에도 2 로는 2
으로는 1 로도 1 인데 3 이고 2 이야 2 야 2 이에요 2 예요 2 입니다 2 이다 2 인가 1 인지 2 들 3 들이 2
들을 2 들은 1 해 4 해서 4 해요 3 했어 3 했다 3 했는데 3 했어요 3 했고 2 했더니 1 하는 4 하고 4 하면 4
할 3 한 3 하기 2 하세요 2 하자 2 합니다 2 했습니다 2 해야 2 해줘 2 해주세요 2 해도 2 하려고 1 하다가 1
됐다 1 됐어 1 된 2 되는 2 돼요 1 되면 1 돼 1 문 2 파일 2 버전 1 기능 1 서버 1 코드 1 쪽 1 거 2 것 2
같은 2 같아 1 같아요 1 에서는 2 에서도 1 으로도 1 이라서 1 라서 1 이라 1 라 1 요 1 이요 1 씨 1 님 2
개 4 시 3 분 3 초 2 년 3 월 3 일 3 명 3 번 3 원 3 시간 2 살 2 층 1 장 1 권 1 대 1 마리 1 잔 1 주 1
개월 1 회 1 등 1 위 1 점 1 배 1 번째 1 차 1 년도 1 천 1 만원 1 억 1 퍼센트 1 시에 2 시까지 1 분에 1 일에 1
`;

let cached: Models | null = null;

function buildLang(
  data: WordListData,
  order: number,
  alphabet: string,
  classOf: (ch: string) => number,
  canon: (w: string) => string | null,
  lmWeight: (zipf: number) => number,
  morphWeight: (zipf: number) => number,
): LangModel {
  const lm = new NgramModel(order, alphabet, classOf, LM_FLOOR);
  const entries: LexEntry[] = [];
  parseZipfGroups(data.words, (w, z) => {
    const key = canon(w);
    if (!key) return;
    entries.push({ key, freq: zipfToFreq(z) });
    lm.add(key, lmWeight(z));
  });
  if (data.morphemes) {
    parseZipfGroups(data.morphemes, (w, z) => {
      const key = canon(w);
      if (key) lm.add(key, morphWeight(z));
    });
  }
  lm.finalize();
  const lex = new Lexicon(entries, data.coveredMass);
  return { lex, lm, logUncovered: Math.log(Math.max(0.02, 1 - lex.coveredMass)) };
}

export function buildModels(data?: EngineData): Models {
  if (!data && cached) return cached;
  const d: EngineData = data ?? { en: enJson as WordListData, ko: koJson as WordListData };
  const comb = defaultCombiner();
  const en = buildLang(
    d.en,
    EN_ORDER,
    "abcdefghijklmnopqrstuvwxyz'",
    (ch) => ('aeiouy'.includes(ch) ? 1 : ch === "'" ? 2 : 0),
    (w) => w,
    (z) => Math.max(0.2, z - 2),
    () => 0,
  );
  const ko = buildLang(
    d.ko,
    KO_ORDER,
    '',
    (ch) => KIND_CLASS[jamoKind(ch)],
    (w) => comb.canonicalWord(w),
    (z) => Math.max(0.2, z - 2.5),
    (z) => 0.5 * Math.max(0.2, z - 3),
  );
  const josaEntries: LexEntry[] = [];
  const parts = JOSA.trim().split(/\s+/);
  let total = 0;
  for (let i = 0; i + 1 < parts.length; i += 2) total += Number(parts[i + 1]);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = comb.canonicalWord(parts[i]);
    if (key) josaEntries.push({ key, freq: Number(parts[i + 1]) / total });
  }
  const seenSyllables = new Set<string>();
  const addSyllables = (w: string) => {
    for (const ch of w) if (ch >= '가' && ch <= '힣') seenSyllables.add(ch);
  };
  parseZipfGroups(d.ko.words, addSyllables);
  if (d.ko.morphemes) parseZipfGroups(d.ko.morphemes, addSyllables);
  const models: Models = { en, ko, josa: new Lexicon(josaEntries, 1), comb, seenSyllables };
  if (!data) cached = models;
  return models;
}
