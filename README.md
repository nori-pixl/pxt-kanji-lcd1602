# kanji-lcd1602

LCD1602(I2C)に**ひらがな・カタカナ・漢字**を表示する micro:bit(MakeCode)用ライブラリです。
東雲フォント16x16を 3マス x 2段(15x16ドット)に縮小し、CGRAM 0〜5 に登録して表示します。

## 収録文字

- ひらがな・カタカナ・主な記号・全角英数
- JIS第一水準漢字(約2,965字)
- 合計 3,227字 / データ約101KB

## 使い方

MakeCode で「拡張機能」から、このリポジトリのURLを貼って追加します。

```typescript
kanjiLCD.init(0x27)                        // アドレスは 0x27 か 0x3F
kanjiLCD.showKanji("仙", 0)                // 左端3マスに「仙」
kanjiLCD.showText("12/31", 4, 0)           // 英数字は通常の文字で
kanjiLCD.showSequence("仙台のひらがな", 0, 800) // 1文字ずつ切り替え
```

## 制約

- 同時に表示できる全角文字は**1文字**(CGRAM 8個のうち6個を使用)。CGRAM 6,7 は自由に使えます。
- データが約101KBあるので、**micro:bit V2 を推奨**します。V1ではフラッシュに収まらない可能性があります(その場合は下の「小さい版」を使ってください)。

## 小さい版・第二水準・追加

`tools/make_font.py` で `kanjifont.ts` を作り直せます。

```bash
sudo apt install xfonts-shinonome pcf2bdf
gunzip -c /usr/share/fonts/X11/misc/shnmk16.pcf.gz > shnmk16.pcf
pcf2bdf shnmk16.pcf > tools/shnmk16.bdf

python tools/make_font.py tools/shnmk16.bdf --lite          # 小さい版(約629字・約20KB)
python tools/make_font.py tools/shnmk16.bdf --level2        # 第二水準も入れる(約200KB・V2でも厳しい)
python tools/make_font.py tools/shnmk16.bdf --extra 仙台     # 追加したい文字
```

`registerKanji` で、プログラム内から1文字だけ追加することもできます(60桁の16進)。

## ライセンス

MIT。フォントデータは東雲フォント(パブリックドメイン)由来です。

## 対応

- micro:bit(MakeCode)
