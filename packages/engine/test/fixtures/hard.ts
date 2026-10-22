// Sentences people actually type that the clean Tatoeba evaluation never shows: numbers with
// counters, one-letter labels, acronyms with particles, quotes, code tokens, URLs, chat.
// Written for this project (not copied from other projects' test data). `status: 'pass'` rows
// must come out right typed in either mode; `'known'` rows are the current work list and are
// only reported.

export type HardTag = 'number' | 'letter' | 'acronym' | 'quote' | 'code' | 'url' | 'chat' | 'syllable' | 'mixed' | 'limit';

export interface HardCase {
  text: string;
  tag: HardTag;
  status: 'pass' | 'known';
  /** modes to type it in (default: both). Shift+letter typed in Korean mode is a digit (UI = 67), so some rows are English-mode only. */
  modes?: Array<'en' | 'ko'>;
}

const c = (tag: HardTag, status: HardCase['status'], ...texts: string[]): HardCase[] => texts.map((text) => ({ text, tag, status }));
const enOnly = (cases: HardCase[]): HardCase[] => cases.map((h) => ({ ...h, modes: ['en'] }));
const koOnly = (cases: HardCase[]): HardCase[] => cases.map((h) => ({ ...h, modes: ['ko'] }));

export const HARD: HardCase[] = [
  // digits followed by a counter / particle (3개, 10분, 2025년에, v0.8.5로)
  ...c(
    'number',
    'pass',
    '3개만 남겨줘',
    '10분 뒤에 보자',
    '2025년에 출시했어',
    '5시에 만나자',
    '3,000원을 냈어',
    'v0.8.5로 올렸어',
    'MAX_RETRY 값을 3으로 바꿔',
    '서버가 500을 반환해',
    '7월 15일에 출발해',
    '12시 30분에 점심',
    '0.05보다 작았다',
    '평균 온도는 25도였다',
    '4번 출구에서 보자',
    '1등 했다',
    '2시간 걸려',
    '10000원 보냈어',
    '3명 예약했어',
    '3.14는 파이야',
    '950만 명이다',
    '학습률은 3e-4로 두었다',
    'F1이 2.3%p 올랐다',
    '3.5인치 디스켓이다',
    '2024년 4분기 매출',
  ),
  // English with numbers must stay English (ordinals, units, a number before an ambiguous word)
  ...c('number', 'pass', 'the 2nd one', '22nd', 'I ran 10 km in 1 hr', 'took 24 hrs', '5 lbs of flour', '3kg', '10kg', 'wait 10 hr'),
  // one syllable whose vowel is a digit key (ㅛ = 4, ㅖ = 7, ㅢ = 8, ㅠ = 5): 요, 예, 의, 유, 휴
  ...c('syllable', 'pass', '요', '예', '의', '유', '야', '휴', '교', '효', '카', '푹', '계', '희'),
  // rare syllables typed on purpose in Korean mode stay Korean
  ...koOnly(c('syllable', 'pass', '캬', '챠트', '퉤', '뷁뷁')),
  // one letter + Korean (n제, x축, B급)
  ...c('letter', 'pass', 'n제 풀었다', 'x축 방향', 'c언어 공부', 'B급 영화', 'A팀 회의', 'S라인 유지', 'Z세대 취향', 'N호선 타고 가', 'A형 혈액'),
  // 긘 is charged as an unseen syllable only in English mode (in Korean mode 긘에 is what was typed)
  ...enOnly(c('letter', 'pass', 'k8s에 올렸어')),
  // acronym + particle
  ...c('acronym', 'pass', 'API를 호출했는데 에러가 나', 'PR을 올렸어', 'CI가 빨간색이야', 'TV를 켰다', 'DB에서 읽어', 'QA팀에 넘겼어', 'URL만 보내줘'),
  ...enOnly(c('acronym', 'pass', 'UI같은건 싫어')),
  // closing quote / bracket before the Korean tail
  ...c('quote', 'pass', '이것을 "contents"라고 부른다', "'Hello World'는 첫 예제다", '이 버튼을 "Submit"이라고 읽는다'),
  // in Korean mode Sebeolsik Final types ( ) as ' ~ — faithful, so English mode only
  ...enOnly(c('quote', 'pass', '(참고)로 적었다')),
  // code tokens
  ...c('code', 'pass', 'h264 코덱 써', 'mp3 파일 보내', '0xff 값 넣어', 'build.sh 돌려', 'npm test도 돌려줘', 'v2.0.0으로 올렸어'),
  // URLs and paths stay as typed
  ...c(
    'url',
    'pass',
    'https://github.com/evoka/autohan0 봐줘',
    '~/Work/claude 폴더',
    'user@host 접속해',
    './build.sh 실행해',
    'www.naver.com 열어',
    'localhost:3000 띄워',
    '/usr/local/bin 아래',
  ),
  // chat; a word typed in English mode keeps its ASCII `~` (Sebeolsik Final would give ※)
  ...c('chat', 'pass', '밥 먹었어?', '진짜 대박!', '퇴근하고 집에 가는 중이야'),
  ...enOnly(c('chat', 'pass', '뭐라고~ 안 들려')),
  // Known limits (README): Korean head + English tail is not split; Shift digits in Korean mode;
  // after the first word switches to Korean, `~` is what the Final layout types (※).
  ...c('mixed', 'known', '코드review 해줘', '챗GPT 써봐'),
  ...c('limit', 'known', 'OK 알겠습니다', '오늘 날씨 좋다~'),
];

/** Code and command tokens that must come out exactly as typed in English mode. */
export const IDENTIFIERS: string[] = `
src lib tmp cfg env cmd dir usr bin etc opt var pkg npx tsc eslint prettier vite vitest jest
README CHANGELOG LICENSE TODO FIXME HEAD origin main master nginx redis kafka json yaml toml html css
js ts tsx jsx py rb go rs sh zsh bash curl wget ssh scp grep sed awk sudo chmod chown mkdir rmdir
ls cd cp rm cat echo git commit push pull fetch merge rebase stash log diff status checkout branch
http https api sdk cli ui ux db sql id uid pid url uri ok np ty brb lol omg btw imo tbh idk gg
docker kubectl helm npm pnpm yarn bun deno node python java swift rust cargo brew apt pip venv
localhost dev prod staging build test lint debug hotfix refactor ci qa
`.split(/\s+/).filter(Boolean);
