// Interpolated Witten-Bell character n-gram model over small integer alphabets.
// Trained at load time from weighted word lists; scores word prefixes and
// complete words (with an end-of-word symbol).
//
// Witten-Bell backoff compounds when a rare transition is unseen at every
// order (e.g. 주 -> ㅋ), so the final probability is mixed with a coarse
// "class bigram" floor: P(symbol | class of previous symbol). For Korean the
// classes are initial / medial / final jamo, i.e. syllable structure.

const BOUNDARY = 0; // begin/end of word
const BASE = 64; // symbol ids must be < BASE

export class NgramModel {
  readonly order: number;
  private readonly symbolIds = new Map<string, number>();
  private readonly counts: Array<Map<number, number>> = [];
  private readonly ctxTotal: Array<Map<number, number>> = [];
  private readonly ctxTypes: Array<Map<number, number>> = [];
  private unigramTotal = 0;
  private vocab = 1;
  private readonly memo = new Map<string, number>();
  private readonly classOf: (ch: string) => number;
  private readonly floorWeight: number;
  private readonly symClass: number[] = [0];
  private readonly classCounts = new Map<number, number>();
  private readonly classTotal = new Map<number, number>();
  private dirty = false;

  /**
   * @param classOf symbol class (0..BASE-2) for the floor model; previous-symbol class
   * @param floorWeight mixture weight of the class floor model
   */
  constructor(order: number, alphabet: string, classOf: (ch: string) => number = () => 0, floorWeight = 0.1) {
    this.order = order;
    this.classOf = classOf;
    this.floorWeight = floorWeight;
    for (const ch of alphabet) this.idOf(ch, true);
    for (let k = 0; k < order; k++) {
      this.counts.push(new Map());
      this.ctxTotal.push(new Map());
      this.ctxTypes.push(new Map());
    }
  }

  private idOf(ch: string, create = false): number {
    let id = this.symbolIds.get(ch);
    if (id === undefined) {
      if (!create) return -1;
      id = this.symbolIds.size + 1;
      if (id >= BASE) throw new Error('alphabet too large');
      this.symbolIds.set(ch, id);
      this.symClass[id] = this.classOf(ch) + 1;
      this.vocab = this.symbolIds.size + 1;
    }
    return id;
  }

  /** Add one word (string of symbols) with a weight. Unknown symbols extend the alphabet. */
  add(word: string, weight: number): void {
    const ids: number[] = [];
    for (const ch of word) ids.push(this.idOf(ch, true));
    ids.push(BOUNDARY);
    for (let i = 0; i < ids.length; i++) {
      const w = ids[i];
      let ctx = 0;
      let mul = 1;
      for (let k = 0; k < this.order; k++) {
        // context of length k = ids[i-k .. i-1], padded with BOUNDARY
        if (k > 0) {
          const p = i - k;
          if (p >= 0) ctx += ids[p] * mul;
          mul *= BASE;
        }
        const key = ctx * BASE + w;
        const counts = this.counts[k];
        counts.set(key, (counts.get(key) || 0) + weight);
      }
      const pcKey = (i > 0 ? this.symClass[ids[i - 1]] : 0) * BASE + w;
      this.classCounts.set(pcKey, (this.classCounts.get(pcKey) || 0) + weight);
    }
    this.unigramTotal += weight * ids.length;
    this.dirty = true;
  }

  /** Derive per-context totals and type counts from the n-gram counts (call after training). */
  finalize(): void {
    for (let k = 0; k < this.order; k++) {
      const total = new Map<number, number>();
      const types = new Map<number, number>();
      for (const [key, c] of this.counts[k]) {
        const ctx = Math.floor(key / BASE);
        total.set(ctx, (total.get(ctx) || 0) + c);
        types.set(ctx, (types.get(ctx) || 0) + 1);
      }
      this.ctxTotal[k] = total;
      this.ctxTypes[k] = types;
    }
    this.classTotal.clear();
    for (const [key, c] of this.classCounts) {
      const pc = Math.floor(key / BASE);
      this.classTotal.set(pc, (this.classTotal.get(pc) || 0) + c);
    }
    this.memo.clear();
    this.dirty = false;
  }

  /** P(w | context ids) with interpolation down to an add-one unigram. */
  private prob(ctxIds: ReadonlyArray<number>, w: number): number {
    if (this.dirty) this.finalize();
    // unigram
    let p = ((this.counts[0].get(w) || 0) + 1) / (this.unigramTotal + this.vocab);
    let ctx = 0;
    let mul = 1;
    for (let k = 1; k < this.order; k++) {
      const pos = ctxIds.length - k;
      if (pos >= 0) ctx += ctxIds[pos] * mul;
      mul *= BASE;
      const total = this.ctxTotal[k].get(ctx);
      if (total === undefined) break; // longer contexts are unseen too
      const types = this.ctxTypes[k].get(ctx) || 0;
      const c = this.counts[k].get(ctx * BASE + w) || 0;
      p = (c + types * p) / (total + types);
    }
    const n = ctxIds.length;
    const pc = n > 0 ? this.symClass[ctxIds[n - 1]] || 0 : 0;
    const floor = ((this.classCounts.get(pc * BASE + w) || 0) + 0.5) / ((this.classTotal.get(pc) || 0) + 0.5 * this.vocab);
    return (1 - this.floorWeight) * p + this.floorWeight * floor;
  }

  /**
   * Natural-log probability of a word prefix (no end symbol) or a complete word
   * (with end symbol). Unknown symbols get a tiny floor probability.
   */
  logProb(word: string, complete: boolean): number {
    const memoKey = (complete ? '$' : '^') + word;
    const hit = this.memo.get(memoKey);
    if (hit !== undefined) return hit;
    let lp: number;
    if (word.length === 0) {
      lp = complete ? Math.log(this.prob([], BOUNDARY)) : 0;
    } else {
      // incremental: reuse the prefix score of word minus its last symbol
      const chars = Array.from(word);
      const head = chars.slice(0, -1).join('');
      lp = this.logProb(head, false);
      const ids: number[] = [];
      for (const ch of chars) ids.push(this.idOf(ch));
      const n = ids.length;
      const last = ids[n - 1];
      // Context = up to order-1 previous ids; positions before the word start
      // are treated as BOUNDARY inside prob(), matching training.
      lp += last < 0 ? Math.log(1e-7) : Math.log(this.prob(ids.slice(Math.max(0, n - this.order), n - 1), last));
      if (complete) lp += Math.log(this.prob(ids.slice(Math.max(0, n - this.order + 1)), BOUNDARY));
    }
    if (this.memo.size > 20000) this.memo.clear();
    this.memo.set(memoKey, lp);
    return lp;
  }
}
