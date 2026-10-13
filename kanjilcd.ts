/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 * 東雲フォント(データは15x16ドット)を、1文字あたり「幅2マス(10x16)」または「幅3マス(15x16)」で表示する。
 *   幅2マス: CGRAM 4個/文字 → 同時に【2文字】まで(例: 日曜)。  ← 初期値
 *   幅3マス: CGRAM 6個/文字 → 同時に1文字だけ。いちばん綺麗。
 * 幅は「漢字LCD 1文字の幅 ○ マス」ブロック(setWidth)で切り替える。
 *
 * 文字の探し方: 収録文字を並べた文字列 KEYS から indexOf で探す(文字コードの数値は使わない)。
 * 実行環境によって文字列が UTF-16 単位でも UTF-8 バイト単位でも動くように、
 * 初期化時に KEYS の並びから単位を判定し、見つけた位置は KEYS 側で照合してから使う。
 * kanjifont.ts は変更不要。
 */

//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let customKeys: string[] = []
    let customBufs: Buffer[] = []
    let unit = 0

    let cells = 2                 // 1文字の幅(マス数): 2 または 3
    let slotCol: number[] = [-1, -1]  // 各スロットがいま表示している桁(-1 = 未使用)
    let lastSlot = 1

    // 縮小のとき、出力ドットの何%以上が点灯なら点灯にするか(小さいほど線が残り、大きいほど細く軽くなる)
    const FILL = 30

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
    // 全角1文字が KEYS の何単位ぶんか。KEYS の2文字目「。」の位置で判定する
    // (UTF-16単位なら1、UTF-8バイト単位なら3)。
    function getUnit(): number {
        if (unit == 0) unit = KEYS.indexOf("。") >= 3 ? 3 : 1
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

    // 収録文字の番号(組み込み)。無ければ -1。
    // indexOf で見つけた位置に、c とまったく同じ文字が並んでいるか照合する(途中のバイトへの誤一致を防ぐ)。
    function findIndex(c: string): number {
        if (c.length == 0) return -1
        let p = KEYS.indexOf(c)
        if (p < 0) return -1
        let u = getUnit()
        if (KEYS.substr(p, u) != c) return -1
        return Math.idiv(p, u)
    }

    function found(c: string): boolean {
        return c.length > 0 && (customIndex(c) >= 0 || findIndex(c) >= 0)
    }

    // s の i 文字目から始まる全角1文字(収録されているもの)を返す。無ければ ""。
    function pickChar(s: string, i: number): string {
        let c = s.substr(i, 1)
        if (found(c)) return c
        let u = getUnit()
        if (u > 1) {
            c = s.substr(i, u)
            if (found(c)) return c
        }
        return ""
    }

    // ---------- 表示 ----------
    // 15x16ドットのグリフ(base から30バイト)の bitpos 番目のドット
    function getBit(buf: Buffer, base: number, bitpos: number): number {
        let byte = base + (bitpos >> 3)
        return (buf.getUint8(byte) >> (7 - (bitpos & 7))) & 1
    }

    // グリフを cells マス幅に縮め(cells=3 ならそのまま)、スロット slot の CGRAM に書き込む
    function writeGlyph(buf: Buffer, base: number, slot: number) {
        let dw = cells * 5          // 出力のドット幅
        let per = cells * 2         // 1文字あたりのCGRAM数
        for (let c = 0; c < per; c++) {
            let cx = c % cells
            let ry = c < cells ? 0 : 1
            send(0x40 | ((slot * per + c) << 3), 0) // CGRAM の書き込み位置
            for (let y = 0; y < 8; y++) {
                let row = ry * 8 + y
                let v = 0
                for (let k = 0; k < 5; k++) {
                    // 出力の列 j は、元の15列を dw 分割した範囲 [lo, hi) (単位: 1/dw 列)に当たる
                    let j = cx * 5 + k
                    let lo = j * 15
                    let hi = lo + 15
                    let sum = 0
                    for (let i = Math.idiv(lo, dw); i < 15 && i * dw < hi; i++) {
                        if (getBit(buf, base, row * 15 + i) == 1) {
                            let o = Math.min(hi, (i + 1) * dw) - Math.max(lo, i * dw)
                            if (o > 0) sum += o
                        }
                    }
                    if (sum * 100 >= 15 * FILL) v |= 1 << (4 - k)
                }
                send(v, 1)
            }
        }
    }

    // どのスロットに描くか。同じ桁(または重なる桁)に出ているスロットがあればそれを使い、
    // なければ前回と別のスロットを使う。
    function pickSlot(col: number): number {
        let slots = cells == 2 ? 2 : 1
        for (let i = 0; i < slots; i++) {
            if (slotCol[i] >= 0 && Math.abs(slotCol[i] - col) < cells) return i
        }
        if (slots == 1) return 0
        lastSlot = 1 - lastSlot
        return lastSlot
    }

    // c は全角1文字ぶんの文字列(found(c) が真のもの)
    function showChar(c: string, col: number) {
        let k = customIndex(c)
        let idx = k >= 0 ? -1 : findIndex(c)
        let slot = pickSlot(col)
        slotCol[slot] = col
        if (k >= 0) {
            writeGlyph(customBufs[k], 0, slot)
        } else {
            writeGlyph(BLOCKS[Math.idiv(idx, BLOCK_SIZE)], (idx % BLOCK_SIZE) * 30, slot)
        }
        let b = slot * cells * 2
        send(0x80 | col, 0)
        for (let i = 0; i < cells; i++) send(b + i, 1)             // 上段
        send(0xC0 | col, 0)
        for (let i = 0; i < cells; i++) send(b + cells + i, 1)     // 下段
    }

    // ---------- ブロック ----------
    /**
     * LCDを初期化する。アドレスは 0x27 か 0x3F が多い。
     * 別のLCDライブラリで初期化済みなら、このブロックは不要。
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
     * 1文字の幅をマス数で決める。2マス=同時に2文字まで、3マス=1文字だけ(綺麗)。
     * @param w 2 または 3, eg: 2
     */
    //% blockId=kanjilcd_width block="漢字LCD 1文字の幅 %w マス"
    //% w.min=2 w.max=3 w.defl=2
    //% weight=92
    export function setWidth(w: number) {
        cells = w >= 3 ? 3 : 2
        slotCol = [-1, -1]
        lastSlot = 1
    }

    /**
     * 漢字・ひらがな・カタカナを1文字表示する(縦2マス、横は幅の設定どおり)。
     * 幅2マスなら同時に2文字まで。桁は幅の分だけ離して指定する(例: 0 と 2)。
     * @param ch 表示する文字(1文字), eg: "日"
     * @param col 左端の桁(0〜14), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 文字 %ch を 桁 %col に表示"
    //% ch.defl="日" col.min=0 col.max=14 col.defl=0
    //% weight=90
    export function showKanji(ch: string, col: number) {
        let c = pickChar(ch, 0)
        if (c.length == 0) return
        showChar(c, col)
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
        let i = 0
        while (i < text.length) {
            if (text.charCodeAt(i) < 128) {
                i += 1 // 英数字は読み飛ばす
            } else {
                let c = pickChar(text, i)
                if (c.length == 0) {
                    i += getUnit()
                } else {
                    showChar(c, col)
                    basic.pause(ms)
                    i += c.length
                }
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
        return pickChar(ch, 0).length > 0
    }

    /**
     * 診断用: 「文字列の長さ/収録番号/文字列の単位」を文字列で返す。表示できないときの調査に使う。
     * @param ch 調べる文字, eg: "日"
     */
    //% blockId=kanjilcd_debug block="漢字LCD 診断 %ch"
    //% ch.defl="日"
    //% weight=65 advanced=true
    export function debugInfo(ch: string): string {
        return "" + ch.length + "/" + findIndex(pickChar(ch, 0)) + "/" + getUnit()
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
