#!/usr/bin/env python3
"""ひらがな・カタカナ・記号・全角英数・漢字を すべて「縦2マス x 横3マス (15x16ドット)」の
薄い(細い線の)東雲フォントとして、1つの kanjifont.ts にまとめる。

  ・東雲フォント(16x16)を 15x16 に面積平均で縮めたデータ(1グリフ30バイト)をそのまま使う。
    (横を10ドットに縮めたり、1.5倍に伸ばしたりしないので、線が太くならない)
  ・15x16 のデータが無い字(全角英数・一部の記号)だけ、10x15 のデータを横に伸ばして補う。

使い方:
    python tools/make_font_3x2.py 漢字15x16.ts [最初のコミットのkanjifont.ts] [kanafont.ts(10x15)]
    → カレントディレクトリに kanjifont.ts を書き出す

東雲フォントの BDF が手元にある場合は、tools/make_font.py の方が元の16x16から直接作れます。
"""
import re
import sys

BLOCK = 32
GB = 30  # 15x16 = 240bit = 30バイト


def parse(path, keys_name="KEYS", blocks_name="BLOCKS", gb=GB):
    t = open(path, encoding="utf-8").read()
    m = re.search(r'export const %s = "([^"]*)"' % keys_name, t)
    if not m:
        return {}
    keys = m.group(1)
    b = re.search(r"export const %s: Buffer\[\] = \[\n(.*?)\n    \]" % blocks_name, t, re.S)
    data = b"".join(bytes.fromhex(h) for h in re.findall(r"hex`([0-9a-fA-F]*)`", b.group(1)))
    assert len(data) == len(keys) * gb, "%s: データ長が合いません" % path
    return {ord(c): data[i * gb:(i + 1) * gb] for i, c in enumerate(keys)}


def stretch(g19):
    """10x15 (19バイト) → 15x16 (30バイト): 横を1.5倍に伸ばし、16行目は空行。"""
    bits = "".join("{:08b}".format(x) for x in g19)
    out = []
    for r in range(16):
        for c in range(15):
            out.append(int(bits[r * 10 + (c * 10) // 15]) if r < 15 else 0)
    buf = bytearray(GB)
    for i, v in enumerate(out):
        if v:
            buf[i >> 3] |= 0x80 >> (i & 7)
    return bytes(buf)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    table = {}
    kana10 = {}
    for p in sys.argv[1:]:
        t = open(p, encoding="utf-8").read()
        if "export const KANA_KEYS" in t:      # 10x15 のかな(kanafont.ts、または かなも一緒に入ったファイル)
            kana10.update(parse(p, "KANA_KEYS", "KANA_BLOCKS", 19))
        if re.search(r'export const KEYS = "', t):   # 15x16 の漢字・かな
            for c, g in parse(p).items():
                table.setdefault(c, g)        # 先に渡したファイルを優先
    added = 0
    for c, g in kana10.items():
        if c not in table:
            table[c] = stretch(g)
            added += 1
    codes = sorted(table)
    data = b"".join(table[c] for c in codes)
    with open("kanjifont.ts", "w", encoding="utf-8") as f:
        f.write("// 自動生成: tools/make_font_3x2.py (東雲フォント 16x16 gothic / パブリックドメイン)\n")
        f.write("// ひらがな・カタカナ・記号・全角英数・漢字 %d字: 縦2マス x 横3マス (15x16ドット), 各%dバイト, 1bit/dot\n" % (len(codes), GB))
        f.write("// KANJI_CODES: 収録文字のUnicode(2バイト, 昇順)。順番 = グリフ番号(二分探索用)\n")
        f.write("namespace kanjiLCD {\n")
        f.write("    export const GLYPH_COUNT = %d\n" % len(codes))
        f.write("    export const BLOCK_SIZE = %d\n" % BLOCK)
        f.write("    export const KANJI_BYTES = %d\n" % GB)
        f.write("    export const KANJI_CODES = hex`%s`\n" % b"".join(c.to_bytes(2, "big") for c in codes).hex())
        f.write("    export const BLOCKS: Buffer[] = [\n")
        for i in range(0, len(codes), BLOCK):
            f.write("        hex`%s`,\n" % data[i * GB:(i + BLOCK) * GB].hex())
        f.write("    ]\n}\n")
    print("kanjifont.ts: %d字 (15x16, %dバイト/字) うち 10x15から補った字 %d" % (len(codes), GB, added))


main()
