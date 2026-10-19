#!/usr/bin/env python3
"""Build the word-frequency data used by the engine.

Outputs (packages/engine/src/generated/):
  en.json  English words with Zipf frequency (wordfreq) + a small manual list of
           code/command tokens.
  ko.json  Korean eojeols (space-separated words) with Zipf frequency from
           FrequencyWords (OpenSubtitles 2018), plus multi-syllable morphemes
           from wordfreq (used only to train the syllable/jamo n-gram model).

The engine builds its character / jamo n-gram models from these lists at load
time, so only word lists are shipped.

Requirements:
  pip install wordfreq            (tested with wordfreq 3.1.1)
  network access once to download FrequencyWords ko_full.txt (cached under
  data/raw/frequencywords/).

Usage:
  python3 -I scripts/build_data.py
"""
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT_DIR = os.path.join(ROOT, 'packages', 'engine', 'src', 'generated')
RAW_DIR = os.path.join(ROOT, 'data', 'raw', 'frequencywords')
FW_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ko/ko_full.txt'

# Size knobs (keep the generated files well under the 2 MB budget).
EN_MIN_ZIPF = 2.5
KO_EOJEOL_TOP = 45000
KO_MORPH_TOP = 20000

# Code / command tokens that should always be recognised as English.
# Each gets at least CODE_ZIPF; existing wordfreq values above that are kept.
CODE_ZIPF = 3.6
CODE_TOKENS = """
git npm pnpm npx yarn bun deno node vite vitest jest eslint tsc tsx jsx json yaml yml toml
sudo ssh scp rsync curl wget grep sed awk ls cd mkdir rmdir rm cp mv cat echo chmod chown
brew apt pip venv conda python java kotlin swift rust cargo golang gcc clang cmake make
readme changelog license dockerfile makefile gitignore env config repo repos
push pull fetch clone commit merge rebase checkout branch stash diff status log origin main
master upstream remote cherry squash amend tag tags release deploy deployed deploying
api apis sdk cli gui url urls uri http https localhost dev prod staging build builds test tests
lint debug bug bugs hotfix refactor pr prs ci cd qa ui ux db sql nosql redis kafka nginx
docker kubectl kubernetes helm terraform aws gcp azure lambda figma slack notion jira github
gitlab vercel netlify webpack babel react vue svelte angular nextjs nuxt django flask fastapi
ok okay todo fixme async await const let var func def println printf stdin stdout stderr
""".split()


def zipf_of(freq):
    return math.log10(freq * 1e9)


def group_by_zipf(entries):
    """entries: list of (word, zipf). Returns 'zz word word ...' lines (zz = round(zipf*10))."""
    buckets = defaultdict(list)
    for w, z in entries:
        buckets[max(0, int(round(z * 10)))].append(w)
    return '\n'.join(f'{z} ' + ' '.join(ws) for z, ws in sorted(buckets.items(), reverse=True))


def build_en():
    from wordfreq import get_frequency_dict
    d = get_frequency_dict('en')
    out = {}
    for w, f in d.items():
        if not re.fullmatch(r"[a-z]+('[a-z]+)?", w) or len(w) > 24:
            continue
        z = zipf_of(f)
        if z >= EN_MIN_ZIPF:
            out[w] = z
    for w in CODE_TOKENS:
        out[w] = max(out.get(w, 0.0), CODE_ZIPF)
    entries = sorted(out.items(), key=lambda kv: -kv[1])
    covered = sum(10 ** (z - 9) for _, z in entries)
    return {
        'lang': 'en',
        'source': 'wordfreq 3.x get_frequency_dict("en") (Zipf >= %.1f, [a-z] with optional apostrophe) + manual code tokens' % EN_MIN_ZIPF,
        'license': 'wordfreq data: CC BY-SA 4.0 (code: Apache-2.0); manual list: same as this repository',
        'count': len(entries),
        'coveredMass': round(min(covered, 0.99), 4),
        'words': group_by_zipf(entries),
    }


def fetch_frequencywords():
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, 'ko_full.txt')
    if not os.path.exists(path):
        print('downloading', FW_URL, file=sys.stderr)
        with urllib.request.urlopen(FW_URL) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


HANGUL_WORD = re.compile(r'[가-힣]+')


def build_ko():
    from wordfreq import get_frequency_dict
    path = fetch_frequencywords()
    counts = []
    total = 0
    with open(path, encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').rsplit(' ', 1)
            if len(parts) != 2:
                continue
            w, c = parts[0], int(parts[1])
            total += c
            if HANGUL_WORD.fullmatch(w) and len(w) <= 12:
                counts.append((w, c))
    counts.sort(key=lambda kv: -kv[1])
    top = counts[:KO_EOJEOL_TOP]
    eojeols = [(w, zipf_of(c / total)) for w, c in top]
    covered = sum(c for _, c in top) / total

    d = get_frequency_dict('ko')
    morphs = [(w, zipf_of(f)) for w, f in d.items() if HANGUL_WORD.fullmatch(w) and len(w) >= 2]
    morphs.sort(key=lambda kv: -kv[1])
    morphs = morphs[:KO_MORPH_TOP]
    return {
        'lang': 'ko',
        'source': ('eojeols: FrequencyWords 2018 ko_full.txt (OpenSubtitles 2018), top %d Hangul-only tokens, '
                   'Zipf computed over %d tokens; morphemes: wordfreq 3.x get_frequency_dict("ko"), '
                   'top %d Hangul tokens of 2+ syllables (n-gram training only)') % (KO_EOJEOL_TOP, total, KO_MORPH_TOP),
        'license': 'FrequencyWords content: CC BY-SA 4.0; wordfreq data: CC BY-SA 4.0',
        'count': len(eojeols),
        'coveredMass': round(covered, 4),
        'words': group_by_zipf(eojeols),
        'morphemes': group_by_zipf(morphs),
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, data in (('en', build_en()), ('ko', build_ko())):
        path = os.path.join(OUT_DIR, name + '.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
        print('%s: %d words, coveredMass=%s, %d bytes -> %s' % (
            name, data['count'], data['coveredMass'], os.path.getsize(path), os.path.relpath(path, ROOT)))


if __name__ == '__main__':
    main()
