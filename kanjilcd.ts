/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 * 東雲フォント16x16を 3x2マス(15x16ドット)に縮小し、CGRAM 0〜5 に登録して表示する。
 * 同時に表示できる全角文字は1文字。CGRAM 6,7 は使わないので他の用途に使える。
 *
 * 文字の探し方: 収録文字を並べた文字列 KEYS から indexOf で探す(文字コードの数値は使わない)。
 */
//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let customKeys: string[] = []
    let customBufs: Buffer[] = []
    let unit = 0

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

    // ---------- 文字の探索 ----------
    // 全角1文字が文字列の何単位ぶんか。UTF-16単位なら1、UTF-8バイト単位なら3。
    // (KEYS は3バイト文字だけでできているので、長さで判定できる)
    function getUnit(): number {
        if (unit == 0) unit = KEYS.length > GLYPH_COUNT ? 3 : 1
        return unit
    }

    function hexVal(c: number): number {
        return c <= 57 ? c - 48 : (c <= 70 ? c - 55 : c - 87)
    }

    function customIndex(c: string): number {
        for (let i = 0; i < customKeys.length; i++) {
            if (customKeys[i] == c) return i
        }
        return -1
    }

    // 収録文字の番号(組み込み)。無ければ -1
    function findIndex(c: string): number {
        if (c.length == 0) return -1
        let p = KEYS.indexOf(c)
        if (p < 0) return -1
        return getUnit() == 3 ? Math.idiv(p, 3) : p
    }

    // ---------- 表示 ----------
    function writeGlyph(buf: Buffer, base: number) {
        for (let c = 0; c < 6; c++) {
            let cx = c % 3
            let ry = c < 3 ? 0 : 1
            send(0x40 | (c << 3), 0)                       // CGRAM c
            for (let y = 0; y < 8; y++) {
                let pos = (ry * 8 + y) * 15 + cx * 5
                let byte = base + (pos >> 3)
                let v = buf.getUint8(byte) << 8
                if (byte + 1 < buf.length) v |= buf.getUint8(byte + 1)
                send((v >> (11 - (pos & 7))) & 31, 1)
            }
        }
    }

    // c は全角1文字ぶんの文字列
    function showChar(c: string, col: number): boolean {
        let k = customIndex(c)
        if (k >= 0) {
            writeGlyph(customBufs[k], 0)
        } else {
            let idx = findIndex(c)
            if (idx < 0) return false
            writeGlyph(BLOCKS[Math.idiv(idx, BLOCK_SIZE)], (idx % BLOCK_SIZE) * 30)
        }
        send(0x80 | col, 0)
        send(0, 1); send(1, 1); send(2, 1)                 // 上段
        send(0xC0 | col, 0)
        send(3, 1); send(4, 1); send(5, 1)                 // 下段
        return true
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
     * 漢字・ひらがな・カタカナを1文字表示する(3マス x 2段)。
     * @param ch 表示する文字(1文字), eg: "仙"
     * @param col 左端の桁(0〜13), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 文字 %ch を 桁 %col に表示"
    //% ch.defl="仙" col.min=0 col.max=13 col.defl=0
    //% weight=90
    export function showKanji(ch: string, col: number) {
        let u = getUnit()
        if (ch.length < u) return
        showChar(ch.substr(0, u), col)
    }

    /**
     * 文字列を1文字ずつ切り替えて表示する。
     * @param text 文字列, eg: "仙台です"
     * @param col 左端の桁, eg: 0
     * @param ms 切り替え間隔(ミリ秒), eg: 800
     */
    //% blockId=kanjilcd_seq block="漢字LCD %text を 桁 %col に %ms ms ごとに順に表示"
    //% text.defl="仙台です" col.min=0 col.max=13 col.defl=0 ms.defl=800
    //% weight=85
    export function showSequence(text: string, col: number, ms: number = 800) {
        let u = getUnit()
        let i = 0
        while (i < text.length) {
            if (text.charCodeAt(i) < 128) {
                i += 1                                   // 英数字は読み飛ばす
            } else {
                if (showChar(text.substr(i, u), col)) basic.pause(ms)
                i += u
            }
        }
    }

    /**
     * 英数字(通常の文字)を表示する。
     * @param s 表示する文字列, eg: "12/31"
     * @param col 桁(0〜15), eg: 4
     * @param row 行(0または1), eg: 0
     */
    //% blockId=kanjilcd_text block="漢字LCD 英数字 %s を 桁 %col 行 %row に表示"
    //% s.defl="12/31" col.min=0 col.max=15 col.defl=4 row.min=0 row.max=1
    //% weight=80
    export function showText(s: string, col: number, row: number) {
        send((row == 0 ? 0x80 : 0xC0) | col, 0)
        for (let i = 0; i < s.length; i++) {
            send(s.charCodeAt(i), 1)
        }
    }

    /**
     * その文字が収録されているか調べる。
     */
    //% blockId=kanjilcd_has block="漢字LCD %ch は収録されている"
    //% ch.defl="仙"
    //% weight=70 advanced=true
    export function hasKanji(ch: string): boolean {
        let u = getUnit()
        if (ch.length < u) return false
        let c = ch.substr(0, u)
        return customIndex(c) >= 0 || findIndex(c) >= 0
    }

    /**
     * 診断用: 「文字列の長さ/収録番号/文字列の単位」を文字列で返す。表示できないときの調査に使う。
     * @param ch 調べる文字, eg: "月"
     */
    //% blockId=kanjilcd_debug block="漢字LCD 診断 %ch"
    //% ch.defl="月"
    //% weight=65 advanced=true
    export function debugInfo(ch: string): string {
        let u = getUnit()
        let c = ch.substr(0, u)
        return "" + ch.length + "/" + findIndex(c) + "/" + u
    }

    /**
     * 文字を自分で追加する(60桁の16進文字列)。
     * @param ch 文字1つ
     * @param hex 60桁の16進文字列
     */
    //% blockId=kanjilcd_reg block="漢字LCD 文字 %ch を登録 データ %hex"
    //% weight=60 advanced=true
    export function registerKanji(ch: string, hex: string) {
        let u = getUnit()
        if (ch.length < u || hex.length != 60) return
        let c = ch.substr(0, u)
        let buf = pins.createBuffer(30)
        for (let i = 0; i < 30; i++) {
            buf.setUint8(i, hexVal(hex.charCodeAt(i * 2)) * 16 + hexVal(hex.charCodeAt(i * 2 + 1)))
        }
        let k = customIndex(c)
        if (k >= 0) {
            customBufs[k] = buf
        } else {
            customKeys.push(c)
            customBufs.push(buf)
        }
    }
}
