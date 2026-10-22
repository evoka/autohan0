// Glue for OS-level wrappers (macOS menu bar app): physical key events in,
// "let the key through" or "drop it and apply this edit" out.
//
// The wrapper keeps the OS input source on a QWERTY layout (ABC). Whenever the
// engine's edit is exactly what the original key would do anyway (plain
// English typing, ordinary backspace), the original event is passed through
// untouched; otherwise the wrapper drops it and replays the edit as
// Backspace × deleteCount + the inserted text.

import { Engine, type EngineOptions, type EngineResult, type Lang } from './engine';
import { MAC_KEY, qwertyFromMacKeyCode } from './keymap';

/** Modifier bit mask passed by the wrapper. */
export const MOD = { shift: 1, capsLock: 2, control: 4, option: 8, command: 16 } as const;

export interface HostAction {
  /** true: drop the original key event and apply the edit instead */
  consume: boolean;
  /** Backspaces to send (code points before the caret) */
  deleteCount: number;
  /** text to type after the backspaces */
  insert: string;
  /** after the edit, re-send the original key (Return keeps its own meaning, e.g. "send") */
  thenOriginal: boolean;
  mode: Lang;
  /** the learned-word list changed and should be saved */
  learnedChanged: boolean;
}

export interface HostOptions extends EngineOptions {
  /** Shift+Space acts as the Han/Yeong key */
  shiftSpaceToggle?: boolean;
}

/** Live words / frozen text kept by a long-running wrapper (older text is dropped from the model). */
const HOST_LIMITS = { maxLiveWords: 24, maxCommitted: 400 };

export class HostAdapter {
  readonly engine: Engine;
  shiftSpaceToggle: boolean;
  private learnedSig: string;

  constructor(opts: HostOptions = {}) {
    this.engine = new Engine({ ...HOST_LIMITS, ...opts });
    this.shiftSpaceToggle = opts.shiftSpaceToggle ?? false;
    this.learnedSig = this.learnedSignature();
  }

  /** Changes when a word is added, removed, or reverted once more (count 1 → 2 is the moment it is learned). */
  private learnedSignature(): string {
    let n = 0;
    let counts = 0;
    for (const e of this.engine.learnedWords()) {
      n++;
      counts += e.count;
    }
    return `${n}:${counts}`;
  }

  get mode(): Lang {
    return this.engine.getMode();
  }

  /** A key went down. `mods` is a MOD bit mask, `now` in milliseconds. */
  macKeyDown(keyCode: number, mods: number, now: number): HostAction {
    if (mods & (MOD.control | MOD.option | MOD.command)) {
      // shortcuts (copy/paste/undo/select all …) may change text or move the caret
      this.caretMoved();
      return this.pass();
    }
    const shift = (mods & MOD.shift) !== 0;
    switch (keyCode) {
      case MAC_KEY.space:
        if (shift && this.shiftSpaceToggle) return this.toggle(now);
        return this.fromResult(this.engine.process({ type: 'space' }, now), ' ');
      case MAC_KEY.return:
      case MAC_KEY.keypadEnter: {
        const r = this.engine.process({ type: 'enter' }, now);
        const insert = r.edit.insert.endsWith('\n') ? r.edit.insert.slice(0, -1) : r.edit.insert;
        // Return often submits or leaves the field: start fresh.
        this.engine.process({ type: 'reset' }, now);
        if (r.edit.deleteCount === 0 && insert === '') return this.pass();
        return this.action(true, r.edit.deleteCount, insert, true);
      }
      case MAC_KEY.delete: {
        const r = this.engine.process({ type: 'backspace' }, now);
        // Nothing known before the caret, or a plain one-character delete: native backspace.
        if (r.edit.insert === '' && r.edit.deleteCount <= 1) return this.pass();
        return this.fromResult(r, null);
      }
    }
    const ch = qwertyFromMacKeyCode(keyCode, shift, (mods & MOD.capsLock) !== 0);
    if (ch === null) {
      // Tab, Escape, arrows, Home/End, function and keypad keys: caret or focus may move
      this.caretMoved();
      return this.pass();
    }
    return this.fromResult(this.engine.process({ type: 'key', ch }, now), ch);
  }

  /** The Han/Yeong key (input-source switch, Shift+Space or the menu). */
  toggle(now: number): HostAction {
    const r = this.engine.process({ type: 'toggle' }, now);
    return this.action(r.edit.deleteCount > 0 || r.edit.insert !== '', r.edit.deleteCount, r.edit.insert, false);
  }

  /** The front app is a terminal / editor: see Engine.setStrict. */
  setStrict(on: boolean): void {
    this.engine.setStrict(on);
  }

  /** Mouse click, app / window switch, arrow keys: the text before the caret is unknown now. */
  caretMoved(): void {
    this.engine.process({ type: 'commit' });
    this.engine.process({ type: 'reset' });
  }

  private fromResult(r: EngineResult, native: string | null): HostAction {
    const { deleteCount, insert } = r.edit;
    if (native !== null && deleteCount === 0 && insert === native) return this.pass();
    return this.action(true, deleteCount, insert, false);
  }

  private pass(): HostAction {
    return this.action(false, 0, '', false);
  }

  private action(consume: boolean, deleteCount: number, insert: string, thenOriginal: boolean): HostAction {
    const sig = this.learnedSignature();
    const learnedChanged = sig !== this.learnedSig;
    this.learnedSig = sig;
    return { consume, deleteCount, insert, thenOriginal, mode: this.engine.getMode(), learnedChanged };
  }
}
