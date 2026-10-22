// The auto-switching state machine.
//
// Input: QWERTY ASCII keys (physical key + Shift) and editing events.
// Output: the full text, the current mode (ko/en) and an edit operation
// (delete N code points before the caret, then insert a string) so a wrapper
// that cannot re-render the whole text can apply the change.

import { getLayout, type Layout, type LayoutId } from './layout';
import { buildModels, type EngineData } from './models';
import { NEG, Scorer, isAllCapsToken } from './scorer';

export type Lang = 'ko' | 'en';

export type EngineEvent =
  | { type: 'key'; ch: string }
  | { type: 'space' }
  | { type: 'enter' }
  | { type: 'backspace' }
  | { type: 'toggle' }
  | { type: 'commit' }
  | { type: 'reset' };

export interface Edit {
  /** code points to delete before the caret */
  deleteCount: number;
  insert: string;
}

export interface WordView {
  keys: string;
  text: string;
  sep: string;
  /** language of the rendering: 'mix' = English head + Korean tail */
  lang: 'en' | 'ko' | 'mix';
  typedMode: Lang;
  /** rendering differs from what the keys would give with no correction */
  changed: boolean;
  /** both readings plausible; may still be re-judged by the next word */
  held: boolean;
  /** user reverted / toggled manually / learned: never auto-corrected */
  locked: boolean;
}

export interface EngineResult {
  text: string;
  mode: Lang;
  edit: Edit;
  words: WordView[];
  /** length (code points) of the frozen part of the text that will not change any more */
  committedLength: number;
}

export interface LearnedEntry {
  keys: string;
  mode: Lang;
  /** what the keys give in that mode (what the user wanted to keep) */
  text: string;
  count: number;
}

export interface EngineParams {
  /** log-odds bonus for the language the word was started in */
  modePrior: number;
  /** extra log-odds the current rendering keeps while a word is being typed */
  midHysteresis: number;
  /** at word end, both readings within this margin => word is held */
  holdMargin: number;
  /** at the end of a line (enter), keep the shown reading within this margin */
  lineEndKeepMargin: number;
  /** decision margin needed to re-judge held previous words */
  confidentMargin: number;
  /** bonus for the neighbour's language when re-judging a held word */
  contextPrior: number;
  /** log-odds bonus for staying in the previous word's language */
  prevWordPrior: number;
  /** log probability of switching English -> Korean inside one word */
  switchLogProb: number;
  /** maximum gap between two toggles to count as a double press (ms) */
  doubleToggleMs: number;
  /** reverts of the same keys before they are learned */
  learnThreshold: number;
}

export interface EngineLimits {
  /** older words beyond this many are frozen into the committed text (default: no limit) */
  maxLiveWords?: number;
  /** committed text longer than this is trimmed from the front (default: no limit) */
  maxCommitted?: number;
}

export const DEFAULT_PARAMS: EngineParams = {
  modePrior: 2.5,
  midHysteresis: 3,
  holdMargin: 4,
  lineEndKeepMargin: 3,
  confidentMargin: 6,
  contextPrior: 3.4,
  prevWordPrior: 2,
  switchLogProb: Math.log(0.02),
  doubleToggleMs: 400,
  learnThreshold: 3,
};

export interface EngineOptions extends EngineLimits {
  layout?: LayoutId;
  mode?: Lang;
  data?: EngineData;
  params?: Partial<EngineParams>;
  learned?: LearnedEntry[];
}

interface Interp {
  lang: 'en' | 'ko' | 'mix';
  at: number; // split index for 'mix'
}

interface Word {
  keys: string;
  typedMode: Lang;
  interp: Interp;
  locked: boolean;
  /** as-typed rendering: mode in effect from key index `at` (manual toggles) */
  segs: Array<{ at: number; mode: Lang }>;
  sep: string;
  held: boolean;
}

interface Cand {
  interp: Interp;
  score: number; // raw log probability
}

const EN: Interp = { lang: 'en', at: 0 };
const KO: Interp = { lang: 'ko', at: 0 };
const interpLang = (i: Interp): Lang => (i.lang === 'en' ? 'en' : 'ko');
const sameInterp = (a: Interp, b: Interp) => a.lang === b.lang && (a.lang !== 'mix' || a.at === b.at);
const other = (m: Lang): Lang => (m === 'ko' ? 'en' : 'ko');
const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);
/** A token with no letter key (2024, 3.5, ...) belongs to neither language: it is no context for its neighbours. */
const isNeutral = (keys: string) => !/[A-Za-z]/.test(keys);
/** The Korean tail of a mixed word may start after a letter, a digit or a closing quote / bracket ("contents"라고). */
const isSplitBoundary = (c: string) => isAlnum(c) || '"\')]}'.includes(c);
/**
 * An English head worth splitting on: a word / acronym (2+ letters), a number / code token
 * (3개, v0.8.5로), or a single letter when the tail is a known particle / noun (n제, x축, A팀).
 */
function headQualifies(head: string, tailIsKnown: () => boolean): boolean {
  let letters = 0;
  for (const c of head) {
    if (/[0-9]/.test(c)) return true;
    if (/[A-Za-z]/.test(c)) letters++;
  }
  if (letters >= 2) return true;
  return head.length === 1 && letters === 1 && tailIsKnown();
}

function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdbff) n++;
  }
  return n;
}

export class Engine {
  readonly params: EngineParams;
  private layout: Layout;
  private readonly scorer: Scorer;
  private mode: Lang;
  private committed = '';
  private words: Word[] = [];
  private lastText = '';
  private bypass = false;
  private lastToggle: { time: number; kind: 'plain' | 'revert'; prev: Word | null } | null = null;
  private readonly revertCounts = new Map<string, number>();
  private readonly learned = new Map<string, LearnedEntry>();
  private learnedPrefixes = new Set<string>();
  private readonly maxLiveWords: number;
  private readonly maxCommitted: number;

  constructor(opts: EngineOptions = {}) {
    this.params = { ...DEFAULT_PARAMS, ...opts.params };
    this.maxLiveWords = opts.maxLiveWords ?? Infinity;
    this.maxCommitted = opts.maxCommitted ?? Infinity;
    this.layout = getLayout(opts.layout ?? '3f');
    this.scorer = new Scorer(buildModels(opts.data));
    this.mode = opts.mode ?? 'en';
    for (const e of opts.learned ?? []) this.addLearned(e.keys, e.mode, e.count);
  }

  // ---- public API -------------------------------------------------------

  process(ev: EngineEvent, now: number = Date.now()): EngineResult {
    switch (ev.type) {
      case 'key':
        for (const ch of ev.ch) this.onKey(ch);
        break;
      case 'space':
        this.onSpace();
        break;
      case 'enter':
        this.onEnter();
        break;
      case 'backspace':
        this.onBackspace();
        break;
      case 'toggle':
        this.onToggle(now);
        break;
      case 'commit':
        this.freeze('');
        break;
      case 'reset':
        this.committed = '';
        this.words = [];
        this.lastToggle = null;
        break;
    }
    if (ev.type !== 'toggle') this.lastToggle = null;
    return this.result();
  }

  /** Convenience: feed a string where ' ' = space and '\n' = enter. */
  type(s: string): EngineResult {
    let r = this.result();
    for (const ch of s) {
      if (ch === ' ') r = this.process({ type: 'space' });
      else if (ch === '\n') r = this.process({ type: 'enter' });
      else r = this.process({ type: 'key', ch });
    }
    return r;
  }

  get text(): string {
    return this.lastText;
  }

  getMode(): Lang {
    return this.mode;
  }

  setMode(mode: Lang): EngineResult {
    const cur = this.current();
    if (cur && mode !== this.mode) this.lockWithToggle(cur, mode);
    this.mode = mode;
    return this.result();
  }

  get layoutId(): LayoutId {
    return this.layout.id;
  }

  /** Switch keyboard data (3f / 39). Text typed so far is frozen first. */
  setLayout(id: LayoutId): EngineResult {
    if (id !== this.layout.id) {
      this.freeze('');
      this.layout = getLayout(id);
    }
    return this.result();
  }

  setBypass(on: boolean): void {
    this.bypass = on;
    const cur = this.current();
    if (on && cur && !cur.locked) this.lockAsShown(cur);
  }

  learnedWords(): LearnedEntry[] {
    return [...this.learned.values()];
  }

  forgetLearned(keys: string, mode?: Lang): void {
    for (const [k, e] of this.learned) {
      if (e.keys === keys && (!mode || e.mode === mode)) {
        this.learned.delete(k);
        this.revertCounts.delete(k);
      }
    }
    this.rebuildLearnedPrefixes();
  }

  /** Debug: raw candidate scores for a key sequence typed as one word. */
  explain(keys: string, typedMode: Lang = this.mode, complete = true): Array<{ reading: string; lang: string; score: number; prior: number }> {
    const w: Word = { keys, typedMode, interp: typedMode === 'en' ? EN : KO, locked: false, segs: [{ at: 0, mode: typedMode }], sep: '', held: false };
    return this.candidates(w, complete).map((c) => {
      w.interp = c.interp;
      return { reading: this.renderWord(w), lang: c.interp.lang, score: Math.round(c.score * 100) / 100, prior: this.prior(c, w) || 0 };
    });
  }

  // ---- events -------------------------------------------------------------

  private current(): Word | undefined {
    const w = this.words[this.words.length - 1];
    return w && w.sep === '' ? w : undefined;
  }

  private onKey(ch: string): void {
    let cur = this.current();
    if (!cur) {
      cur = {
        keys: '',
        typedMode: this.mode,
        interp: this.mode === 'en' ? EN : KO,
        locked: this.bypass,
        segs: [{ at: 0, mode: this.mode }],
        sep: '',
        held: false,
      };
      this.words.push(cur);
    }
    cur.keys += ch;
    this.update(cur);
  }

  private onSpace(): void {
    const cur = this.current();
    if (cur) {
      this.finish(cur);
      cur.sep = ' ';
    } else if (this.words.length) {
      this.words[this.words.length - 1].sep += ' ';
    } else {
      this.committed += ' ';
    }
  }

  private onEnter(): void {
    const cur = this.current();
    if (cur) this.finish(cur, true);
    this.freeze('\n');
  }

  private onBackspace(): void {
    const cur = this.current();
    if (cur) {
      // one character as shown: a whole syllable (or lone jamo / symbol), or one English letter
      cur.keys = cur.keys.slice(0, cur.keys.length - this.lastCharKeys(cur));
      if (!cur.keys) {
        // the whole word is gone: back to the mode it was started in
        this.words.pop();
        this.mode = cur.typedMode;
        return;
      }
      cur.segs = cur.segs.filter((s, i) => i === 0 || s.at <= cur.keys.length);
      this.update(cur);
    } else if (this.words.length) {
      const last = this.words[this.words.length - 1];
      last.sep = last.sep.slice(0, -1);
      if (!last.sep) {
        last.held = false;
        this.mode = this.modeAfter(last);
      }
    } else if (this.committed) {
      const cps = Array.from(this.committed);
      cps.pop();
      this.committed = cps.join('');
    }
  }

  /** Trailing keys of `w` that render as its last character. */
  private lastCharKeys(w: Word): number {
    const k = w.keys;
    let koFrom: number; // Hangul-rendered keys are k.slice(koFrom); the rest are English letters
    if (w.locked) {
      const last = w.segs[w.segs.length - 1];
      koFrom = last.mode === 'ko' ? last.at : k.length;
    } else {
      koFrom = w.interp.lang === 'ko' ? 0 : w.interp.lang === 'mix' ? w.interp.at : k.length;
    }
    return koFrom < k.length ? this.layout.lastUnitKeys(k.slice(koFrom)) : 1;
  }

  private onToggle(now: number): void {
    const cur = this.current();
    const last = this.lastToggle;
    // Double press right after a word: restore the previous word as typed.
    if (
      !cur &&
      last &&
      last.kind === 'plain' &&
      last.prev &&
      now - last.time <= this.params.doubleToggleMs &&
      this.words.includes(last.prev) &&
      this.isChanged(last.prev)
    ) {
      const w = last.prev;
      this.revert(w);
      this.mode = w.typedMode;
      this.lastToggle = null;
      return;
    }
    // Single press while typing a word that was auto-corrected: restore it.
    if (cur && !cur.locked && this.isChanged(cur)) {
      this.revert(cur);
      this.mode = cur.typedMode;
      this.lastToggle = { time: now, kind: 'revert', prev: null };
      return;
    }
    // Plain Han/Yeong toggle.
    const next = other(this.mode);
    if (cur) this.lockWithToggle(cur, next);
    this.mode = next;
    const prev = !cur && this.words.length ? this.words[this.words.length - 1] : null;
    this.lastToggle = { time: now, kind: 'plain', prev };
  }

  // ---- decisions --------------------------------------------------------

  private update(w: Word): void {
    if (!w.locked) {
      const learnedKey = this.learnKey(w.typedMode, w.keys);
      if (this.learned.has(learnedKey)) {
        w.interp = w.typedMode === 'en' ? EN : KO;
      } else if (!this.learnedPrefixes.has(learnedKey)) {
        const cands = this.candidates(w, false);
        const best = this.pick(cands, w, w.interp, this.params.midHysteresis);
        w.interp = best.interp;
        this.maybeRejudgePrevious(w, cands, best);
      }
    }
    this.mode = this.modeAfter(w);
  }

  /**
   * Word finished by space / enter: judge once more with complete-word scores.
   * If the shown reading is within `holdMargin` of the best one, keep it and
   * mark the word as held so the next word can still settle it. At the end of
   * a line (`final`) no more context will come: the shown reading is kept only
   * within the smaller `lineEndKeepMargin` (wrongly changing a word is worse
   * than leaving it).
   */
  private finish(w: Word, final = false): void {
    if (w.locked) return;
    if (this.learned.has(this.learnKey(w.typedMode, w.keys))) {
      w.interp = w.typedMode === 'en' ? EN : KO;
      w.held = false;
      this.mode = this.modeAfter(w);
      return;
    }
    const cands = this.candidates(w, true);
    const best = this.pick(cands, w, null, 0);
    const adj = (c: Cand) => c.score + this.prior(c, w);
    const shown = cands.find((c) => sameInterp(c.interp, w.interp));
    const keepMargin = final ? this.params.lineEndKeepMargin : this.params.holdMargin;
    if (shown && !sameInterp(best.interp, w.interp) && shown.score > NEG / 2 && adj(best) - adj(shown) < keepMargin) {
      w.held = !final;
    } else {
      w.interp = best.interp;
      w.held = !final && this.margin(cands, w, best) < this.params.holdMargin && this.bothValid(cands);
    }
    this.maybeRejudgePrevious(w, cands, best);
    this.mode = this.modeAfter(w);
  }

  private candidates(w: Word, complete: boolean): Cand[] {
    const keys = w.keys;
    const out: Cand[] = [];
    out.push({ interp: EN, score: this.scorer.scoreEn(keys, complete) });
    // TV, README, PR typed in English mode stay English. (In Korean mode the
    // Shift row of Sebeolsik Final gives digits, e.g. KHK: = 2024.)
    const enTyped = w.typedMode === 'en';
    const allCaps = enTyped && isAllCapsToken(keys);
    // In English mode, Shift+letter read as a digit / symbol by the Hangul layout is unlikely.
    const shiftCost = (part: string) => (enTyped ? this.scorer.shiftSymbolCost(part, this.layout) : 0);
    out.push({ interp: KO, score: allCaps ? NEG : this.scorer.scoreKo(this.layout.compose(keys), complete) + shiftCost(keys) });
    // English head + Korean particle/ending: AI로, deploy했는데, for문
    let best: Cand | null = null;
    const from = Math.max(1, keys.length - 15);
    for (let at = from; at < keys.length; at++) {
      if (!this.layout.isChoKey(keys[at]) || !isSplitBoundary(keys[at - 1])) continue;
      const head = keys.slice(0, at);
      const tail = keys.slice(at);
      if (!headQualifies(head, () => this.scorer.tailIsKnown(this.layout.compose(tail), complete))) continue;
      const s = this.scorer.scoreSplit(keys, at, this.layout, complete, this.params.switchLogProb, enTyped);
      if (s > NEG / 2 && (!best || s > best.score)) best = { interp: { lang: 'mix', at }, score: s };
    }
    if (best) out.push(best);
    return out;
  }

  private prior(c: Cand, w: Word): number {
    const lang = c.interp.lang === 'mix' ? 'mix' : c.interp.lang;
    let p = lang === w.typedMode ? 0 : -this.params.modePrior;
    // Language continuity with the previous word on the same line (a number is no context).
    const prev = this.previousWord(w);
    // ('mix' = English head + Korean tail continues either language.)
    if (prev && !isNeutral(prev.keys) && c.interp.lang !== 'mix' && interpLang(c.interp) !== this.languageOf(prev)) p -= this.params.prevWordPrior;
    return p;
  }

  private previousWord(w: Word): Word | undefined {
    const i = this.words.indexOf(w);
    return i > 0 ? this.words[i - 1] : undefined;
  }

  private languageOf(w: Word): Lang {
    return w.locked ? w.segs[w.segs.length - 1].mode : interpLang(w.interp);
  }

  private pick(cands: Cand[], w: Word, current: Interp | null, hysteresis: number): Cand {
    let best = cands[0];
    let bestScore = -Infinity;
    for (const c of cands) {
      let s = c.score + this.prior(c, w);
      if (current && sameInterp(c.interp, current)) s += hysteresis + 1e-9;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  /** Margin between the chosen candidate and the best one of the other language. */
  private margin(cands: Cand[], w: Word, best: Cand, ctx?: Lang): number {
    const adj = (c: Cand) => c.score + (ctx ? (interpLang(c.interp) === ctx ? this.params.contextPrior : 0) : this.prior(c, w));
    const lang = interpLang(best.interp);
    let otherBest = -Infinity;
    for (const c of cands) if (interpLang(c.interp) !== lang) otherBest = Math.max(otherBest, adj(c));
    return adj(best) - otherBest;
  }

  private bothValid(cands: Cand[]): boolean {
    let en = false;
    let ko = false;
    for (const c of cands) {
      if (c.score <= NEG / 2) continue;
      if (interpLang(c.interp) === 'en') en = true;
      else ko = true;
    }
    return en && ko;
  }

  /**
   * When the current word is decided with confidence, settle the held words
   * before it: their mode / previous-word priors plus a bonus for the language
   * of the word that follows.
   */
  private maybeRejudgePrevious(w: Word, cands: Cand[], best: Cand): void {
    const idx = this.words.indexOf(w);
    if (idx <= 0 || !this.words[idx - 1].held) return;
    // "2024" after a held 2024년 says nothing about the language: wait for letters.
    if (isNeutral(w.keys)) return;
    // Confidence from the key evidence alone (no priors: those already lean
    // towards the held word's language).
    const lang = interpLang(best.interp);
    let otherRaw = -Infinity;
    for (const c of cands) if (interpLang(c.interp) !== lang) otherRaw = Math.max(otherRaw, c.score);
    if (best.score - otherRaw < this.params.confidentMargin) return;
    let ctx = interpLang(best.interp);
    for (let i = idx - 1; i >= 0 && this.words[i].held; i--) {
      const p = this.words[i];
      const pc = this.candidates(p, true);
      let pick = pc[0];
      let ps = -Infinity;
      for (const c of pc) {
        const s = c.score + this.prior(c, p) + (interpLang(c.interp) === ctx ? this.params.contextPrior : 0);
        if (s > ps) {
          ps = s;
          pick = c;
        }
      }
      p.interp = pick.interp;
      p.held = false;
      ctx = interpLang(pick.interp);
    }
  }

  private modeAfter(w: Word): Lang {
    if (w.locked) return w.segs[w.segs.length - 1].mode;
    return interpLang(w.interp);
  }

  // ---- reverting / learning ---------------------------------------------

  private renderAsTyped(w: Word): string {
    let out = '';
    for (let i = 0; i < w.segs.length; i++) {
      const s = w.segs[i];
      const end = i + 1 < w.segs.length ? w.segs[i + 1].at : w.keys.length;
      const part = w.keys.slice(s.at, end);
      out += s.mode === 'en' ? part : this.layout.render(part);
    }
    return out;
  }

  private renderWord(w: Word): string {
    if (w.locked) return this.renderAsTyped(w);
    const k = w.keys;
    switch (w.interp.lang) {
      case 'en':
        return k;
      case 'ko':
        return this.layout.render(k);
      default:
        return k.slice(0, w.interp.at) + this.layout.render(k.slice(w.interp.at));
    }
  }

  private isChanged(w: Word): boolean {
    return !w.locked && this.renderWord(w) !== this.renderAsTyped(w);
  }

  private revert(w: Word): void {
    w.locked = true;
    w.held = false;
    w.segs = [{ at: 0, mode: w.typedMode }];
    const key = this.learnKey(w.typedMode, w.keys);
    const n = (this.revertCounts.get(key) || 0) + 1;
    this.revertCounts.set(key, n);
    if (n >= this.params.learnThreshold) this.addLearned(w.keys, w.typedMode, n);
  }

  /** Manual toggle in the middle of a word: keep what is shown, continue in `next`. */
  private lockWithToggle(w: Word, next: Lang): void {
    if (!w.locked) this.lockAsShown(w);
    w.segs.push({ at: w.keys.length, mode: next });
  }

  private lockAsShown(w: Word): void {
    const shown = w.interp;
    w.segs =
      shown.lang === 'mix'
        ? [
            { at: 0, mode: 'en' },
            { at: shown.at, mode: 'ko' },
          ]
        : [{ at: 0, mode: interpLang(shown) }];
    w.locked = true;
    w.held = false;
  }

  private learnKey(mode: Lang, keys: string): string {
    return mode + '\u0000' + keys;
  }

  private addLearned(keys: string, mode: Lang, count: number): void {
    const text = mode === 'en' ? keys : this.layout.render(keys);
    this.learned.set(this.learnKey(mode, keys), { keys, mode, text, count });
    this.revertCounts.set(this.learnKey(mode, keys), Math.max(count, this.revertCounts.get(this.learnKey(mode, keys)) || 0));
    this.rebuildLearnedPrefixes();
  }

  private rebuildLearnedPrefixes(): void {
    const set = new Set<string>();
    for (const e of this.learned.values()) {
      for (let i = 1; i < e.keys.length; i++) set.add(this.learnKey(e.mode, e.keys.slice(0, i)));
    }
    this.learnedPrefixes = set;
  }

  // ---- output -------------------------------------------------------------

  private freeze(tail: string): void {
    this.committed = this.fullText() + tail;
    this.words = [];
  }

  private fullText(): string {
    let s = this.committed;
    for (const w of this.words) s += this.renderWord(w) + w.sep;
    return s;
  }

  /** Keep per-key work bounded for long-running wrappers (see EngineLimits). */
  private trimHistory(): void {
    const cur = this.current();
    const live = this.words.length - (cur ? 1 : 0);
    if (live > this.maxLiveWords) {
      const n = live - this.maxLiveWords;
      for (const w of this.words.slice(0, n)) this.committed += this.renderWord(w) + w.sep;
      this.words = this.words.slice(n);
    }
    if (this.committed.length > this.maxCommitted) {
      // drop the same prefix from the text the next edit is computed against
      const cut = this.committed.length - Math.floor(this.maxCommitted / 2);
      this.committed = this.committed.slice(cut);
      this.lastText = this.lastText.slice(cut);
    }
  }

  private result(): EngineResult {
    this.trimHistory();
    const text = this.fullText();
    const prev = this.lastText;
    let p = 0;
    const n = Math.min(prev.length, text.length);
    while (p < n && prev.charCodeAt(p) === text.charCodeAt(p)) p++;
    // do not split a surrogate pair
    if (p > 0 && p < n && prev.charCodeAt(p - 1) >= 0xd800 && prev.charCodeAt(p - 1) <= 0xdbff) p--;
    const edit: Edit = { deleteCount: codePoints(prev.slice(p)), insert: text.slice(p) };
    this.lastText = text;
    return {
      text,
      mode: this.mode,
      edit,
      words: this.words.map((w) => ({
        keys: w.keys,
        text: this.renderWord(w),
        sep: w.sep,
        lang: w.locked ? (w.segs.length > 1 ? 'mix' : w.segs[0].mode) : w.interp.lang,
        typedMode: w.typedMode,
        changed: this.isChanged(w),
        held: w.held,
        locked: w.locked,
      })),
      committedLength: codePoints(this.committed),
    };
  }
}

export function createEngine(opts?: EngineOptions): Engine {
  return new Engine(opts);
}
