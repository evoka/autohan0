// Word list with relative frequencies: exact lookup and prefix probability mass.

export interface LexEntry {
  key: string; // canonical form (lowercase letters / decomposed jamo)
  freq: number; // share of all word tokens in the language (0..1)
}

export class Lexicon {
  private readonly keys: string[];
  private readonly cum: Float64Array; // cum[i] = sum of freq of keys[0..i-1]
  private readonly exact = new Map<string, number>();
  readonly coveredMass: number;

  constructor(entries: LexEntry[], coveredMass?: number) {
    const merged = new Map<string, number>();
    for (const e of entries) merged.set(e.key, (merged.get(e.key) || 0) + e.freq);
    this.keys = [...merged.keys()].sort();
    this.cum = new Float64Array(this.keys.length + 1);
    for (let i = 0; i < this.keys.length; i++) {
      const f = merged.get(this.keys[i])!;
      this.exact.set(this.keys[i], f);
      this.cum[i + 1] = this.cum[i] + f;
    }
    this.coveredMass = coveredMass ?? this.cum[this.keys.length];
  }

  get size(): number {
    return this.keys.length;
  }

  freq(key: string): number {
    return this.exact.get(key) || 0;
  }

  has(key: string): boolean {
    return this.exact.has(key);
  }

  private lowerBound(s: string): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.keys[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Total frequency of words starting with `prefix` (including the word itself). */
  prefixMass(prefix: string): number {
    if (!prefix) return this.cum[this.keys.length];
    const a = this.lowerBound(prefix);
    const b = this.lowerBound(prefix + '￿');
    return this.cum[b] - this.cum[a];
  }
}

/** Parse the generated "zz word word ..." lines (zz = round(zipf * 10)). */
export function parseZipfGroups(text: string, cb: (word: string, zipf: number) => void): void {
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split(' ');
    const zipf = Number(parts[0]) / 10;
    for (let i = 1; i < parts.length; i++) if (parts[i]) cb(parts[i], zipf);
  }
}

export const zipfToFreq = (z: number): number => Math.pow(10, z - 9);
