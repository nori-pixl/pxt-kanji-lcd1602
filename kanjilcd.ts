/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 *
 * ・ひらがな/カタカナ/記号 … 縦横比2:3 (10x15ドット = 2マス x 2段)
 * ・漢字 … 東雲フォント16x16を15x16に縮めたデータを、実行時に10x16(2マス x 2段)へ縮めて表示
 *
 * LCD1602 が自由に使える文字パターン(CGRAM)は8マスだけなので、全角文字は
 * 1種類につき4マス使い、【同時に表示できる字の種類は2つ】まで(同じ字なら何か所でも可)。
 * 3種類以上の字を表示するとき、このライブラリは自動で「2種類ずつのページ」に分けて
 * 一定時間ごとに切り替えて表示する(何文字でも表示できる)。
 *
 * 文字の探し方: 文字を UTF-8 のバイト列(Buffer.fromUTF8)に直して Unicode の数値を自分で計算し、
 * コード表(KANJI_CODES / KANA_CODES)から二分探索する。
 * (MakeCode の charCodeAt は漢字で下位1バイトしか返さず、「仙」(0x4ED9)と「ベ」(0x30D9)のように
 *  下位バイトが同じ文字が取り違えられるため、charCodeAt と indexOf は文字の判定に使わない)
 */

//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let customKeys: number[] = []
    let customBufs: Buffer[] = []
    let busy = false
    let lastLen = 1

    // 画面に置いた全角文字の一覧(置いた順)。各文字は2桁ぶんの幅。
    let items: number[] = []
    let cols: number[] = []
    // いま画面に描いている桁(消すときに使う)
    let shown: number[] = []
    // ページ切り替え
    let pageIdx = 0
    let pageMs = 1500
    let pageRunning = false

    // 15ドット幅 → 10ドット幅の対応(漢字用)。出力の列 j は、元の列 LO[j]〜HI[j] のどれか1つでも点灯なら点灯。
    const COL_LO = [0, 1, 3, 4, 6, 7, 9, 10, 12, 13]
    const COL_HI = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14]
    const KANA_BYTES = 19

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

    // ---------- 排他(ページ切り替えの背景処理と、メイン側の表示がぶつからないように) ----------
    function lock() {
        while (busy) basic.pause(2)
        busy = true
    }
    function unlock() {
        busy = false
    }

    // ---------- 文字の探索 ----------
    function hexVal(c: number): number {
        return c <= 57 ? c - 48 : (c <= 70 ? c - 55 : c - 87)
    }

    function customIndex(code: number): number {
        for (let i = 0; i < customKeys.length; i++) {
            if (customKeys[i] == code) return i
        }
        return -1
    }

    // UTF-8 のバイト列 b の i バイト目から始まる1文字の文字コード(Unicode)を返す。
    // その文字のバイト数は lastLen に入る。読めないときは -1。
    function cpAt(b: Buffer, i: number): number {
        let c = b.getUint8(i)
        lastLen = 1
        if (c < 0x80) return c
        if (c >= 0xF0) {
            lastLen = 4
            return -1
        }
        if (c >= 0xE0) {
            if (i + 2 >= b.length) return -1
            lastLen = 3
            return ((c & 0x0F) << 12) | ((b.getUint8(i + 1) & 0x3F) << 6) | (b.getUint8(i + 2) & 0x3F)
        }
        if (c >= 0xC0) {
            if (i + 1 >= b.length) return -1
            lastLen = 2
            return ((c & 0x1F) << 6) | (b.getUint8(i + 1) & 0x3F)
        }
        return -1
    }

    // 文字列 s の最初の1文字の文字コード。空なら -1
    function firstCode(s: string): number {
        let b = Buffer.fromUTF8(s)
        if (b.length == 0) return -1
        return cpAt(b, 0)
    }

    // 2バイトずつ昇順に並んだコード表 codes(count個)から code を二分探索。番号 or -1
    function searchCode(codes: Buffer, count: number, code: number): number {
        let lo = 0
        let hi = count - 1
        while (lo <= hi) {
            let mid = (lo + hi) >> 1
            let v = (codes.getUint8(mid * 2) << 8) | codes.getUint8(mid * 2 + 1)
            if (v == code) return mid
            if (v < code) lo = mid + 1
            else hi = mid - 1
        }
        return -1
    }

    // 漢字は 0x4E00〜0x9FFF だけ漢字表(KEYS)、それ以外はかな表(KANA_KEYS)を引く。表をまたいで探さない。
    function isKanjiCode(code: number): boolean {
        return code >= 0x4E00 && code <= 0x9FFF
    }

    function findIndex(code: number): number {
        if (!isKanjiCode(code)) return -1
        return searchCode(KANJI_CODES, GLYPH_COUNT, code)
    }

    function findKana(code: number): number {
        if (code < 0 || isKanjiCode(code)) return -1
        return searchCode(KANA_CODES, KANA_COUNT, code)
    }

    function hasGlyph(code: number): boolean {
        return code >= 0 && (customIndex(code) >= 0 || findKana(code) >= 0 || findIndex(code) >= 0)
    }

    // ---------- グリフをCGRAMへ ----------
    // 15x16ドットの漢字グリフ(base から30バイト)の bitpos 番目のドット
    function getBit(buf: Buffer, base: number, bitpos: number): number {
        let byte = base + (bitpos >> 3)
        return (buf.getUint8(byte) >> (7 - (bitpos & 7))) & 1
    }

    // 漢字: 15x16 を 10x16 に縮めて、スロット slot (0か1) の CGRAM 4個に書き込む
    function writeKanji(buf: Buffer, base: number, slot: number) {
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

    // かな: 10x15(縦横比2:3)をそのまま 2x2マスに書き込む。16行目は空行。
    function writeKana(buf: Buffer, base: number, slot: number) {
        for (let c = 0; c < 4; c++) {
            let cx = c % 2
            let ry = c < 2 ? 0 : 1
            send(0x40 | ((slot * 4 + c) << 3), 0)
            for (let y = 0; y < 8; y++) {
                let row = ry * 8 + y
                let v = 0
                if (row < 15) {
                    for (let k = 0; k < 5; k++) {
                        v |= getBit(buf, base, row * 10 + cx * 5 + k) << (4 - k)
                    }
                }
                send(v, 1)
            }
        }
    }

    // 文字 g をスロット slot に書く。見つからなければ false
    function writeGlyph(g: number, slot: number): boolean {
        let k = customIndex(g)
        if (k >= 0) {
            writeKanji(customBufs[k], 0, slot)
            return true
        }
        let n = findKana(g)
        if (n >= 0) {
            writeKana(KANA_BLOCKS[Math.idiv(n, KANA_BLOCK_SIZE)], (n % KANA_BLOCK_SIZE) * KANA_BYTES, slot)
            return true
        }
        let idx = findIndex(g)
        if (idx >= 0) {
            writeKanji(BLOCKS[Math.idiv(idx, BLOCK_SIZE)], (idx % BLOCK_SIZE) * 30, slot)
            return true
        }
        return false
    }

    // ---------- 配置とページ ----------
    // items を「字の種類が2つまで」のページに分ける(最初に入る所に入れる)。各ページは items の番号の配列。
    function buildPages(): number[][] {
        let pages: number[][] = []
        let kinds: number[][] = []
        for (let i = 0; i < items.length; i++) {
            let done = false
            for (let p = 0; p < pages.length; p++) {
                if (kinds[p].indexOf(items[i]) >= 0 || kinds[p].length < 2) {
                    if (kinds[p].indexOf(items[i]) < 0) kinds[p].push(items[i])
                    pages[p].push(i)
                    done = true
                    break
                }
            }
            if (!done) {
                pages.push([i])
                kinds.push([items[i]])
            }
        }
        return pages
    }

    function blankAt(col: number) {
        send(0x80 | col, 0)
        send(0x20, 1); send(0x20, 1)
        send(0xC0 | col, 0)
        send(0x20, 1); send(0x20, 1)
    }

    // 1ページぶんを描く: いま描いてある字を消し → CGRAMを書き → 各桁に置く
    function drawPage(page: number[]) {
        for (let i = 0; i < shown.length; i++) blankAt(shown[i])
        shown = []
        let kinds: number[] = []
        for (let n = 0; n < page.length; n++) {
            let g = items[page[n]]
            if (kinds.indexOf(g) < 0) {
                writeGlyph(g, kinds.length)
                kinds.push(g)
            }
        }
        for (let n = 0; n < page.length; n++) {
            let col = cols[page[n]]
            let b = kinds.indexOf(items[page[n]]) * 4
            send(0x80 | col, 0)
            send(b, 1); send(b + 1, 1)          // 上段
            send(0xC0 | col, 0)
            send(b + 2, 1); send(b + 3, 1)      // 下段
            shown.push(col)
        }
    }

    // 2ページ以上あるとき、一定時間ごとにページを切り替える
    function startPaging() {
        if (pageRunning) return
        pageRunning = true
        control.inBackground(function () {
            while (true) {
                basic.pause(pageMs)
                lock()
                let pages = buildPages()
                if (pages.length < 2) {
                    pageRunning = false
                    unlock()
                    return
                }
                pageIdx = (pageIdx + 1) % pages.length
                drawPage(pages[pageIdx])
                unlock()
            }
        })
    }

    // 配置を変えたあとに画面へ反映する。showLast=true なら最後に置いた字があるページを、falseなら先頭ページを出す。
    function refresh(showLast: boolean) {
        let pages = buildPages()
        if (pages.length == 0) return
        pageIdx = 0
        if (showLast) {
            let last = items.length - 1
            for (let p = 0; p < pages.length; p++) {
                if (pages[p].indexOf(last) >= 0) pageIdx = p
            }
        }
        drawPage(pages[pageIdx])
        if (pages.length > 1) startPaging()
    }

    // 文字を配置に追加(桁が重なる古い字は取り除く)。描画はしない。
    function addItem(g: number, col: number): boolean {
        if (col < 0 || col > 14 || !hasGlyph(g)) return false
        let i = 0
        while (i < items.length) {
            if (Math.abs(cols[i] - col) < 2) {
                items.removeAt(i)
                cols.removeAt(i)
            } else {
                i++
            }
        }
        items.push(g)
        cols.push(col)
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
        lock()
        addr = address
        items = []
        cols = []
        shown = []
        pageIdx = 0
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
        unlock()
    }

    /**
     * 画面を消す
     */
    //% blockId=kanjilcd_clear block="漢字LCD 画面を消す"
    //% weight=95
    export function clear() {
        lock()
        send(0x01, 0)
        basic.pause(2)
        items = []
        cols = []
        shown = []
        pageIdx = 0
        unlock()
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
     * 漢字・ひらがな・カタカナを1文字表示する(2マス x 2段)。
     * 続けて何文字置いてもよい。字の種類が3つ以上になると、2種類ずつ自動でページ切り替えして表示する。
     * 桁は2つ以上離して指定する(例: 0, 2, 4 または 0, 3, 6)。
     * @param ch 表示する文字(1文字), eg: "あ"
     * @param col 左端の桁(0〜14), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 文字 %ch を 桁 %col に表示"
    //% ch.defl="あ" col.min=0 col.max=14 col.defl=0
    //% weight=90
    export function showKanji(ch: string, col: number) {
        let g = firstCode(ch)
        if (g < 0) return
        lock()
        if (addItem(g, col)) refresh(true)
        unlock()
    }

    /**
     * 文字列を左から順に並べて表示する。何文字でもよい。
     * 字の種類が3つ以上になると、2種類ずつ自動でページ切り替えして表示する。
     * @param text 文字列, eg: "あいうえお"
     * @param col 最初の文字の左端の桁, eg: 0
     * @param step 1文字ごとの桁の間隔(2以上), eg: 2
     */
    //% blockId=kanjilcd_string block="漢字LCD 文字列 %text を 桁 %col から %step 桁おきに表示"
    //% text.defl="あいうえお" col.min=0 col.max=14 col.defl=0 step.min=2 step.max=8 step.defl=2
    //% weight=88
    export function showString(text: string, col: number, step: number = 2) {
        if (step < 2) step = 2
        let b = Buffer.fromUTF8(text)
        let c = col
        let i = 0
        let any = false
        lock()
        while (i < b.length) {
            let g = cpAt(b, i)
            i += lastLen
            if (g >= 128) {
                if (addItem(g, c)) {
                    any = true
                    c += step
                }
            }
        }
        if (any) refresh(false)
        unlock()
    }

    /**
     * ページ切り替えの間隔(ミリ秒)を決める。
     * @param ms 間隔, eg: 1500
     */
    //% blockId=kanjilcd_pagems block="漢字LCD ページ切り替え %ms ms"
    //% ms.defl=1500 ms.min=300 ms.max=10000
    //% weight=86
    export function setPageTime(ms: number) {
        pageMs = ms
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
        let b = Buffer.fromUTF8(text)
        let i = 0
        while (i < b.length) {
            let g = cpAt(b, i)
            i += lastLen
            if (g >= 128) {
                lock()
                items = []
                cols = []
                let ok = addItem(g, col)
                if (ok) refresh(true)
                unlock()
                if (ok) basic.pause(ms)
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
        return hasGlyph(firstCode(ch))
    }

    /**
     * 診断用: 「文字数/文字コード/漢字の収録番号/かなの収録番号/UTF-8のバイト数」を文字列で返す。「仙」なら 1/20185/37/-1/3 になる。表示できないときの調査に使う。
     * @param ch 調べる文字, eg: "あ"
     */
    //% blockId=kanjilcd_debug block="漢字LCD 診断 %ch"
    //% ch.defl="あ"
    //% weight=65 advanced=true
    export function debugInfo(ch: string): string {
        let g = firstCode(ch)
        return "" + ch.length + "/" + g + "/" + findIndex(g) + "/" + findKana(g) + "/" + Buffer.fromUTF8(ch).length
    }

    /**
     * 文字を自分で追加する(60桁の16進文字列。15x16ドットの漢字と同じ形式)。
     * @param ch 文字1つ
     * @param hex 60桁の16進文字列
     */
    //% blockId=kanjilcd_reg block="漢字LCD 文字 %ch を登録 データ %hex"
    //% weight=60 advanced=true
    export function registerKanji(ch: string, hex: string) {
        let g = firstCode(ch)
        if (g < 0 || hex.length != 60) return
        let buf = pins.createBuffer(30)
        for (let i = 0; i < 30; i++) {
            buf.setUint8(i, hexVal(hex.charCodeAt(i * 2)) * 16 + hexVal(hex.charCodeAt(i * 2 + 1)))
        }
        let k = customIndex(g)
        if (k >= 0) {
            customBufs[k] = buf
        } else {
            customKeys.push(g)
            customBufs.push(buf)
        }
    }
            }
