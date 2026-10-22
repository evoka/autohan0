// Scores one word's key sequence as English (QWERTY), Korean (Sebeolsik), or
// English followed by a Korean particle/ending (AI로, deploy했는데).
// All scores are natural-log probabilities of the same key sequence under each
// language, so they can be compared directly.

import { isChoOnly, isCompleteSyllable, jamoKind, renderUnit, type Unit } from './hangul';
import type { Layout } from './layout';
import type { LangModel, Models } from './models';

export const NEG = -1e9; // "impossible"

const LOG = Math.log;
// A number token is ~1-2% of words; each digit is one of ten.
const DIGIT_START = LOG(0.002);
const DIGIT_NEXT = LOG(0.15);
const LETTER_DIGIT_EN = LOG(0.05); // v2, mp3, h264
const HANGUL_DIGIT = LOG(0.3);
const RUN_SPLIT = LOG(0.2); // extra word-like run inside one token (build.sh)
// Korean part after an English word: mostly particles / endings (AI로, deploy했는데),
// sometimes a noun (for문).
const SUFFIX_JOSA = 0.85;
// Acronyms (UI, PR, API, README) are not lowercase words: a flat cost by length instead of the
// frequency of "ui" / "pr".
const ACRONYM_START = LOG(0.001);
const ACRONYM_MORE = LOG(0.25);
// In English mode, Shift + letter that the Hangul layout reads as a digit or symbol
// (Sebeolsik Final: Shift+K = 2, Shift+N = -) was almost surely meant as a capital letter.
const SHIFT_SYMBOL_EN = LOG(0.001);
// A one-letter label before a Korean noun (n제, x축, A팀): flat cost instead of the word "n".
const LABEL_HEAD = LOG(0.01);
// A letter glued to a digit in a code token (k8s, h264, 3e-4, F1), instead of the word
// probability of "k" or "s".
const CODE_LETTER = LOG(0.15);
// A syllable that never occurs in the Korean word lists (긘, 뗘): the jamo n-gram alone is
// too kind to it. Charged only for words typed in English mode: in Korean mode the typist
// meant those keys (캬, 챠트).
const UNSEEN_SYLLABLE = LOG(0.01);
// Ordinal / unit suffixes right after a number (2nd, 3kg, 24hrs): English, not 2시 / 3그.
const UNIT_AFTER_DIGIT = LOG(0.3);
const UNIT_SUFFIXES = new Set(
  'kg km kb mb gb tb hr hrs lb lbs yr yrs ms min mins sec secs cm mm mi ft oz px pt fps mph am pm ml mg kw ghz mhz'.split(' '),
);

/** 1st 2nd 3rd 4th 11th 12th 22nd … (12nd is not an ordinal: 12시). */
function isOrdinal(digits: string, suffix: string): boolean {
  const n = Number(digits);
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  switch (suffix) {
    case 'st':
      return last === 1 && !teen;
    case 'nd':
      return last === 2 && !teen;
    case 'rd':
      return last === 3 && !teen;
    case 'th':
      return teen || last === 0 || last > 3;
    default:
      return false;
  }
}

/** log P of a 2–6 letter all-caps acronym. */
export function acronymLogProb(len: number): number {
  return ACRONYM_START + (len - 2) * ACRONYM_MORE;
}

function punctCost(ch: string, lead: boolean): number {
  if (lead) {
    if ('([{"\'“‘<'.includes(ch)) return -4.5;
    if ('#@$~*-./`'.includes(ch)) return -5.5;
    return -8;
  }
  if (',.?!'.includes(ch)) return -3.5;
  if (')]}"\'”’:;…·'.includes(ch)) return -4.5;
  if ('/_-@#+=&*%~>'.includes(ch)) return -5.5;
  return -8;
}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLower = (c: string) => c >= 'a' && c <= 'z';
const isUpper = (c: string) => c >= 'A' && c <= 'Z';
const isLetter = (c: string) => isLower(c) || isUpper(c);

/** log P(word) (complete) or log P(word starts with prefix) under lexicon + n-gram mixture. */
export function wordLogProb(m: LangModel, key: string, complete: boolean): number {
  const dict = complete ? m.lex.freq(key) : m.lex.prefixMass(key);
  const lm = m.logUncovered + m.lm.logProb(key, complete);
  if (dict <= 0) return lm;
  const a = LOG(dict);
  return a > lm ? a + Math.log1p(Math.exp(lm - a)) : lm + Math.log1p(Math.exp(a - lm));
}

function caseCost(run: string): number {
  let up = 0;
  for (const c of run) if (isUpper(c)) up++;
  if (up === 0) return 0;
  if (run.length === 1) return LOG(0.3);
  if (up === run.length) return LOG(0.02);
  if (up === 1 && isUpper(run[0])) return LOG(0.15);
  // camelCase / iPhone / GitHub are real but rare; short ones (kG, jGkd) are
  // almost always Sebeolsik Shift keys (ㅒ, compound finals) typed in English mode.
  return run.length >= 5 ? LOG(0.003) : LOG(1e-4);
}

/**
 * A URL, path or address typed as one token: never read as Korean. A lone `.` or `/` is not
 * enough (안녕., AI로 where `/` is ㅗ): it takes `://`, a leading www. ~/ ./ ../ localhost:,
 * a /dir/ path, or x@y — the last only where `@` is a symbol on the layout (on Sebeolsik Final
 * it is ㄺ받침: jd@jt2uf is 읽었다).
 */
export function isUrlLike(keys: string, layout: Layout): boolean {
  if (/:\/\//.test(keys) || /^(www\.|~\/|\.\.?\/|localhost:)/.test(keys) || /^\/[^/]+\//.test(keys)) return true;
  return jamoKind(layout.value('@')) === 'sym' && /[A-Za-z0-9]@[A-Za-z0-9]/.test(keys);
}

/** True for tokens like TV, README, PR, Q4 (2+ letters, all uppercase). */
export function isAllCapsToken(s: string): boolean {
  let letters = 0;
  for (const c of s) {
    if (isLower(c)) return false;
    if (isUpper(c)) letters++;
  }
  return letters >= 2;
}

export class Scorer {
  private readonly memoEn = new Map<string, number>();

  constructor(readonly models: Models) {}

  /** English (QWERTY) reading of the keys. */
  scoreEn(s: string, complete: boolean): number {
    const memoKey = (complete ? '$' : '^') + s;
    const hit = this.memoEn.get(memoKey);
    if (hit !== undefined) return hit;
    let lp = 0;
    let i = 0;
    let seenAlnum = false;
    let runs = 0;
    let prevKind = '';
    let alnum = 0;
    for (const c of s) if (isLetter(c) || isDigit(c)) alnum++;
    let lastDigits = '';
    while (i < s.length) {
      const c = s[i];
      if (isLetter(c)) {
        let j = i + 1;
        // letters with internal apostrophes (don't, it's)
        while (j < s.length && (isLetter(s[j]) || (s[j] === "'" && j + 1 < s.length && isLetter(s[j + 1])))) j++;
        const run = s.slice(i, j);
        const isLast = j >= s.length;
        let w = wordLogProb(this.models.en, run.toLowerCase(), complete || !isLast) + caseCost(run);
        if (run.length <= 6 && isAllCapsToken(run)) w = Math.max(w, acronymLogProb(run.length));
        // A single letter glued to a digit is a code token (k8s, h264, 3e-4, F1), not the word
        // "k". Longer runs are left to the word model: in Sebeolsik the digit keys are vowels
        // (ㅜ = 9, ㅛ = 4), so "o9x" is 축 and "3kr" is 3개.
        // ("5y/" is not: a letter after a digit counts only at the end or before another digit.
        // Nor is a lowercase letter + one digit: j4 is 요, m5 is 휴 — ㅛ ㅠ ㅑ ㅖ ㅢ are digit keys.)
        const nextDigit = j < s.length && isDigit(s[j]);
        if (run.length === 1 && (nextDigit || (prevKind === 'digit' && j >= s.length)) && (isUpper(run) || alnum >= 3)) w = Math.max(w, CODE_LETTER);
        // 2nd, 3kg, 24hrs: an ordinal / unit after a number is English, not 2시 / 3그
        if (prevKind === 'digit' && (UNIT_SUFFIXES.has(run.toLowerCase()) || isOrdinal(lastDigits, run.toLowerCase()))) w = Math.max(w, UNIT_AFTER_DIGIT);
        lp += w;
        if (prevKind === 'digit') lp += LETTER_DIGIT_EN;
        else if (runs > 0) lp += RUN_SPLIT;
        runs++;
        prevKind = 'letter';
        seenAlnum = true;
        i = j;
      } else if (isDigit(c)) {
        let j = i + 1;
        while (j < s.length && isDigit(s[j])) j++;
        lp += DIGIT_START + (j - i - 1) * DIGIT_NEXT;
        if (prevKind === 'letter') lp += LETTER_DIGIT_EN;
        lastDigits = s.slice(i, j);
        prevKind = 'digit';
        seenAlnum = true;
        i = j;
      } else {
        lp += punctCost(c, !seenAlnum);
        prevKind = 'punct';
        i++;
      }
    }
    if (this.memoEn.size > 20000) this.memoEn.clear();
    this.memoEn.set(memoKey, lp);
    return lp;
  }

  /**
   * Korean (Sebeolsik) reading. Returns NEG when the jamo do not form syllables
   * (orphan vowel / final consonant, initial consonant without vowel), except a
   * trailing initial consonant while the word is still being typed.
   * `asSuffix` scores the first Hangul run as a particle/ending after English. `enTyped`: the
   * word was typed in English mode, so syllables unseen in the word lists are charged.
   */
  scoreKo(units: Unit[], complete: boolean, asSuffix = false, enTyped = false): number {
    const ko = this.models.ko;
    const comb = this.models.comb;
    if (units.length === 0) return 0;
    const emo = jamoEmoticon(units);
    if (emo !== null) return emo;
    let lp = 0;
    let i = 0;
    let seenAlnum = false;
    let prevKind = '';
    let firstRun = true;
    while (i < units.length) {
      const u = units[i];
      if (!u.sym) {
        let j = i;
        let key = '';
        let unseen = 0;
        while (j < units.length && !units[j].sym) {
          const v = units[j];
          const last = j === units.length - 1;
          if (!isCompleteSyllable(v) && !(last && !complete && isChoOnly(v))) return NEG;
          key += comb.canonical(v.cho) + (v.jung ? comb.canonical(v.jung) : '') + (v.jong ? comb.canonical(v.jong) : '');
          // the last syllable may still grow (갈 → 갉) while typing
          if (enTyped && isCompleteSyllable(v) && (complete || !last) && !this.models.seenSyllables.has(renderUnit(v))) unseen++;
          j++;
        }
        const isLast = j >= units.length;
        const c = complete || !isLast;
        let w = wordLogProb(ko, key, c) + unseen * UNSEEN_SYLLABLE;
        // after English (AI로) or a number (3시), Hangul is mostly a particle / counter
        if ((asSuffix && firstRun) || prevKind === 'digit') {
          const josa = c ? this.models.josa.freq(key) : this.models.josa.prefixMass(key);
          const gen = Math.exp(w);
          w = LOG(SUFFIX_JOSA * josa + (1 - SUFFIX_JOSA) * gen + 1e-300);
        }
        lp += w;
        if (prevKind !== 'digit' && !firstRun) lp += RUN_SPLIT;
        firstRun = false;
        prevKind = 'hangul';
        seenAlnum = true;
        i = j;
      } else if (isDigit(u.sym)) {
        let j = i + 1;
        while (j < units.length && units[j].sym && isDigit(units[j].sym)) j++;
        lp += DIGIT_START + (j - i - 1) * DIGIT_NEXT;
        if (prevKind === 'hangul') lp += HANGUL_DIGIT; // 제3장, 1월2일
        prevKind = 'digit';
        seenAlnum = true;
        i = j;
      } else {
        lp += punctCost(u.sym, !seenAlnum);
        prevKind = 'punct';
        i++;
      }
    }
    return lp;
  }

  /** Cost of a Korean reading of keys typed in English mode: each Shift+letter read as a digit / symbol. */
  shiftSymbolCost(keys: string, layout: Layout): number {
    let n = 0;
    for (const k of keys) if (isUpper(k) && jamoKind(layout.value(k)) === 'sym') n++;
    return n * SHIFT_SYMBOL_EN;
  }

  /**
   * True when the Korean tail after a one-letter head is a known particle / counter / label
   * noun or a dictionary word (n제, x축, A팀) — a one-letter head is allowed only then.
   */
  tailIsKnown(units: Unit[], complete: boolean): boolean {
    if (units.length === 0) return false;
    let key = '';
    for (const u of units) {
      if (!isCompleteSyllable(u)) return false;
      key += this.models.comb.canonical(u.cho) + this.models.comb.canonical(u.jung) + (u.jong ? this.models.comb.canonical(u.jong) : '');
    }
    const { josa, ko } = this.models;
    return complete ? josa.has(key) || ko.lex.has(key) : josa.prefixMass(key) > 0 || ko.lex.prefixMass(key) > 0;
  }

  /**
   * English prefix keys[0:at] (complete) + Korean suffix keys[at:]. `enTyped`: the word was
   * typed in English mode, so Shift+letter read as a symbol / digit is charged (see shiftSymbolCost).
   */
  scoreSplit(keys: string, at: number, layout: Layout, complete: boolean, switchLogProb: number, enTyped = false): number {
    const head = keys.slice(0, at);
    let en = this.scoreEn(head, true);
    if (en <= NEG / 2) return NEG;
    // A single letter before a Korean noun is a label (n제, x축, B급), not the word "n".
    if (head.length === 1 && isLetter(head)) en = Math.max(en, LABEL_HEAD);
    // The head must read better as English than as a Korean word by itself:
    // "hr" + 친구에게 is really 내친구에게, "lt" + 이 is 저이.
    const shift = (part: string) => (enTyped ? this.shiftSymbolCost(part, layout) : 0);
    if (this.scoreKo(layout.compose(head, enTyped), true, false, enTyped) + shift(head) >= en) return NEG;
    const tailKeys = keys.slice(at);
    const ko = this.scoreKo(layout.compose(tailKeys, enTyped), complete, true, enTyped);
    if (ko <= NEG / 2) return NEG;
    return en + switchLogProb + ko + shift(tailKeys);
  }
}

// ㅋㅋ, ㅎㅎ, ㅠㅠ, ㅜㅜ, ㅡㅡ, ㅇㅇ, ㄴㄴ, ㄷㄷ: the same lone jamo repeated (2+ units).
// Mixed lone jamo (ㅠㅋ = the keys "50") are not an emoticon.
const EMO_JAMO = new Set(['ᄏ', 'ᄒ', 'ᅲ', 'ᅮ', 'ᅳ', 'ᄋ', 'ᄂ', 'ᄃ']);
function jamoEmoticon(units: Unit[]): number | null {
  if (units.length < 2) return null;
  let first = '';
  for (const u of units) {
    const j = u.sym ? '' : isChoOnly(u) ? u.cho : !u.cho && u.jung && !u.jong ? u.jung : '';
    if (!j || !EMO_JAMO.has(j) || (first && j !== first)) return null;
    first = j;
  }
  return LOG(2e-4) + (units.length - 2) * LOG(0.5);
}
