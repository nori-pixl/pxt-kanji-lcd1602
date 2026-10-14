#!/usr/bin/env python3
"""kanjifont.ts に KEYS(収録文字を KANJI_CODES と同じ順に並べた文字列)を作る/作り直す。

使い方:  python tools/add_keys.py kanjifont.ts

ライブラリは、文字列で渡された字を KEYS.indexOf(字) で探す(文字コードの数値は読まない)。
実機の MakeCode では、全角文字の charCodeAt が下位1バイトしか返さないことがあるが、
文字列そのものの比較・検索は正しく動くため、この方式なら漢字も文字のまま指定できる。
"""
import re, sys

path = sys.argv[1] if len(sys.argv) > 1 else "kanjifont.ts"
s = open(path, encoding="utf-8").read()
m = re.search(r"KANJI_CODES = hex`([0-9a-f]*)`", s)
b = bytes.fromhex(m.group(1))
codes = [int.from_bytes(b[i:i + 2], "big") for i in range(0, len(b), 2)]
assert codes == sorted(codes), "KANJI_CODES が昇順ではない"
keys = "".join(chr(c) for c in codes)
assert '"' not in keys and "\\" not in keys, "KEYS に使えない文字がある"
line = '    export const KEYS = "%s"\n' % keys
if "export const KEYS" in s:
    s = re.sub(r'    export const KEYS = ".*"\n', lambda _: line, s)
else:
    s = s.replace("    export const KANJI_BYTES", "    // KEYS: KANJI_CODES と同じ順に並べた収録文字(文字列で字を探すため)\n" + line + "    export const KANJI_BYTES", 1)
open(path, "w", encoding="utf-8").write(s)
print("KEYS:", len(keys), "文字")
