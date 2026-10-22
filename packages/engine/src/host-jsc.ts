// Entry point for JavaScriptCore (macOS app): bundles the engine and its data
// into one script that defines globalThis.autohan0Host. Built by
// `npm run build:jsc` into apps/macos/Resources/autohan0-engine.js.
//
// Per-key calls (keyDown / toggle) return one compact string so the native
// side pays for a single JS -> native conversion:
//   <consume 0|1><thenOriginal 0|1><learnedChanged 0|1><mode k|e><deleteCount>:<insert>
//   e.g. "100k2:안녕" = drop the key, delete 2 code points, type "안녕", mode ko.

import type { Lang } from './engine';
import { HostAdapter, type HostAction, type HostOptions } from './host';
import { macKeyCodeFor } from './keymap';
import { availableLayouts, type LayoutId } from './layout';
import { textToKeys } from './keys';

let host: HostAdapter | null = null;

function need(): HostAdapter {
  if (!host) throw new Error('autohan0Host.init() not called');
  return host;
}

function pack(a: HostAction): string {
  return `${a.consume ? 1 : 0}${a.thenOriginal ? 1 : 0}${a.learnedChanged ? 1 : 0}${a.mode === 'ko' ? 'k' : 'e'}${a.deleteCount}:${a.insert}`;
}

const api = {
  /** Build the models (cached after the first call); returns milliseconds spent. */
  init(optionsJson: string): number {
    const t0 = Date.now();
    host = new HostAdapter(JSON.parse(optionsJson) as HostOptions);
    return Date.now() - t0;
  },
  /** Exercise the hot paths on a scratch adapter so the JIT has compiled them before real keys arrive. */
  warmup(rounds: number): number {
    const t0 = Date.now();
    const scratch = new HostAdapter({ mode: 'en' });
    const text = textToKeys('안녕하세요 오늘 회의는 세 시에 시작합니다') + ' git push origin main deploy했는데 README에 ';
    let t = 0;
    for (let r = 0; r < rounds; r++) {
      for (const ch of text) {
        const k = macKeyCodeFor(ch);
        if (k) scratch.macKeyDown(k.keyCode, k.shift ? 1 : 0, (t += 100));
      }
      scratch.toggle((t += 100));
      scratch.caretMoved();
    }
    return Date.now() - t0;
  },
  keyDown(keyCode: number, mods: number, now: number): string {
    return pack(need().macKeyDown(keyCode, mods, now));
  },
  toggle(now: number): string {
    return pack(need().toggle(now));
  },
  caretMoved(): void {
    need().caretMoved();
  },
  mode(): Lang {
    return need().mode;
  },
  setMode(mode: Lang): void {
    need().engine.setMode(mode);
  },
  layout(): string {
    return need().engine.layoutId;
  },
  setLayout(id: string): void {
    need().engine.setLayout(id as LayoutId);
  },
  layouts(): string {
    return JSON.stringify(availableLayouts());
  },
  setBypass(on: boolean): void {
    need().engine.setBypass(on);
  },
  setStrict(on: boolean): void {
    need().setStrict(on);
  },
  setShiftSpaceToggle(on: boolean): void {
    need().shiftSpaceToggle = on;
  },
  learned(): string {
    return JSON.stringify(need().engine.learnedWords());
  },
  forget(keys: string, mode: Lang): void {
    need().engine.forgetLearned(keys, mode);
  },
  forgetAll(): void {
    const e = need().engine;
    for (const w of e.learnedWords()) e.forgetLearned(w.keys, w.mode);
  },
  /** Debug / self-tests: the engine's whole text model. */
  text(): string {
    return need().engine.text;
  },
};

(globalThis as unknown as { autohan0Host: typeof api }).autohan0Host = api;
