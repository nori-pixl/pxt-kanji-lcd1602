# kanji-lcd1602

LCD1602(I2C)に**漢字を表示**する micro:bit(MakeCode)用ライブラリです。
東雲フォント16x16を 3マス x 2段(15x16ドット)に縮小し、CGRAM 0〜5 に登録して表示します。

## 使い方

MakeCode で「拡張機能」から、このリポジトリのURLを貼って追加します。

```typescript
kanjiLCD.init(0x27)              // アドレスは 0x27 か 0x3F
kanjiLCD.showKanji("月", 0)      // 左端3マスに「月」
kanjiLCD.showText("12/31", 4, 0) // 通常文字は右に
kanjiLCD.showSequence("月火水木金土日", 0, 800) // 1文字ずつ切り替え
```

## 制約

- 同時に表示できる漢字は**1文字**(CGRAM 8個のうち6個を使用)。CGRAM 6,7 は自由に使えます。
- 組み込みの漢字は約66文字(年月日時分秒曜、火水木金土、温度湿度、数字の漢字など)。
- 追加したい漢字は `tools/make_font.py` で生成できます。

## 漢字を追加する

```bash
sudo apt install xfonts-shinonome pcf2bdf
gunzip -c /usr/share/fonts/X11/misc/shnmk16.pcf.gz > shnmk16.pcf
pcf2bdf shnmk16.pcf > tools/shnmk16.bdf
python tools/make_font.py tools/shnmk16.bdf 夏冬春秋   # 追加したい漢字を指定
```

`kanjifont.ts` が再生成されます。

## ライセンス

MIT。フォントデータは東雲フォント(パブリックドメイン)由来です。

## 対応

- micro:bit(MakeCode)
