# 데이터 출처와 라이선스

엔진이 판단에 쓰는 데이터는 모두 아래 공개 출처에서 스크립트로 만든다. 만들어진 파일은
`packages/engine/src/generated/`에 있고, 합쳐 1,080,938바이트(약 1.03MiB, gzip 약 490KB)다.

| 생성 파일 | 크기 | 만드는 스크립트 | 원본 | 원본 라이선스 |
|---|---|---|---|---|
| `layouts.json` | 2,814 B | `scripts/build_layouts.mjs` | libhangul `hangul-keyboard-3f.xml.template`(세벌식 최종), `hangul-keyboard-39.xml.template`(세벌식 390), `hangul-combination-default.xml` — `data/libhangul/`에 원본 그대로 있음 | LGPL-2.1 (`data/libhangul/LICENSE`) |
| `en.json` | 430,461 B | `scripts/build_data.py` | [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1 `get_frequency_dict('en')`에서 Zipf 2.5 이상, `[a-z]`(작은따옴표 하나 허용) 52,582개 + 손으로 고른 코드·명령어 토큰(`git`, `npm`, `pnpm`, `sudo`, `readme` …, Zipf 최소 3.6) | wordfreq 데이터: CC BY-SA 4.0 (코드: Apache-2.0) |
| `ko.json` `words` | (ko.json 647,663 B) | `scripts/build_data.py` | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) 2018 `ko_full.txt`(OpenSubtitles 2018, 띄어쓰기 단위 어절) 상위 45,000개 한글 어절, 전체 6,330,920토큰 기준 Zipf | FrequencyWords 내용: CC BY-SA 4.0 (코드: MIT) |
| `ko.json` `morphemes` | | `scripts/build_data.py` | wordfreq 3.1.1 `get_frequency_dict('ko')`(MeCab 형태소) 중 두 음절 이상 한글 상위 20,000개 — 자모 n-gram 학습에만 씀 | CC BY-SA 4.0 |

- 생성 파일(`en.json`, `ko.json`)은 원본의 CC BY-SA 4.0 조건을 따른다(출처 표시, 동일 조건 변경 허락).
- `layouts.json`은 libhangul 자판표를 JSON으로 바꾼 것이므로 LGPL-2.1을 따른다.
- 영어 문자 n-gram과 한국어 자모 n-gram은 따로 저장하지 않고, 엔진이 처음 뜰 때 위 단어 목록으로 만든다.

## 평가에만 쓰는 데이터 (저장소에 넣지 않음)

- [Tatoeba](https://tatoeba.org) 한국어·영어 문장 — CC BY 2.0 FR. `scripts/fetch_eval_data.sh`가
  `data/raw/tatoeba/`에 내려받고 `packages/engine/eval/eval.test.ts`가 읽는다.
- `packages/engine/eval/devchat.test.ts`의 개발자 대화 문장은 이 저장소에서 직접 쓴 것이다.

## 다시 만들기

```bash
python3 -m venv .venv && .venv/bin/pip install wordfreq
```

```bash
.venv/bin/python -I scripts/build_data.py
```

```bash
node scripts/build_layouts.mjs
```

`build_data.py`는 처음 한 번 FrequencyWords `ko_full.txt`(약 11MB)를 `data/raw/frequencywords/`에 내려받는다.
