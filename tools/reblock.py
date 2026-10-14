#!/usr/bin/env python3
"""kanjifont.ts / kanafont.ts のグリフデータを変えずに、hexリテラルのブロックの大きさだけ作り直す。
(東雲フォントのBDFが手元になくても使える)

使い方:
    python tools/reblock.py kanjifont.ts 32     # hexリテラルを1ブロック32字に作り直す
"""
import re
import sys

SPECS = [  # (BLOCKS名, ブロックサイズ定数名, 1グリフのバイト数)
    ("BLOCKS", "BLOCK_SIZE", 30),
]


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    path, nb = sys.argv[1], int(sys.argv[2])
    s = open(path, encoding="utf-8").read()
    mb = re.search(r"export const KANJI_BYTES = (\d+)", s)
    for blocks_name, size_name, gb in SPECS:
        if blocks_name == "BLOCKS" and mb:
            gb = int(mb.group(1))
        m = re.search(r"(export const %s: Buffer\[\] = \[\n)(.*?)(\n    \])" % blocks_name, s, re.S)
        if not m:
            continue
        data = b"".join(bytes.fromhex(h) for h in re.findall(r"hex`([0-9a-fA-F]*)`", m.group(2)))
        assert len(data) % gb == 0, "データ長が1グリフのバイト数の倍数ではありません"
        count = len(data) // gb
        lines = ["        hex`%s`," % data[i * gb:(i + nb) * gb].hex() for i in range(0, count, nb)]
        s = s[:m.start(2)] + "\n".join(lines) + s[m.end(2):]
        s = re.sub(r"(export const %s = )\d+" % size_name, r"\g<1>%d" % nb, s)
        print("%s: %d字, 1ブロック%d字 x %d個" % (blocks_name, count, nb, len(lines)))
    open(path, "w", encoding="utf-8").write(s)


main()
