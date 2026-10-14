// 漢字LCD の動作確認(i2cLCD1602 を使っているプロジェクトならそのまま共存できます)
kanjiLCD.init(0x27)                              // アドレスは 39(0x27) か 63(0x3F)。UTF-8が効いていないと2行目に「UTF8 OFF」
// 縦2マス x 横3マス(15x16ドット)の細い字。
kanjiLCD.showString("あいうえお", 0, 3)          // 5文字を同時に見せる(背景で素早く切り替える。薄く、ちらつく)
basic.pause(5000)
kanjiLCD.clear()
kanjiLCD.showKanji("仙", 0)                      // 1文字なら固定表示(点滅しない)。漢字も文字のまま
kanjiLCD.showText("10/13", 11, 1)                // 英数字
// 点滅なしで1文字だけ出したいとき: kanjiLCD.setMode(kanjiLCD.KanjiMode.Fixed)
