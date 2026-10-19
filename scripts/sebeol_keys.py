# 세벌식 최종 자판표(data/libhangul)로 한글 문장 → 키열을 만든다. 사용: python3 scripts/sebeol_keys.py "안녕하세요"
import os, re, sys, unicodedata
def load(path):
    m = {}
    for k, v in re.findall(r'key="0x([0-9a-f]+)" value="0x([0-9a-f]+)"', open(path, encoding='utf-8').read()):
        m[chr(int(k, 16))] = chr(int(v, 16))
    return m
def loadcomb(path):
    c = {}
    for a, b, r in re.findall(r'first="0x([0-9a-f]+)" second="0x([0-9a-f]+)" result="0x([0-9a-f]+)"', open(path, encoding='utf-8').read()):
        c[chr(int(r, 16))] = (chr(int(a, 16)), chr(int(b, 16)))
    return c
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'libhangul') + os.sep
key2jamo = load(base + 'hangul-keyboard-3f.xml.template')
comb = loadcomb(base + 'hangul-combination-default.xml')
# jamo -> key, prefer unshifted (lowercase / digits)
jamo2key = {}
for k, j in sorted(key2jamo.items(), key=lambda kv: (not (kv[0].islower() or kv[0].isdigit() or kv[0] in ",./;'[]-=`\\"), kv[0])):
    jamo2key.setdefault(j, k)
def keys_for_jamo(j):
    if j in jamo2key: return jamo2key[j]
    if j in comb:
        a, b = comb[j]
        return keys_for_jamo(a) + keys_for_jamo(b)
    raise KeyError(j)
def to_keys(text):
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xAC00 <= cp <= 0xD7A3:
            s = cp - 0xAC00
            L, V, T = s // 588, (s % 588) // 28, s % 28
            out.append(keys_for_jamo(chr(0x1100 + L)))
            out.append(keys_for_jamo(chr(0x1161 + V)))
            if T: out.append(keys_for_jamo(chr(0x11A7 + T)))
        else:
            out.append(ch)
    return ''.join(out)
# what a QWERTY-English string becomes when typed in 3f hangul mode (jamo-level, no composition)
def eng_in_hangul_mode(s):
    return ''.join(key2jamo.get(c, c) for c in s)
for t in sys.argv[1:]:
    print(f'{t!r:30} -> {to_keys(t)}')
print('--- english typed in 3f mode (raw jamo, U+11xx, shown via NFC-ish compat):')
for s in ['git push origin main', 'hello', 'npm test', 'so']:
    j = eng_in_hangul_mode(s)
    print(f'{s!r:30} -> {j}   ({[hex(ord(c)) for c in j]})')
