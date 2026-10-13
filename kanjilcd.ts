/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 * 東雲フォント16x16(データは15x16に縮小済み)を、実行時にさらに 2x2マス(10x16ドット)へ縮め、
 * CGRAM 0〜3 / 4〜7 の2スロットに登録して表示する。
 * → 全角文字を同時に【2文字】表示できる(例: 日曜)。
 *
 * 文字の探し方: 収録文字を並べた文字列 KEYS から indexOf で探す(文字コードの数値は使わない)。
 * kanjifont.ts は変更不要(15x16のまま)。
 */

//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let customKeys: string[] = []
    let customBufs: Buffer[] = []
    let unit = 0

    // 2つのスロットがいま表示している桁(-1 = 未使用)と、最後に使ったスロット
    let slotCol: number[] = [-1, -1]
    let lastSlot = 1

    // 15ドット幅 → 10ドット幅の対応。出力の列 j は、元の列 LO[j]〜HI[j] のどれか1つでも点灯なら点灯。
    const COL_LO = [0, 1, 3, 4, 6, 7, 9, 10, 12, 13]
    const COL_HI = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14]

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
    // 15x16ドットのグリフ(base から30バイト)の bitpos 番目のドット
    function getBit(buf: Buffer, base: number, bitpos: number): number {
        let byte = base + (bitpos >> 3)
        return (buf.getUint8(byte) >> (7 - (bitpos & 7))) & 1
    }

    // グリフを 10x16 に縮めて、スロット slot (0か1) の CGRAM 4個に書き込む
    function writeGlyph(buf: Buffer, base: number, slot: number) {
        for (let c = 0; c < 4; c++) {
            let cx = c % 2          // 左右のマス
            let ry = c < 2 ? 0 : 1  // 上段/下段
            send(0x40 | ((slot * 4 + c) << 3), 0) // CGRAM の書き込み位置
            for (let y = 0; y < 8; y++) {
                let row = ry * 8 + y
                let v = 0
                for (let k = 0; k < 5; k++) {
                    let j = cx * 5 + k
                    let bit = 0
                    for (let s = COL_LO[j]; s <= COL_HI[j]; s++) {
                        if (getBit(buf, base, row * 15 + s) == 1) bit = 1
                    }
                    v |= bit << (4 - k)
                }
                send(v, 1)
            }
        }
    }

    // どのスロットに描くか。同じ桁(または重なる桁)に出ているスロットがあればそれを使い、
    // なければ前回と別のスロットを使う。
    function pickSlot(col: number): number {
        for (let i = 0; i < 2; i++) {
            if (slotCol[i] >= 0 && Math.abs(slotCol[i] - col) < 2) return i
        }
        lastSlot = 1 - lastSlot
        return lastSlot
    }

    // c は全角1文字ぶんの文字列
    function showChar(c: string, col: number): boolean {
        let k = customIndex(c)
        let idx = -1
        if (k < 0) {
            idx = findIndex(c)
            if (idx < 0) return false
        }
        let slot = pickSlot(col)
        slotCol[slot] = col
        if (k >= 0) {
            writeGlyph(customBufs[k], 0, slot)
        } else {
            writeGlyph(BLOCKS[Math.idiv(idx, BLOCK_SIZE)], (idx % BLOCK_SIZE) * 30, slot)
        }
        let b = slot * 4
        send(0x80 | col, 0)
        send(b, 1); send(b + 1, 1)          // 上段
        send(0xC0 | col, 0)
        send(b + 2, 1); send(b + 3, 1)      // 下段
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
        slotCol = [-1, -1]
        basic.pause(50)
        nib(0x30, 0)
        basic.pause(5)
        nib(0x30, 0)
        nib(0x30, 0)
        nib(0x20, 0)
        send(0x28, 0) // 4bit, 2行
        send(0x0C, 0) // 表示ON
        send(0x06, 0) // 右へ進む
        send(0x01, 0) // クリア
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
        slotCol = [-1, -1]
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
     * 漢字・ひらがな・カタカナを1文字表示する(2マス x 2段)。同時に2文字まで表示できる。
     * 桁は2つ以上離して指定する(例: 0 と 2)。
     * @param ch 表示する文字(1文字), eg: "日"
     * @param col 左端の桁(0〜14), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 文字 %ch を 桁 %col に表示"
    //% ch.defl="日" col.min=0 col.max=14 col.defl=0
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
    //% text.defl="仙台です" col.min=0 col.max=14 col.defl=0 ms.defl=800
    //% weight=85
    export function showSequence(text: string, col: number, ms: number = 800) {
        let u = getUnit()
        let i = 0
        while (i < text.length) {
            if (text.charCodeAt(i) < 128) {
                i += 1 // 英数字は読み飛ばす
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
    //% ch.defl="日"
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
