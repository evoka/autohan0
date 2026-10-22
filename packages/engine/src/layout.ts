// Keyboard layouts generated from libhangul XML (scripts/build_layouts.mjs).

import layoutsJson from './generated/layouts.json';
import { Combiner, composeJamo, jamoKind, renderUnit, type Unit } from './hangul';

export type LayoutId = string;

interface LayoutsFile {
  layouts: Record<string, { id: string; label: string; name: string; combination: string; map: Record<string, string> }>;
  combinations: Record<string, Array<[string, string, string]>>;
}

const FILE = layoutsJson as unknown as LayoutsFile;

export class Layout {
  readonly id: string;
  readonly label: string;
  readonly comb: Combiner;
  private readonly map: Map<string, string>;

  constructor(id: string, label: string, map: Record<string, string>, comb: Combiner) {
    this.id = id;
    this.label = label;
    this.map = new Map(Object.entries(map));
    this.comb = comb;
  }

  /** Value produced by a QWERTY key in Hangul mode (jamo or symbol). Unmapped keys pass through. */
  value(key: string): string {
    return this.map.get(key) ?? key;
  }

  /** True when the key produces a choseong (start of a syllable). */
  isChoKey(key: string): boolean {
    return jamoKind(this.value(key)) === 'cho';
  }

  /**
   * Compose keys into syllables / symbols. `keepAscii` (a word typed in English mode): a key
   * whose Hangul value is a symbol keeps its QWERTY character (Final: `~` stays `~`, not ※), and
   * Shift + punctuation that is a jamo (`!` = ㄲ받침) is that jamo only where it joins a syllable.
   */
  compose(keys: string, keepAscii = false, starts?: number[]): Unit[] {
    const jamos: string[] = [];
    let fallbacks: string[] | undefined;
    for (const k of keys) {
      const v = this.value(k);
      if (keepAscii && jamoKind(v) === 'sym') {
        jamos.push(k);
      } else {
        jamos.push(v);
        if (keepAscii && SHIFTED_PUNCT.has(k)) {
          fallbacks ??= new Array(keys.length).fill('');
          fallbacks[jamos.length - 1] = k;
        }
      }
    }
    return composeJamo(jamos, this.comb, starts, fallbacks);
  }

  /** Number of trailing keys that make up the last rendered character (syllable, jamo or symbol). */
  lastUnitKeys(keys: string, keepAscii = false): number {
    if (!keys) return 0;
    const starts: number[] = [];
    this.compose(keys, keepAscii, starts);
    return keys.length - starts[starts.length - 1];
  }

  render(keys: string, keepAscii = false): string {
    let out = '';
    for (const u of this.compose(keys, keepAscii)) out += renderUnit(u);
    return out;
  }
}

/** Punctuation typed with Shift on a QWERTY keyboard. */
const SHIFTED_PUNCT = new Set('!@#$%^&*()_+{}|:"<>?~');

const combiners = new Map<string, Combiner>();
const cache = new Map<string, Layout>();

export function availableLayouts(): Array<{ id: string; label: string }> {
  return Object.values(FILE.layouts).map((l) => ({ id: l.id, label: l.label }));
}

export function getLayout(id: LayoutId): Layout {
  let l = cache.get(id);
  if (!l) {
    const def = FILE.layouts[id];
    if (!def) throw new Error(`unknown layout: ${id}`);
    let comb = combiners.get(def.combination);
    if (!comb) {
      comb = new Combiner(FILE.combinations[def.combination]);
      combiners.set(def.combination, comb);
    }
    l = new Layout(def.id, def.label, def.map, comb);
    cache.set(id, l);
  }
  return l;
}

/** Combiner shared by the Korean language model (canonical jamo decomposition). */
export function defaultCombiner(): Combiner {
  return getLayout(Object.keys(FILE.layouts)[0]).comb;
}
