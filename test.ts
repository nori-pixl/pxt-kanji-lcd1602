// 漢字LCD(内部で i2cLCD1602 を使う)
kanjiLCD.init(0x27)                       // i2cLCD1602 の初期化も行う。アドレスは 39(0x27) か 63(0x3F)
kanjiLCD.setWidth(2)                      // 幅2マス = 同時に2文字
kanjiLCD.showKanji("日", 0)
kanjiLCD.showKanji("曜", 2)
kanjiLCD.showText("10/13", 5, 0)          // 英数字
