// Hangul jamo helpers and the Sebeolsik (jaso keyboard) composer.
//
// Layout values are conjoining jamo: choseong U+1100–1112, jungseong U+1161–1175,
// jongseong U+11A8–11C2. Anything else is a plain symbol emitted as-is.

export type JamoKind = 'cho' | 'jung' | 'jong' | 'sym';

export function jamoKind(ch: string): JamoKind {
  const c = ch.charCodeAt(0);
  if (c >= 0x1100 && c <= 0x115f) return 'cho';
  if (c >= 0x1160 && c <= 0x11a7) return 'jung';
  if (c >= 0x11a8 && c <= 0x11ff) return 'jong';
  return 'sym';
}

// Choseong / jongseong -> compatibility jamo (U+3131..) for display of incomplete syllables.
const CHO_COMPAT = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JONG_COMPAT = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

export function toCompat(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x1100 && c <= 0x1112) return CHO_COMPAT[c - 0x1100];
  if (c >= 0x1161 && c <= 0x1175) return String.fromCharCode(0x314f + (c - 0x1161));
  if (c >= 0x11a8 && c <= 0x11c2) return JONG_COMPAT[c - 0x11a8];
  return ch;
}

/** One composed unit: a (possibly incomplete) syllable or a symbol. Empty string = absent. */
export interface Unit {
  cho: string;
  jung: string;
  jong: string;
  sym: string;
}

export function renderUnit(u: Unit): string {
  if (u.sym) return u.sym;
  if (u.cho && u.jung) {
    const l = u.cho.charCodeAt(0) - 0x1100;
    const v = u.jung.charCodeAt(0) - 0x1161;
    const t = u.jong ? u.jong.charCodeAt(0) - 0x11a7 : 0;
    if (l >= 0 && l < 19 && v >= 0 && v < 21 && t >= 0 && t < 28) {
      return String.fromCharCode(0xac00 + (l * 21 + v) * 28 + t);
    }
  }
  return toCompat(u.cho) + toCompat(u.jung) + toCompat(u.jong);
}

export function isCompleteSyllable(u: Unit): boolean {
  return !u.sym && !!u.cho && !!u.jung;
}

export function isChoOnly(u: Unit): boolean {
  return !u.sym && !!u.cho && !u.jung && !u.jong;
}

/** Decompose a precomposed Hangul syllable into conjoining jamo (cho, jung, jong). */
export function decomposeSyllable(ch: string): [string, string, string] | null {
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return null;
  const s = c - 0xac00;
  const l = Math.floor(s / 588);
  const v = Math.floor((s % 588) / 28);
  const t = s % 28;
  return [
    String.fromCharCode(0x1100 + l),
    String.fromCharCode(0x1161 + v),
    t ? String.fromCharCode(0x11a7 + t) : '',
  ];
}

/** Combination table (libhangul hangul-combination-*.xml) with inverse for canonical decomposition. */
export class Combiner {
  private readonly forward = new Map<string, string>();
  private readonly inverse = new Map<string, [string, string]>();
  private readonly canonCache = new Map<string, string>();

  constructor(rules: ReadonlyArray<readonly [string, string, string]>) {
    for (const [a, b, r] of rules) {
      // Only keep combinations that stay within one jamo class (e.g. cho+cho -> cho).
      // libhangul's default table also lists cho+cho -> jong pairs used by Dubeolsik.
      const k = jamoKind(r);
      if (jamoKind(a) !== k || jamoKind(b) !== k) continue;
      this.forward.set(a + b, r);
      if (!this.inverse.has(r)) this.inverse.set(r, [a, b]);
    }
  }

  combine(a: string, b: string): string | undefined {
    return this.forward.get(a + b);
  }

  /** Decompose a compound jamo into basic jamo (ㄲ -> ㄱㄱ, ㅘ -> ㅗㅏ, ㄺ -> ㄹㄱ). */
  canonical(j: string): string {
    let r = this.canonCache.get(j);
    if (r === undefined) {
      const pair = this.inverse.get(j);
      r = pair ? this.canonical(pair[0]) + this.canonical(pair[1]) : j;
      this.canonCache.set(j, r);
    }
    return r;
  }

  /** Canonical jamo string of a precomposed Hangul word, or null if it has non-syllables. */
  canonicalWord(word: string): string | null {
    let out = '';
    for (const ch of word) {
      const d = decomposeSyllable(ch);
      if (!d) return null;
      out += this.canonical(d[0]) + this.canonical(d[1]) + (d[2] ? this.canonical(d[2]) : '');
    }
    return out;
  }
}

/**
 * Compose a jamo/symbol sequence into units, libhangul jaso-keyboard style.
 * `starts`, when given, receives the index of the jamo that opened each unit.
 */
export function composeJamo(jamos: ReadonlyArray<string>, comb: Combiner, starts?: number[]): Unit[] {
  const units: Unit[] = [];
  const push = (u: Unit, at: number) => {
    units.push(u);
    starts?.push(at);
  };
  for (let i = 0; i < jamos.length; i++) {
    const j = jamos[i];
    const kind = jamoKind(j);
    const cur = units.length ? units[units.length - 1] : undefined;
    const open = cur && !cur.sym ? cur : undefined;
    if (kind === 'cho') {
      if (open && open.cho && !open.jung && !open.jong) {
        const c = comb.combine(open.cho, j);
        if (c) {
          open.cho = c;
          continue;
        }
      }
      push({ cho: j, jung: '', jong: '', sym: '' }, i);
    } else if (kind === 'jung') {
      if (open && open.jung && !open.jong) {
        const c = comb.combine(open.jung, j);
        if (c) {
          open.jung = c;
          continue;
        }
      } else if (open && open.cho && !open.jung && !open.jong) {
        open.jung = j;
        continue;
      }
      push({ cho: '', jung: j, jong: '', sym: '' }, i);
    } else if (kind === 'jong') {
      if (open && open.jong) {
        const c = comb.combine(open.jong, j);
        if (c) {
          open.jong = c;
          continue;
        }
      } else if (open && open.cho && open.jung) {
        open.jong = j;
        continue;
      }
      push({ cho: '', jung: '', jong: j, sym: '' }, i);
    } else {
      push({ cho: '', jung: '', jong: '', sym: j }, i);
    }
  }
  return units;
}
