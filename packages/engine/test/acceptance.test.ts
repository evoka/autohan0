// SPEC.md section 7 acceptance tests (Sebeolsik Final unless noted).
// Notation: "A:" starts in English mode, "가:" in Korean mode; ' ' = space, '\n' = enter.

import { describe, expect, it } from 'vitest';
import { Engine, type EngineResult, type Lang } from '../src/index';

const A: Lang = 'en';
const KA: Lang = 'ko';

function typeAll(start: Lang, input: string, layout = '3f'): { engine: Engine; results: EngineResult[] } {
  const engine = new Engine({ mode: start, layout });
  const results: EngineResult[] = [];
  for (const ch of input) {
    if (ch === ' ') results.push(engine.process({ type: 'space' }));
    else if (ch === '\n') results.push(engine.process({ type: 'enter' }));
    else results.push(engine.process({ type: 'key', ch }));
  }
  return { engine, results };
}

function run(start: Lang, input: string, layout = '3f'): EngineResult {
  const { results } = typeAll(start, input, layout);
  return results[results.length - 1];
}

describe('필수', () => {
  it('1. A: jfsheamfncj4 → 안녕하세요 (늦어도 jfshea에서 한글)', () => {
    const { results } = typeAll(A, 'jfsheamfncj4');
    expect(results[5].text).toBe('안녕');
    expect(results[5].mode).toBe('ko');
    const last = results[results.length - 1];
    expect(last.text).toBe('안녕하세요');
    expect(last.mode).toBe('ko');
  });

  it('2. A: jfshea → 안녕', () => {
    expect(run(A, 'jfshea').text).toBe('안녕');
  });

  it('3. 가: git push origin main → 영어, 모드 A', () => {
    const r = run(KA, 'git push origin main');
    expect(r.text).toBe('git push origin main');
    expect(r.mode).toBe('en');
  });

  it('4. 가: hello → hello', () => {
    expect(run(KA, 'hello').text).toBe('hello');
  });

  it('5. 가: npm test → npm test', () => {
    expect(run(KA, 'npm test').text).toBe('npm test');
  });

  it('6. A: AIy/ 와 AIyv → AI로', () => {
    expect(run(A, 'AIy/').text).toBe('AI로');
    expect(run(A, 'AIyv').text).toBe('AI로');
  });

  it('7. A: deploymr2hgsuc jcytkf hfj4 → deploy했는데 에러가 나요', () => {
    expect(run(A, 'deploymr2hgsuc jcytkf hfj4').text).toBe('deploy했는데 에러가 나요');
  });

  it('8. A: Q4 y/ugir3 o/jfs k/aj5ugyej4 → Q4 로드맵 초안 공유드려요', () => {
    expect(run(A, 'Q4 y/ugir3 o/jfs k/aj5ugyej4').text).toBe('Q4 로드맵 초안 공유드려요');
  });

  it('9. A: Figma yda0g ;/hrugydwkcj4 → Figma 링크 보내드릴게요', () => {
    expect(run(A, 'Figma yda0g ;/hrugydwkcj4').text).toBe('Figma 링크 보내드릴게요');
  });

  it('10. 엔터 뒤 앞줄은 안 건드림', () => {
    const { results } = typeAll(A, 'READMEjc ntwod ;fa;t3 o9kfmrl9t\nnpm testu/ u/wyel9t');
    const last = results[results.length - 1];
    expect(last.text).toBe('README에 설치 방법 추가해줘\nnpm test도 돌려줘');
    const enterAt = [...'READMEjc ntwod ;fa;t3 o9kfmrl9t\n'].length - 1;
    const firstLine = results[enterAt].text;
    expect(firstLine).toBe('README에 설치 방법 추가해줘\n');
    for (const r of results.slice(enterAt)) {
      expect(r.text.startsWith(firstLine)).toBe(true);
      expect(r.committedLength).toBeGreaterThanOrEqual([...firstLine].length);
    }
  });

  it('11. A: hr kfXjgy/ → 내 값으로', () => {
    expect(run(A, 'hr kfXjgy/').text).toBe('내 값으로');
  });

  it('12. A: kktl9t → 꺼줘 (쌍초성 = 같은 키 두 번)', () => {
    expect(run(A, 'kktl9t').text).toBe('꺼줘');
  });

  it('13. A: jd@jt2uf 와 jdwxjt2uf → 읽었다', () => {
    expect(run(A, 'jd@jt2uf').text).toBe('읽었다');
    expect(run(A, 'jdwxjt2uf').text).toBe('읽었다');
  });

  it('14. A: k/rsofSjfj4 → 괜찮아요', () => {
    expect(run(A, 'k/rsofSjfj4').text).toBe('괜찮아요');
  });

  it('15. A: l/1jfj4 → 좋아요', () => {
    expect(run(A, 'l/1jfj4').text).toBe('좋아요');
  });

  it('16. A: TV / README / PR 그대로', () => {
    for (const w of ['TV', 'README', 'PR']) {
      const { results } = typeAll(A, w);
      for (const r of results) expect(w.startsWith(r.text)).toBe(true);
      expect(results[results.length - 1].text).toBe(w);
      expect(run(A, w + ' ').text).toBe(w + ' ');
    }
  });

  it('17. A: v2 / build.sh 그대로', () => {
    for (const w of ['v2', 'build.sh']) {
      const { results } = typeAll(A, w);
      for (const r of results) expect(w.startsWith(r.text)).toBe(true);
      expect(run(A, w + ' ').text).toBe(w + ' ');
    }
  });

  it('18. A: jfshea [한/영] → jfshea, 모드 A', () => {
    const { engine } = typeAll(A, 'jfshea');
    const r = engine.process({ type: 'toggle' }, 1000);
    expect(r.text).toBe('jfshea');
    expect(r.mode).toBe('en');
    // the reverted word stays as typed while it continues
    const r2 = engine.process({ type: 'key', ch: 'm' }, 1100);
    expect(r2.text).toBe('jfsheam');
  });

  it('19. A: jfshea␣ [한/영][한/영] 빠르게 → jfshea␣', () => {
    const { engine } = typeAll(A, 'jfshea ');
    expect(engine.text).toBe('안녕 ');
    engine.process({ type: 'toggle' }, 1000);
    const r = engine.process({ type: 'toggle' }, 1200);
    expect(r.text).toBe('jfshea ');
    expect(r.mode).toBe('en');
  });

  it('20. A: jfshea␣ [한/영] 한 번 → 안녕␣ 그대로, 모드만 바뀜', () => {
    const { engine } = typeAll(A, 'jfshea ');
    expect(engine.getMode()).toBe('ko');
    const r = engine.process({ type: 'toggle' }, 1000);
    expect(r.text).toBe('안녕 ');
    expect(r.mode).toBe('en');
    // a second press after the double-press window is a plain toggle again
    const r2 = engine.process({ type: 'toggle' }, 2000);
    expect(r2.text).toBe('안녕 ');
    expect(r2.mode).toBe('ko');
  });

  it('21. 같은 말을 세 번 되돌리면 학습, 4번째는 바꾸지 않음', () => {
    const engine = new Engine({ mode: A });
    let t = 0;
    for (let i = 0; i < 3; i++) {
      engine.process({ type: 'reset' }, (t += 1000));
      engine.setMode('en');
      for (const ch of 'jfshea') engine.process({ type: 'key', ch }, (t += 50));
      expect(engine.text).toBe('안녕');
      expect(engine.process({ type: 'toggle' }, (t += 50)).text).toBe('jfshea');
    }
    engine.process({ type: 'reset' }, (t += 1000));
    engine.setMode('en');
    const shown: string[] = [];
    for (const ch of 'jfshea') shown.push(engine.process({ type: 'key', ch }, (t += 50)).text);
    expect(shown[shown.length - 1]).toBe('jfshea');
    expect(shown.every((s) => 'jfshea'.startsWith(s))).toBe(true); // never flickered to Hangul
    expect(engine.process({ type: 'space' }, (t += 50)).text).toBe('jfshea ');
    expect(engine.learnedWords().map((e) => e.keys)).toContain('jfshea');
    // deleting it from the list brings the correction back
    engine.forgetLearned('jfshea');
    engine.process({ type: 'reset' });
    engine.setMode('en');
    for (const ch of 'jfshea') engine.process({ type: 'key', ch });
    expect(engine.text).toBe('안녕');
  });

  it('22. 세벌식 390: A: jfsheamfncj4 → 안녕하세요 (자판 데이터 교체만으로)', () => {
    expect(run(A, 'jfsheamfncj4', '39').text).toBe('안녕하세요');
    const engine = new Engine({ mode: A });
    engine.setLayout('39');
    expect(engine.type('jfsheamfncj4').text).toBe('안녕하세요');
  });
});

describe('권장', () => {
  it('24. 가: it is → it is (머 보류 후 is에서 영어로 확정)', () => {
    const { results } = typeAll(KA, 'it is');
    expect(results[results.length - 1].text).toBe('it is');
  });

  it('25. 가: pea soup → pea soup', () => {
    expect(run(KA, 'pea soup').text).toBe('pea soup');
  });

  it('26. A: if jfsheamfncj4 → if 안녕하세요', () => {
    expect(run(A, 'if jfsheamfncj4').text).toBe('if 안녕하세요');
  });

  it('27. 가: yes⏎ → yes', () => {
    expect(run(KA, 'yes\n').text).toBe('yes\n');
  });

  it('28. A: fori9s → for문', () => {
    expect(run(A, 'fori9s').text).toBe('for문');
  });
});
