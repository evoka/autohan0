// Inverse of the layout: Hangul text -> the QWERTY keys a Sebeolsik typist presses.
// Used by tests and the evaluation script (same idea as scripts/sebeol_keys.py).

import { decomposeSyllable, jamoKind } from './hangul';
import { getLayout, type LayoutId } from './layout';

const UNSHIFTED = /^[a-z0-9`\-=[\]\\;',./]$/;

export function textToKeys(text: string, layoutId: LayoutId = '3f'): string {
  const layout = getLayout(layoutId);
  const inv = new Map<string, string>();
  // prefer unshifted keys; among those, '/' and '9' come before 'v' and 'b' (sorted order)
  const keys: string[] = [];
  for (let c = 0x21; c < 0x7f; c++) keys.push(String.fromCharCode(c));
  keys.sort((a, b) => Number(!UNSHIFTED.test(a)) - Number(!UNSHIFTED.test(b)) || (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) {
    const v = layout.value(k);
    if (!inv.has(v)) inv.set(v, k);
  }
  const jamoKeys = (j: string): string => {
    const k = inv.get(j);
    if (k !== undefined) return k;
    const canon = layout.comb.canonical(j);
    if (canon === j) throw new Error(`no key for ${j}`);
    let out = '';
    for (const c of canon) out += jamoKeys(c);
    return out;
  };
  let out = '';
  for (const ch of text) {
    const d = decomposeSyllable(ch);
    if (d) {
      out += jamoKeys(d[0]) + jamoKeys(d[1]) + (d[2] ? jamoKeys(d[2]) : '');
    } else if (ch === ' ' || ch === '\n') {
      out += ch;
    } else {
      const k = inv.get(ch);
      if (k === undefined || jamoKind(ch) !== 'sym') throw new Error(`no key for ${JSON.stringify(ch)}`);
      out += k;
    }
  }
  return out;
}
