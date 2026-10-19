// KeyboardEvent.code (physical key) + Shift -> the ASCII character a US QWERTY
// layout produces. Used by wrappers so the engine always gets physical keys,
// regardless of the OS input source.

const CODE_MAP: Record<string, [string, string]> = {
  Backquote: ['`', '~'],
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Digit0: ['0', ')'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
};

export function qwertyFromCode(code: string, shift: boolean): string | null {
  if (code.startsWith('Key') && code.length === 4) {
    const c = code[3].toLowerCase();
    return shift ? c.toUpperCase() : c;
  }
  const m = CODE_MAP[code];
  return m ? m[shift ? 1 : 0] : null;
}

// macOS virtual key codes (Carbon kVK_ANSI_*) -> US QWERTY [unshifted, shifted].
const MAC_KEYS: Record<number, [string, string]> = {
  0x00: ['a', 'A'], 0x01: ['s', 'S'], 0x02: ['d', 'D'], 0x03: ['f', 'F'], 0x04: ['h', 'H'],
  0x05: ['g', 'G'], 0x06: ['z', 'Z'], 0x07: ['x', 'X'], 0x08: ['c', 'C'], 0x09: ['v', 'V'],
  0x0b: ['b', 'B'], 0x0c: ['q', 'Q'], 0x0d: ['w', 'W'], 0x0e: ['e', 'E'], 0x0f: ['r', 'R'],
  0x10: ['y', 'Y'], 0x11: ['t', 'T'], 0x12: ['1', '!'], 0x13: ['2', '@'], 0x14: ['3', '#'],
  0x15: ['4', '$'], 0x16: ['6', '^'], 0x17: ['5', '%'], 0x18: ['=', '+'], 0x19: ['9', '('],
  0x1a: ['7', '&'], 0x1b: ['-', '_'], 0x1c: ['8', '*'], 0x1d: ['0', ')'], 0x1e: [']', '}'],
  0x1f: ['o', 'O'], 0x20: ['u', 'U'], 0x21: ['[', '{'], 0x22: ['i', 'I'], 0x23: ['p', 'P'],
  0x25: ['l', 'L'], 0x26: ['j', 'J'], 0x27: ["'", '"'], 0x28: ['k', 'K'], 0x29: [';', ':'],
  0x2a: ['\\', '|'], 0x2b: [',', '<'], 0x2c: ['/', '?'], 0x2d: ['n', 'N'], 0x2e: ['m', 'M'],
  0x2f: ['.', '>'], 0x32: ['`', '~'],
};

/** macOS virtual key code + Shift / Caps Lock -> the character a US QWERTY layout produces. */
export function qwertyFromMacKeyCode(keyCode: number, shift: boolean, capsLock = false): string | null {
  const m = MAC_KEYS[keyCode];
  if (!m) return null;
  const letter = m[0] >= 'a' && m[0] <= 'z';
  return m[shift !== (letter && capsLock) ? 1 : 0];
}

export const MAC_KEY = {
  return: 0x24,
  tab: 0x30,
  space: 0x31,
  delete: 0x33,
  escape: 0x35,
  keypadEnter: 0x4c,
} as const;

/** Inverse of qwertyFromMacKeyCode for tests and self-tests: QWERTY char -> key code + Shift. */
export function macKeyCodeFor(ch: string): { keyCode: number; shift: boolean } | null {
  if (ch === ' ') return { keyCode: MAC_KEY.space, shift: false };
  if (ch === '\n') return { keyCode: MAC_KEY.return, shift: false };
  for (const [code, pair] of Object.entries(MAC_KEYS)) {
    if (pair[0] === ch) return { keyCode: Number(code), shift: false };
    if (pair[1] === ch) return { keyCode: Number(code), shift: true };
  }
  return null;
}
