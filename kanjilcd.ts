/**
 * LCD1602(I2C, PCF8574バックパック)に漢字を表示するライブラリ。
 * 東雲フォント16x16を 3x2マス(15x16ドット)に縮小し、CGRAM 0〜5 に登録して表示する。
 * 同時に表示できる漢字は1文字。CGRAM 6,7 は使わないので他の用途に使える。
 */
//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let keys: string[] = []
    let data: string[] = []
    let loaded = false

    // ---------- 低レベルI2C ----------
    function wr(v: number) {
        pins.i2cWriteBuffer(addr, pins.createBufferFromArray([v | backlight]))
    }
    function nib(v: number, rs: number) {
        wr((v & 0xF0) | rs | 0x04)
        wr((v & 0xF0) | rs)
    }
    function send(v: number, rs: number) {
        nib(v, rs)
        nib(v << 4, rs)
    }

    // ---------- フォントデータ ----------
    function hexVal(c: number): number {
        return c <= 57 ? c - 48 : c - 55   // '0'=48, 'A'=65
    }

    function load() {
        if (loaded) return
        loaded = true
        let items = FONT_DATA.split(",")
        for (let i = 0; i < items.length; i++) {
            let it = items[i]
            let p = it.indexOf("=")
            if (p > 0) {
                keys.push(it.substr(0, p))
                data.push(it.substr(p + 1))
            }
        }
    }

    function find(ch: string): number {
        load()
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] == ch) return i
        }
        return -1
    }

    // ---------- ブロック ----------

    /**
     * LCDを初期化する。アドレスは 0x27 か 0x3F が多い。
     * @param address I2Cアドレス, eg: 39
     */
    //% blockId=kanjilcd_init block="漢字LCDを初期化 I2Cアドレス %address"
    //% address.defl=39
    //% weight=100
    export function init(address: number = 0x27) {
        addr = address
        load()
        basic.pause(50)
        nib(0x30, 0)
        basic.pause(5)
        nib(0x30, 0)
        nib(0x30, 0)
        nib(0x20, 0)
        send(0x28, 0)   // 4bit, 2行
        send(0x0C, 0)   // 表示ON
        send(0x06, 0)   // 右へ進む
        send(0x01, 0)   // クリア
        basic.pause(2)
    }

    /**
     * 画面を消す
     */
    //% blockId=kanjilcd_clear block="漢字LCD 画面を消す"
    //% weight=95
    export function clear() {
        send(0x01, 0)
        basic.pause(2)
    }

    /**
     * バックライトのオン/オフ
     */
    //% blockId=kanjilcd_bl block="漢字LCD バックライト %on"
    //% on.shadow=toggleOnOff on.defl=true
    //% weight=94
    export function setBacklight(on: boolean) {
        backlight = on ? 0x08 : 0x00
        wr(0)
    }

    /**
     * 漢字を1文字表示する(3マス x 2段)。
     * @param ch 表示する漢字(1文字), eg: "月"
     * @param col 左端の桁(0〜13), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 漢字 %ch を 桁 %col に表示"
    //% ch.defl="月" col.min=0 col.max=13 col.defl=0
    //% weight=90
    export function showKanji(ch: string, col: number) {
        let i = find(ch)
        if (i < 0) return
        let h = data[i]
        for (let c = 0; c < 6; c++) {
            send(0x40 | (c << 3), 0)                       // CGRAM c
            for (let y = 0; y < 8; y++) {
                let p = (c * 8 + y) * 2
                send(hexVal(h.charCodeAt(p)) * 16 + hexVal(h.charCodeAt(p + 1)), 1)
            }
        }
        send(0x80 | col, 0)
        send(0, 1); send(1, 1); send(2, 1)                 // 上段
        send(0xC0 | col, 0)
        send(3, 1); send(4, 1); send(5, 1)                 // 下段
    }

    /**
     * 文字列を1文字ずつ切り替えて表示する。
     * @param text 漢字の文字列, eg: "月火水"
     * @param col 左端の桁, eg: 0
     * @param ms 切り替え間隔(ミリ秒), eg: 800
     */
    //% blockId=kanjilcd_seq block="漢字LCD %text を 桁 %col に %ms ms ごとに順に表示"
    //% text.defl="月火水" col.min=0 col.max=13 col.defl=0 ms.defl=800
    //% weight=85
    export function showSequence(text: string, col: number, ms: number = 800) {
        load()
        let i = 0
        while (i < text.length) {
            let hit = false
            for (let k = 0; k < keys.length; k++) {
                // text/keys の長さの単位が同じなので、文字コードの扱いに依存しない
                if (text.substr(i, keys[k].length) == keys[k]) {
                    showKanji(keys[k], col)
                    basic.pause(ms)
                    i += keys[k].length
                    hit = true
                    break
                }
            }
            if (!hit) i += 1
        }
    }

    /**
     * 英数字(通常の文字)を表示する。
     * @param s 表示する文字列, eg: "12/31"
     * @param col 桁(0〜15), eg: 4
     * @param row 行(0または1), eg: 0
     */
    //% blockId=kanjilcd_text block="漢字LCD 文字 %s を 桁 %col 行 %row に表示"
    //% s.defl="12/31" col.min=0 col.max=15 col.defl=4 row.min=0 row.max=1
    //% weight=80
    export function showText(s: string, col: number, row: number) {
        send((row == 0 ? 0x80 : 0xC0) | col, 0)
        for (let i = 0; i < s.length; i++) {
            send(s.charCodeAt(i), 1)
        }
    }

    /**
     * 組み込みの漢字があるか調べる。
     */
    //% blockId=kanjilcd_has block="漢字LCD %ch は使える"
    //% ch.defl="月"
    //% weight=70 advanced=true
    export function hasKanji(ch: string): boolean {
        return find(ch) >= 0
    }

    /**
     * 漢字を自分で追加する(tools/make_font.py で作った96桁の16進文字列)。
     * @param ch 漢字1文字
     * @param hex 96桁の16進文字列
     */
    //% blockId=kanjilcd_reg block="漢字LCD 漢字 %ch を登録 データ %hex"
    //% weight=60 advanced=true
    export function registerKanji(ch: string, hex: string) {
        load()
        if (hex.length != 96) return
        let i = find(ch)
        if (i >= 0) {
            data[i] = hex
        } else {
            keys.push(ch)
            data.push(hex)
        }
    }
}
