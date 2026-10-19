// Hand-written developer-chat style sentences (code tokens, short ambiguous
// English words, Korean with English mixed in), typed in both modes.
// Run: npx vitest run --config vitest.eval.config.ts

import { test } from 'vitest';
import { Engine, textToKeys, type Lang } from '../src/index';

const EN = `run npm install and then npm run build
the API returns a JSON object with id and name
set NODE_ENV=production before you deploy
use git rebase -i HEAD~3 to squash commits
check the logs in /var/log/nginx/error.log
fix typo in README.md
bump version to v2.3.1
add unit tests for the parser
LGTM, merging now
can you review my PR when you get a chance?
it is what it is
he said yes to the new plan
me too
if it works, ship it
the hex value is 0xff
pea soup and a yew tree
id is required
of course
kubectl get pods -n kube-system
docker compose up -d
ssh user@host
export PATH=$HOME/bin:$PATH
for i in range(10): print(i)
let me know if you have any questions
see you tomorrow
thanks a lot
brb lol omg btw imo tbh
ok np ty
the CI is red again
Q4 roadmap is due on Friday
please update the changelog
we use Figma and Notion for docs
open localhost:3000 in Chrome
the cache hit rate is 95%
merge main into your branch
my id is kim123
sudo rm -rf node_modules
cd src && ls -la
I think so
yes, me too
oh my god
hey, how are you?
new feature flag for the beta
use pnpm, not yarn
add a TODO here
the iPhone app crashed
vim or emacs?
go to the gym
he is my boss
no idea`.split('\n');

// Korean (with some English) as people type it; English words keep their QWERTY keys.
const KO = `오늘 배포는 몇 시에 하나요?
PR 리뷰 부탁드립니다
README에 설치 방법 추가해줘
npm test도 돌려줘
테스트 다 통과했어요
이 버그는 내일 고칠게요
로그 확인해 보니 타임아웃이었어요
AI로 요약해 줄 수 있어요?
deploy했는데 에러가 나요
Figma 링크 보내드릴게요
Q4 로드맵 초안 공유드려요
점심 뭐 먹을까요
회의실 예약했어요
코드 리뷰 감사합니다
서버 재시작 했습니다
for문 대신 map 쓰세요
API 문서 업데이트 했어요
슬랙으로 연락 주세요
내 값으로 바꿔 줘
괜찮아요 천천히 하세요
좋아요 그렇게 하죠
지금 바로 확인해 볼게요
퇴근하겠습니다
잠깐 통화 가능하세요?
빌드가 깨졌네요
이거 왜 안 되지
캐시 지우고 다시 해 보세요
네 알겠습니다
고마워요
수고하셨습니다`.split('\n');

function keysFor(sentence: string): string {
  return sentence
    .split(' ')
    .map((w) => (/[가-힣]/.test(w) ? w.replace(/[가-힣?!.,]+/g, (k) => textToKeys(k)) : w))
    .join(' ');
}

function run(engine: Engine, sentences: string[], mode: Lang, toKeys: (s: string) => string) {
  let words = 0;
  let wrong = 0;
  const bad: string[] = [];
  for (const s of sentences) {
    engine.process({ type: 'reset' });
    engine.setMode(mode);
    for (const ch of toKeys(s)) engine.process(ch === ' ' ? { type: 'space' } : { type: 'key', ch });
    const out = engine.process({ type: 'enter' }).text.replace(/\n$/, '');
    const a = s.split(' ');
    const b = out.split(' ');
    words += a.length;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    wrong += n;
    if (n) bad.push(`${s}  =>  ${out}`);
  }
  return { words, wrong, bad };
}

test('dev chat', () => {
  const engine = new Engine();
  const rows: Array<[string, ReturnType<typeof run>]> = [
    ['en typed in A (should stay)', run(engine, EN, 'en', (s) => s)],
    ['en typed in 가 (should convert)', run(engine, EN, 'ko', (s) => s)],
    ['ko+en typed in A', run(engine, KO, 'en', keysFor)],
    ['ko+en typed in 가', run(engine, KO, 'ko', keysFor)],
  ];
  for (const [name, r] of rows) {
    console.log(`\n## ${name}: ${r.wrong}/${r.words} wrong words`);
    for (const b of r.bad) console.log('  ' + b);
  }
});
