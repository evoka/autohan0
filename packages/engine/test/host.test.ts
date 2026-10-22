// HostAdapter (OS wrapper glue): macOS key codes in, pass-through / edits out,
// applied to a simulated text field.

import { describe, expect, it } from 'vitest';
import { Engine, HostAdapter, MOD, macKeyCodeFor, qwertyFromMacKeyCode, textToKeys, type HostAction } from '../src/index';

class Field {
  chars: string[] = [];
  passed = 0;
  consumed = 0;
  get text() {
    return this.chars.join('');
  }
  native(ch: string) {
    if (ch === '\b') this.chars.pop();
    else this.chars.push(ch);
  }
  apply(a: HostAction, native: string | null) {
    if (!a.consume) {
      this.passed++;
      if (native !== null) this.native(native);
      return;
    }
    this.consumed++;
    this.chars.splice(this.chars.length - a.deleteCount, a.deleteCount, ...Array.from(a.insert));
    if (a.thenOriginal && native !== null) this.native(native);
  }
}

/** Type a QWERTY string (' ' space, '\n' return, '\b' backspace) through the adapter. */
function typeKeys(host: HostAdapter, field: Field, s: string, start = 0): number {
  let t = start;
  for (const ch of s) {
    t += 120;
    if (ch === '\b') {
      field.apply(host.macKeyDown(0x33, 0, t), '\b');
      continue;
    }
    const k = macKeyCodeFor(ch)!;
    expect(k, `no key for ${ch}`).not.toBeNull();
    field.apply(host.macKeyDown(k.keyCode, k.shift ? MOD.shift : 0, t), ch);
  }
  return t;
}

describe('macOS 키 코드', () => {
  it('키 코드 ↔ QWERTY 문자', () => {
    expect(qwertyFromMacKeyCode(0x26, false)).toBe('j');
    expect(qwertyFromMacKeyCode(0x26, true)).toBe('J');
    expect(qwertyFromMacKeyCode(0x00, false, true)).toBe('A'); // Caps Lock on letters
    expect(qwertyFromMacKeyCode(0x13, false, true)).toBe('2'); // Caps Lock leaves digits
    expect(qwertyFromMacKeyCode(0x2c, true)).toBe('?');
    expect(qwertyFromMacKeyCode(0x7b, false)).toBeNull(); // left arrow
    for (const ch of "abcxyz0123456789-=[]\\;',./`~!@#$%^&*()_+{}|:\"<>?ABZ") {
      const k = macKeyCodeFor(ch)!;
      expect(qwertyFromMacKeyCode(k.keyCode, k.shift)).toBe(ch);
    }
  });
});

describe('HostAdapter', () => {
  it('A: jfsheamfncj4 → 안녕하세요 (모든 키를 고쳐서 넣음)', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    typeKeys(host, f, 'jfsheamfncj4');
    expect(f.text).toBe('안녕하세요');
    expect(host.mode).toBe('ko');
  });

  it('영어 상태에서 영어를 치면 원래 키를 그대로 통과시킨다', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    typeKeys(host, f, 'git push origin main');
    expect(f.text).toBe('git push origin main');
    expect(f.consumed).toBe(0);
  });

  it('가: git push origin main → 영어', () => {
    const host = new HostAdapter({ mode: 'ko' });
    const f = new Field();
    typeKeys(host, f, 'git push origin main');
    expect(f.text).toBe('git push origin main');
    expect(host.mode).toBe('en');
  });

  it('리턴은 고친 뒤 원래 키를 다시 보내고 새로 시작한다', () => {
    const host = new HostAdapter({ mode: 'ko' });
    const f = new Field();
    typeKeys(host, f, 'yes\n');
    expect(f.text).toBe('yes\n');
    expect(host.engine.text).toBe('');
    typeKeys(host, f, 'jfshea');
    expect(f.text).toBe('yes\n안녕');
  });

  it('SPEC 10번 입력이 실제 입력칸에서도 같다', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    typeKeys(host, f, 'READMEjc ntwod ;fa;t3 o9kfmrl9t\nnpm testu/ u/wyel9t');
    expect(f.text).toBe('README에 설치 방법 추가해줘\nnpm test도 돌려줘');
  });

  it('백스페이스: 글자(음절) 하나씩, 모르는 앞글자는 원래 키로', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    f.chars = Array.from('기존 글 ');
    typeKeys(host, f, 'jfshea');
    const passed = f.passed;
    typeKeys(host, f, '\b');
    expect(f.text).toBe('기존 글 안');
    expect(f.passed).toBe(passed + 1); // one syllable = one native backspace
    typeKeys(host, f, '\b');
    expect(f.text).toBe('기존 글 ');
    typeKeys(host, f, '\b'); // model is empty: native backspace
    expect(f.text).toBe('기존 글');
    typeKeys(host, f, 'jfshea\bhea');
    expect(f.text).toBe('기존 글안녕');
  });

  it('Cmd 조합·방향키는 통과시키고 모델을 비운다', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    typeKeys(host, f, 'jfshea');
    expect(host.macKeyDown(0x00, MOD.command, 0).consume).toBe(false); // Cmd+A
    expect(host.engine.text).toBe('');
    typeKeys(host, f, ' ');
    expect(host.macKeyDown(0x7b, 0, 0).consume).toBe(false); // left arrow
    expect(host.engine.text).toBe('');
  });

  it('띄운 뒤 한/영 두 번 → 친 그대로', () => {
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    const t = typeKeys(host, f, 'jfshea ');
    expect(f.text).toBe('안녕 ');
    f.apply(host.toggle(t + 100), null);
    f.apply(host.toggle(t + 250), null);
    expect(f.text).toBe('jfshea ');
    expect(host.mode).toBe('en');
  });

  it('치는 중 한/영 한 번 → 되돌림, 세 번이면 learnedChanged', () => {
    const host = new HostAdapter({ mode: 'en' });
    let changed = false;
    for (let i = 0; i < 3; i++) {
      const f = new Field();
      const t = typeKeys(host, f, 'jfshea', i * 10000);
      const a = host.toggle(t + 100);
      f.apply(a, null);
      expect(f.text).toBe('jfshea');
      changed = changed || a.learnedChanged;
      host.caretMoved();
      host.engine.setMode('en');
    }
    expect(changed).toBe(true);
    expect(host.engine.learnedWords().map((e) => e.keys)).toEqual(['jfshea']);
  });

  it('Shift+Space 한/영 (켰을 때만)', () => {
    const off = new HostAdapter({ mode: 'en' });
    const f = new Field();
    f.apply(off.macKeyDown(0x31, MOD.shift, 0), ' ');
    expect(f.text).toBe(' ');
    expect(off.mode).toBe('en');
    const on = new HostAdapter({ mode: 'en', shiftSpaceToggle: true });
    expect(on.macKeyDown(0x31, MOD.shift, 0).consume).toBe(false);
    expect(on.mode).toBe('ko');
  });

  it('긴 글에서도 모델은 일정 크기로 유지되고 입력칸 결과는 같다', () => {
    const sentence = textToKeys('오늘 회의는 세 시에 시작합니다') + ' git push origin main ';
    const host = new HostAdapter({ mode: 'en' });
    const f = new Field();
    const ref = new Engine({ mode: 'en' });
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t = typeKeys(host, f, sentence, t);
      ref.type(sentence);
    }
    expect(f.text).toBe(ref.text);
    expect(host.engine.text.length).toBeLessThan(700);
  });

  it('엄격 모드: 짧은 명령은 통과하고 긴 한글은 고친다', () => {
    const host = new HostAdapter({ mode: 'en' });
    host.setStrict(true);
    const f = new Field();
    typeKeys(host, f, 'ls -la ');
    expect(f.text).toBe('ls -la ');
    expect(f.consumed).toBe(0);
    typeKeys(host, f, 'jfsheamfncj4 ');
    expect(f.text).toBe('ls -la 안녕하세요 ');
  });
});
