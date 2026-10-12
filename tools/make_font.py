#!/usr/bin/env python3
"""東雲フォント(BDF)から kanjifont.ts を生成する。

使い方:
    python tools/make_font.py tools/shnmk16.bdf            # 既定の漢字セット
    python tools/make_font.py tools/shnmk16.bdf 夏冬春秋    # 追加したい漢字を指定(既定セットに加わる)

各漢字は 3x2 マス(15x16 ドット)に面積平均で縮小し、
6マス x 8バイト = 96桁の16進文字列にして出力する。
"""
import sys

DEFAULT = ("年月日時分秒曜火水木金土今午前後上下左右"
           "温度湿気圧天晴雨雪曇風雲光音楽間朝昼夜東西南北"
           "一二三四五六七八九十零円大小中高低電池入出開閉")

W = 15  # 3マス x 5ドット


def load_bdf(path):
    glyphs, cur, bits, inb = {}, None, [], False
    for line in open(path, encoding="latin-1"):
        t = line.split()
        if not t:
            continue
        if t[0] == "ENCODING":
            cur = int(t[1])
        elif t[0] == "BITMAP":
            bits, inb = [], True
        elif t[0] == "ENDCHAR":
            inb = False
            glyphs[cur] = bits
        elif inb:
            bits.append(int(t[0], 16))
    return glyphs


def encode(rows):
    out = []
    for r in rows:
        px = [(r >> (15 - i)) & 1 for i in range(16)]
        line = []
        for x in range(W):
            a, b = x * 16 / W, (x + 1) * 16 / W
            s = sum(px[i] * (min(b, i + 1) - max(a, i))
                    for i in range(int(a), min(16, int(b) + 1)))
            line.append(1 if s >= 0.5 * (b - a) else 0)
        out.append(line)
    cells = []
    for ry in (0, 8):                 # 上段 → 下段
        for cx in (0, 5, 10):         # 左 → 中 → 右
            cells.append([sum(out[ry + y][cx + i] << (4 - i) for i in range(5))
                          for y in range(8)])
    return "".join("%02X" % b for c in cells for b in c)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    glyphs = load_bdf(sys.argv[1])
    chars = DEFAULT + (sys.argv[2] if len(sys.argv) > 2 else "")
    seen, entries = set(), []
    for ch in chars:
        if ch in seen:
            continue
        seen.add(ch)
        try:
            b = ch.encode("iso2022_jp")
        except UnicodeEncodeError:
            print("skip (JIS X 0208外):", ch, file=sys.stderr)
            continue
        jis = (b[3] << 8) | b[4]
        if jis not in glyphs:
            print("skip (フォントに無い):", ch, file=sys.stderr)
            continue
        entries.append("%s=%s" % (ch, encode(glyphs[jis])))
    body = ",".join(entries)
    with open("kanjifont.ts", "w", encoding="utf-8") as f:
        f.write("// 自動生成: tools/make_font.py (東雲フォント 16x16 gothic / パブリックドメイン)\n")
        f.write("namespace kanjiLCD {\n")
        f.write("    // 形式: 漢字=96桁の16進(6マス x 8バイト),...\n")
        f.write("    export const FONT_DATA = \"%s\"\n" % body)
        f.write("}\n")
    print("生成:", len(entries), "文字")


main()
