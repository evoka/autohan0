#!/bin/sh
# Download Tatoeba sentences (CC BY 2.0 FR) used only by the accuracy evaluation
# (packages/engine/eval). Not shipped with the engine.
set -e
dir="$(cd "$(dirname "$0")/.." && pwd)/data/raw/tatoeba"
mkdir -p "$dir"
curl -sSfL https://downloads.tatoeba.org/exports/per_language/kor/kor_sentences.tsv.bz2 | bunzip2 > "$dir/kor_sentences.tsv"
# English export is large; a 20k-sentence slice is enough.
curl -sSfL https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2 | bunzip2 2>/dev/null | head -400000 | tail -20000 > "$dir/eng_sentences_sample.tsv" || true
wc -l "$dir"/*.tsv
