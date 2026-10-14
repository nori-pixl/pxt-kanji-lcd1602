#!/usr/bin/env python3
"""kanjifont.ts の検査。壊れたhex・並びのずれ・重複を探す。

使い方:  python tools/check_font.py kanjifont.ts
"""
import re
import sys


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ok = True
    for path in sys.argv[1:]:
        s = open(path, encoding="utf-8").read()
        count = int(re.search(r"export const GLYPH_COUNT = (\d+)", s).group(1))
        bs = int(re.search(r"export const BLOCK_SIZE = (\d+)", s).group(1))
        gb = int(re.search(r"export const KANJI_BYTES = (\d+)", s).group(1))
        codes = bytes.fromhex(re.search(r"export const KANJI_CODES = hex`([0-9a-fA-F]*)`", s).group(1))
        m = re.search(r"export const BLOCKS: Buffer\[\] = \[\n(.*?)\n    \]", s, re.S)
        blocks = [bytes.fromhex(h) for h in re.findall(r"hex`([0-9a-fA-F]*)`", m.group(1))]
        cs = [int.from_bytes(codes[i:i + 2], "big") for i in range(0, len(codes), 2)]
        print("[%s] 文字数=%d  コード表=%d個  1字%dバイト  ブロック=%d字x%d個" % (path, count, len(cs), gb, bs, len(blocks)))

        def bad(msg):
            nonlocal ok
            ok = False
            print("  !!", msg)

        if len(cs) != count: bad("コード表の個数(%d)がGLYPH_COUNT(%d)と違う" % (len(cs), count))
        if cs != sorted(cs): bad("コード表が昇順になっていない(二分探索が壊れる)")
        if len(set(cs)) != len(cs): bad("コード表に重複がある")
        exp = [bs * gb] * (count // bs) + ([(count % bs) * gb] if count % bs else [])
        got = [len(b) for b in blocks]
        if got != exp: bad("ブロック長が違う 実際%s 期待%s" % (got[:3], exp[:3]))
        data = b"".join(blocks)
        if len(data) != count * gb: bad("グリフデータの合計が違う %d / %d" % (len(data), count * gb))
        glyphs = [data[i * gb:(i + 1) * gb] for i in range(count)]
        blank = [chr(cs[i]) for i, g in enumerate(glyphs) if not any(g) and cs[i] != 0x3000]  # 全角空白は空白でよい
        if blank: bad("空白の字形: %s" % blank[:10])
        same = {}
        for i, g in enumerate(glyphs):
            same.setdefault(g, []).append(chr(cs[i]))
        d = [v for v in same.values() if len(v) > 1]
        if d: bad("同じ字形が複数の文字に入っている: %s" % d[:5])
        print("  結果:", "問題なし" if ok else "問題あり")
    sys.exit(0 if ok else 1)


main()
