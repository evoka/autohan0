// Behaviour beyond the SPEC acceptance table: composer, edit operations,
// editing events, bypass, manual toggles, key mapping.

import { describe, expect, it } from 'vitest';
import { Engine, getLayout, qwertyFromCode, textToKeys, type EngineResult } from '../src/index';

function applyEdit(buf: string[], r: EngineResult): void {
  buf.splice(buf.length - r.edit.deleteCount, r.edit.deleteCount, ...Array.from(r.edit.insert));
}

describe('세벌식 조합기 (libhangul 표)', () => {
  const l = getLayout('3f');
  it.each([
    ['kk', 'ㄲ'],
    ['kkt', '꺼'],
    ['k/f', '과'],
    ['kvf', '과'],
    ['jdwx', '읽'],
    ['jd@', '읽'],
    ['kf@', '갉'],
    ['jt2', '었'],
    ['jtqq', '었'],
    ['ofS', '찮'],
    ['f', 'ㅏ'],
    ['s', 'ㄴ'],
    ['0g0g', '크크'],
    ['jfsheamfncj4', '안녕하세요'],
  ])('%s → %s', (keys, text) => {
    expect(l.render(keys)).toBe(text);
  });

  it('세벌식 최종 Shift 기호·숫자', () => {
    expect(l.render('JKL')).toBe('123');
    expect(l.render('B')).toBe('?');
    expect(l.render('[')).toBe('(');
  });

  it('390은 기호가 QWERTY와 거의 같다', () => {
    const l39 = getLayout('39');
    expect(l39.render('jfsheamfncj4')).toBe('안녕하세요');
    expect(l39.render('?')).toBe('?');
  });

  it('textToKeys는 scripts/sebeol_keys.py와 같은 키열을 만든다', () => {
    expect(textToKeys('안녕하세요')).toBe('jfsheamfncj4');
    expect(textToKeys('꺼줘')).toBe('kktl9t');
    expect(textToKeys('괜찮아요')).toBe('k/rsofSjfj4');
    expect(textToKeys('읽었다')).toBe('jd@jt2uf');
  });
});

describe('편집 연산', () => {
  it('편집 연산을 차례로 적용하면 전체 텍스트와 같다', () => {
    const e = new Engine({ mode: 'en' });
    const buf: string[] = [];
    const script = 'READMEjc ntwod ;fa;t3 o9kfmrl9t\nnpm testu/ u/wyel9t if jfshea';
    let t = 0;
    for (const ch of script) {
      const r =
        ch === ' '
          ? e.process({ type: 'space' }, (t += 100))
          : ch === '\n'
            ? e.process({ type: 'enter' }, (t += 100))
            : e.process({ type: 'key', ch }, (t += 100));
      applyEdit(buf, r);
      expect(buf.join('')).toBe(r.text);
    }
    for (const ev of [{ type: 'backspace' }, { type: 'backspace' }, { type: 'toggle' }, { type: 'space' }] as const) {
      const r = e.process(ev, (t += 1000));
      applyEdit(buf, r);
      expect(buf.join('')).toBe(r.text);
    }
  });

  it('앞 단어 재판정도 편집 연산으로 나온다 (평 → pea)', () => {
    const e = new Engine({ mode: 'ko' });
    const buf: string[] = [];
    let last: EngineResult | null = null;
    for (const ch of 'pea s') {
      last = ch === ' ' ? e.process({ type: 'space' }) : e.process({ type: 'key', ch });
      applyEdit(buf, last);
    }
    expect(last!.text).toBe('pea s');
    expect(buf.join('')).toBe('pea s');
  });
});

describe('지우기·확정·우회', () => {
  it('백스페이스는 보이는 글자(음절) 하나를 지운다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea');
    let r = e.process({ type: 'backspace' });
    expect(r.text).toBe('안');
    expect(r.edit).toEqual({ deleteCount: 1, insert: '' });
    r = e.process({ type: 'backspace' });
    expect(r.text).toBe('');
    expect(r.edit).toEqual({ deleteCount: 1, insert: '' });
    expect(r.mode).toBe('en');
  });

  it('지운 뒤 이어 치면 그 음절부터 다시 조합된다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea');
    e.process({ type: 'backspace' });
    expect(e.type('heamfncj4').text).toBe('안녕하세요');
  });

  it('음절이 못 된 낱자모·쌍자음·겹받침·겹모음도 한 글자', () => {
    const one = (keys: string, mode: 'en' | 'ko' = 'ko') => {
      const e = new Engine({ mode });
      e.type(keys);
      return e.process({ type: 'backspace' });
    };
    expect(one('jfsh').text).toBe('안'); // 안ㄴ → 안
    expect(one('kk').text).toBe(''); // ㄲ
    expect(one('kktl9t').text).toBe('꺼'); // 꺼줘 → 꺼
    expect(one('jdwxjt2uf').text).toBe('읽었'); // 읽었다 → 읽었
    expect(one('jd@').text).toBe(''); // 읽 (겹받침 전용 키)
    expect(one('k/rs').text).toBe(''); // 괜 (겹모음 연타)
    expect(one('k/rs').edit).toEqual({ deleteCount: 1, insert: '' });
  });

  it('영어는 글자 하나, 섞인 단어는 한글 꼬리부터 음절 단위', () => {
    const e = new Engine({ mode: 'en' });
    e.type('hello');
    expect(e.process({ type: 'backspace' }).text).toBe('hell');
    const m = new Engine({ mode: 'en' });
    m.type('deploymr2hgsuc');
    expect(m.text).toBe('deploy했는데');
    expect(m.process({ type: 'backspace' }).text).toBe('deploy했는');
    expect(m.process({ type: 'backspace' }).text).toBe('deploy했');
    expect(m.process({ type: 'backspace' }).text).toBe('deploy');
    expect(m.process({ type: 'backspace' }).text).toBe('deplo');
  });

  it('한/영 키로 되돌린 단어는 보이는 대로(영어 글자 하나씩) 지운다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea');
    e.process({ type: 'toggle' }, 1000);
    expect(e.text).toBe('jfshea');
    expect(e.process({ type: 'backspace' }, 3000).text).toBe('jfshe');
  });

  it('띄어쓰기를 지우면 앞 단어를 이어 칠 수 있다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea ');
    expect(e.process({ type: 'backspace' }).text).toBe('안녕');
    expect(e.type('mfncj4').text).toBe('안녕하세요');
  });

  it('엔터 뒤 백스페이스는 줄바꿈만 지운다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea\n');
    expect(e.process({ type: 'backspace' }).text).toBe('안녕');
  });

  it('commit(클릭) 뒤에는 앞 단어를 되돌리지 않는다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea ');
    e.process({ type: 'commit' });
    e.process({ type: 'toggle' }, 1000);
    expect(e.process({ type: 'toggle' }, 1100).text).toBe('안녕 ');
  });

  it('commit 뒤 보류 단어는 재판정되지 않는다', () => {
    const e = new Engine({ mode: 'ko' });
    e.type('pea ');
    expect(e.text).toBe('평 ');
    e.process({ type: 'commit' });
    expect(e.type('soup').text).toBe('평 soup');
  });

  it('bypass면 고치지 않는다 (비밀번호 칸 등)', () => {
    const e = new Engine({ mode: 'en' });
    e.setBypass(true);
    expect(e.type('jfshea hr').text).toBe('jfshea hr');
    e.setBypass(false);
    expect(e.type(' jfshea').text).toBe('jfshea hr 안녕');
  });

  it('치는 도중 한/영(자동 변환 없을 때)은 손으로 바꾸기', () => {
    const e = new Engine({ mode: 'en' });
    e.type('AI');
    e.process({ type: 'toggle' }, 1000);
    const r = e.type('y/');
    expect(r.text).toBe('AI로');
    expect(r.words[0].locked).toBe(true);
  });

  it('자판을 바꾸면 그때까지 친 글은 확정된다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jfshea');
    const r = e.setLayout('39');
    expect(r.text).toBe('안녕');
    expect(r.committedLength).toBe(2);
  });

  it('배운 말은 옵션으로 넘겨 다시 쓸 수 있다', () => {
    const e = new Engine({ mode: 'en', learned: [{ keys: 'jfshea', mode: 'en', text: 'jfshea', count: 3 }] });
    expect(e.type('jfshea').text).toBe('jfshea');
    expect(e.learnedWords()).toHaveLength(1);
  });

  it('ㅋㅋ ㅎㅎ 같은 자모 이모티콘은 한글 상태에서 그대로', () => {
    const e = new Engine({ mode: 'ko' });
    expect(e.type('00 mm').text).toBe('ㅋㅋ ㅎㅎ');
  });

  it('보류 표시: 양쪽 다 말이 되는 단어', () => {
    const e = new Engine({ mode: 'ko' });
    const r = e.type('pea ');
    expect(r.words[0].held).toBe(true);
    expect(e.type('soup').words[0].held).toBe(false);
  });
});

describe('물리 키 → QWERTY', () => {
  it.each([
    ['KeyA', false, 'a'],
    ['KeyA', true, 'A'],
    ['Digit2', true, '@'],
    ['Slash', false, '/'],
    ['Slash', true, '?'],
    ['Semicolon', false, ';'],
    ['Quote', true, '"'],
    ['Space', false, null],
  ] as const)('%s shift=%s → %s', (code, shift, ch) => {
    expect(qwertyFromCode(code, shift)).toBe(ch);
  });
});

describe('모드', () => {
  it('자동으로 바뀐 단어를 다 지우면 처음 모드로 돌아간다', () => {
    const e = new Engine({ mode: 'en' });
    e.type('jf');
    expect(e.getMode()).toBe('ko');
    const r = e.process({ type: 'backspace' }); // 아 = one character
    expect(r.text).toBe('');
    expect(r.mode).toBe('en');
  });
});

describe('줄 끝 판정', () => {
  it('엔터에서는 보류를 풀고 정한다 (가: new⏎ → new)', () => {
    expect(new Engine({ mode: 'ko' }).type('new ').text).toBe('셜 ');
    expect(new Engine({ mode: 'ko' }).type('new\n').text).toBe('new\n');
    expect(new Engine({ mode: 'ko' }).type('new feature').text).toBe('new feature');
  });

  it('엔터에서도 차이가 작으면 보이던 쪽을 둔다 (가: 차⏎ → 차)', () => {
    const r = new Engine({ mode: 'ko' }).type('of\n');
    expect(r.text).toBe('차\n');
    expect(new Engine({ mode: 'en' }).type('of\n').text).toBe('of\n');
  });
});

describe('숫자·따옴표 머리 + 한글 꼬리', () => {
  it.each([
    ['3kr', '3개'],
    ['10;9s', '10분'],
    ['v0.8.5y/', 'v0.8.5로'],
    ['500jgw', '500을'],
    ['3,000j9tsjgw', '3,000원을'],
    ['3.14hgs', '3.14는'],
    ['"contents"yfk/', '"contents"라고'],
    ["World'hgs", "World'는"],
  ])('A: %s → %s', (keys, text) => {
    expect(new Engine({ mode: 'en' }).type(keys + ' ').text).toBe(text + ' ');
  });

  it.each([
    ['Nlc', 'N제'],
    ['nlc', 'n제'],
    ['xo9x', 'x축'],
    ['Bkg3', 'B급'],
    ["A'dz", 'A팀'],
    ['Khgs', 'K는'],
    ['UIkfWjgskts', 'UI같은건'],
    ['APIygw', 'API를'],
    ['PRjgw', 'PR을'],
    ['CIkf', 'CI가'],
  ])('한 글자·약어 머리 A: %s → %s', (keys, text) => {
    expect(new Engine({ mode: 'en' }).type(keys + ' ').text).toBe(text + ' ');
  });

  it.each([
    ['IY', 'IY'],
    ['brb', 'brb'],
    ['np', 'np'],
  ])('A 모드 대문자·약어는 그대로: %s', (keys, text) => {
    expect(new Engine({ mode: 'en' }).type(keys + ' ').text).toBe(text + ' ');
  });

  it.each([
    ['k8sjc', 'k8s에'],
    ['v2.0.0jgy/', 'v2.0.0으로'],
    ['3e-4y/', '3e-4로'],
    ['F1jd', 'F1이'],
  ])('코드 토큰 머리 A: %s → %s', (keys, text) => {
    expect(new Engine({ mode: 'en' }).type(keys + ' ').text).toBe(text + ' ');
  });

  it.each(['h264', 'mp3', '0xff', 'v2', 'build.sh', 'k8s', 'p95'])('코드 토큰은 그대로: %s', (keys) => {
    expect(new Engine({ mode: 'en' }).type(keys + ' ').text).toBe(keys + ' ');
  });

  it('숫자 뒤 단위는 다음 단어가 약해도 보류를 푼다 (2024hes 4;9skd → 2024년 4분기)', () => {
    expect(new Engine({ mode: 'en' }).type('2024hes 4;9skd\n').text).toBe('2024년 4분기\n');
  });

  it('가 모드의 Shift 숫자는 그대로 (KHK:hes → 2024년, OK → 82)', () => {
    expect(new Engine({ mode: 'ko' }).type('KHK:hes ').text).toBe('2024년 ');
    expect(new Engine({ mode: 'ko' }).type('OK ').text).toBe('82 ');
  });

  it('한 글자 머리 뒤 한글은 음절 단위로 지워진다 (Nlc␣ ⌫⌫ → N)', () => {
    const e = new Engine({ mode: 'en' });
    expect(e.type('Nlc ').text).toBe('N제 ');
    e.process({ type: 'backspace' });
    expect(e.process({ type: 'backspace' }).text).toBe('N');
  });

  it('숫자 머리 뒤 한글은 음절 단위로 지워진다 (3kr␣ ⌫⌫ → 3)', () => {
    // mid-word the shown "3kr" is kept (hysteresis); the space settles it to 3개
    const e = new Engine({ mode: 'en' });
    expect(e.type('3kr ').text).toBe('3개 ');
    e.process({ type: 'backspace' });
    const r = e.process({ type: 'backspace' });
    expect(r.text).toBe('3');
    expect(r.mode).toBe('en');
  });
});
