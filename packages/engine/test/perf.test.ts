// SPEC 7 #23: average decision time per key < 0.1 ms over a 10,000-key run.

import { expect, it } from 'vitest';
import { Engine, textToKeys } from '../src/index';

const KO = [
  '오늘 회의는 세 시에 시작합니다',
  '어제 보내 주신 자료 잘 받았습니다',
  '이번 주까지 초안을 정리해서 공유드릴게요',
  '점심 먹고 다시 이야기해요',
  '테스트가 계속 실패해서 원인을 찾고 있어요',
  '내일 아침에 다시 확인해 볼게요',
  '고객 문의가 많아서 답변이 늦어졌습니다',
  '그 부분은 제가 맡아서 처리하겠습니다',
  '새로운 기능은 다음 달에 배포할 예정입니다',
  '혹시 시간 괜찮으시면 잠깐 통화할 수 있을까요',
  '문서에 설치 방법을 추가해 주세요',
  '서버가 느려서 로그를 살펴봤어요',
  '주말 잘 보내시고 월요일에 뵙겠습니다',
  '요즘 날씨가 많이 추워졌네요',
  '이 문제는 생각보다 간단하게 해결됐어요',
];
const EN = [
  'please review the pull request when you have time',
  'the build failed again on the main branch',
  'let me know if you need anything else',
  'we should update the documentation before the release',
  'git commit and push origin main',
  'npm install then npm run dev',
];
const MIXED = ['deploymr2hgsuc jcytkf hfj4', 'Q4 y/ugir3 o/jfs k/aj5ugyej4', 'READMEjc ntwod ;fa;t3 o9kfmrl9t', 'AIy/ fori9s'];

it('23. 키 하나 판단 시간 평균 0.1ms 미만 (1만 키)', () => {
  const engine = new Engine();
  const lines: Array<{ mode: 'ko' | 'en'; keys: string }> = [];
  for (let i = 0; i < Math.max(KO.length, EN.length, MIXED.length); i++) {
    if (KO[i]) lines.push({ mode: 'en', keys: textToKeys(KO[i]) }, { mode: 'ko', keys: textToKeys(KO[i]) });
    if (EN[i]) lines.push({ mode: 'ko', keys: EN[i] }, { mode: 'en', keys: EN[i] });
    if (MIXED[i]) lines.push({ mode: 'en', keys: MIXED[i] });
  }
  let keys = 0;
  let total = 0;
  let worst = 0;
  outer: while (true) {
    for (const line of lines) {
      engine.setMode(line.mode);
      for (const ch of line.keys) {
        const t0 = performance.now();
        if (ch === ' ') engine.process({ type: 'space' });
        else engine.process({ type: 'key', ch });
        const dt = performance.now() - t0;
        total += dt;
        worst = Math.max(worst, dt);
        if (++keys >= 10000) break outer;
      }
      engine.process({ type: 'enter' });
      if (engine.text.length > 2000) engine.process({ type: 'reset' });
    }
  }
  const avg = total / keys;
  console.log(`keys=${keys} total=${total.toFixed(1)}ms avg=${(avg * 1000).toFixed(1)}µs worst=${worst.toFixed(2)}ms`);
  expect(avg).toBeLessThan(0.1);
});
