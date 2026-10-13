# kanji-lcd1602

LCD1602(I2C)に**ひらがな・カタカナ・漢字**を表示する micro:bit(MakeCode)用ライブラリです。
東雲フォント16x16を 3マス x 2段(15x16ドット)に縮小し、CGRAM 0〜5 に登録して表示します。

## 収録文字(この main ブランチ = micro:bit V1 でも動く小さい版)

- ひらがな・カタカナ・主な記号
- 日常でよく使う漢字 約300字(年月日・曜日・数字・天気・方位・仙台宮城など)
- **仙台市営地下鉄南北線のアナウンス文に出る文字(142種)をすべて収録**(駅名の富沢・泉中央・勾当台公園・愛宕橋など)
- 合計 461字 / データ約14.4KB

**ほぼ全ての漢字が必要な場合(micro:bit V2 専用)** は、`full` ブランチを使います。
JIS第一水準(約2,965字)を含む3,227字が入っています。

`https://github.com/nori-pixl/pxt-kanji-lcd1602#full`

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
- `full` ブランチはデータが約101KBあり、V1のフラッシュには収まりません。`pxt.json` で V1 ビルドを無効にしてあるので、**V2専用**です。

## 小さい版・第二水準・追加

`tools/make_font.py` で `kanjifont.ts` を作り直せます。

```bash
sudo apt install xfonts-shinonome pcf2bdf
gunzip -c /usr/share/fonts/X11/misc/shnmk16.pcf.gz > shnmk16.pcf
pcf2bdf shnmk16.pcf > tools/shnmk16.bdf

python tools/make_font.py tools/shnmk16.bdf --compact --text tools/namboku.txt  # V1に収まる版(南北線の字を含む461字・約14.4KB)
python tools/make_font.py tools/shnmk16.bdf --lite          # 中間の版(約629字・約20KB)
python tools/make_font.py tools/shnmk16.bdf --level2        # 第二水準も入れる(約200KB・V2でも厳しい)
python tools/make_font.py tools/shnmk16.bdf --extra 仙台     # 追加したい文字
```

`registerKanji` で、プログラム内から1文字だけ追加することもできます(60桁の16進)。

## ライセンス

MIT。フォントデータは東雲フォント(パブリックドメイン)由来です。

## 対応

- micro:bit(MakeCode)
