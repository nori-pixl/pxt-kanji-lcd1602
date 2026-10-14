// 漢字LCD の動作確認(i2cLCD1602 を使っているプロジェクトならそのまま共存できます)
kanjiLCD.init(0x27)                                              // アドレスは 39(0x27) か 63(0x3F)
// 1文字は 縦2マス x 横3マス(15x16ドット、線は1ドット幅の細い字)。固定で表示し、点滅しません。
// 同時に固定で出せるのは、たいてい1文字です。
kanjiLCD.showKanji("あ", 0)
kanjiLCD.showText("10/13", 11, 1)                                // 英数字
basic.pause(2000)
// 何文字も出したいときは、1文字ずつ順に切り替えます
kanjiLCD.showSequence("あいう", 0, 800)
// 漢字も文字のまま指定できます
kanjiLCD.showSequence("仙台の日曜", 0, 800)
// 数字の文字コードで指定したいとき: kanjiLCD.showCode(20185, 0)    // 仙
