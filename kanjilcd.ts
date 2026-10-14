/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 *
 * すべての字(ひらがな・カタカナ・記号・全角英数・漢字)は 縦2マス x 横3マス(15x16ドット)の、
 * 東雲フォントそのままの細い字(線は1ドット幅)。横に縮めたり伸ばしたりしないので、線が太くならない。
 *
 * LCD1602 が自由に使える文字パターン(CGRAM)は8マスだけで、1文字に6マス使うので、
 * 一瞬に持てる字の種類は1つ。字の種類が2つ以上のときは、背景で種類を順に【高速に】切り替え続ける。
 * 液晶は反応が遅いので、何文字でも「同時に点いている」ように見える(文字数が多いほど少し暗く、ちらつく)。
 * 切り替えの間の待ちは setPageTime(ミリ秒)で変えられる(0 = いちばん速い。大きくすると1文字ずつゆっくり)。
 *
 * 文字の探し方: 文字コード(Unicode)の数値を、コード表(KANJI_CODES)から二分探索する。
 *
 * 【重要】MakeCode の実機(古い micro:bit 環境)では、文字列に入れた全角文字は下位1バイトしか
 * プログラムに届かないことがある(「仙」0x4ED9 と「ベ」0x30D9 が同じ 0xD9 になる)。
 * そこでこのライブラリは次のように使い分ける。
 *   ・文字コードがちゃんと取れる環境 … 文字列(漢字を含む)をそのまま使える
 *   ・下位1バイトしか取れない環境   … ひらがな・カタカナ・記号は文字列から推測して復元できる。
 *                                     漢字は文字列では判別できないので「文字コード」(数値)で指定する
 *                                     (showCode / showCodes。例: 仙 = 20185)。
 *   どちらの環境かは「漢字LCD 診断」の最後の数字(0=正常 1=下位1バイトのみ)で分かる。
 */

//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    let addr = 0x27
    let backlight = 0x08
    let customKeys: number[] = []
    let customBufs: Buffer[] = []
    let busy = false
    let lastLen = 1
    let lossy = -1   // 1: 下位1バイトしか取れない環境 / 0: 正常 / -1: 未判定

    // 画面に置いた全角文字の一覧(置いた順)。各文字は2桁ぶんの幅。
    let items: number[] = []
    let cols: number[] = []
    // いま画面に描いている桁(消すときに使う)
    let shown: number[] = []
    // 字の切り替え
    let pageIdx = 0
    let pageMs = 0       // 字を切り替える間の待ち(ミリ秒)。0 = できるだけ速く(全部の字が同時に点いて見える)
    let wantLock = 0
    let q: number[] = []   // まとめて送るI2Cのバイト列
    let pageRunning = false
    const cells = 3   // 1文字の横のマス数(縦は2マス)

    const GLYPH_BYTES = 30   // 1グリフ 15x16ドット = 30バイト

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

    // 速く切り替えるために、LCDへの命令・データをまとめて(最大60バイトずつ)1回のI2Cで送る
    function qnib(v: number, rs: number) {
        q.push((v & 0xF0) | rs | 0x04 | backlight)
        q.push((v & 0xF0) | rs | backlight)
    }
    function qsend(v: number, rs: number) {
        qnib(v, rs)
        qnib(v << 4, rs)
    }
    function flush() {
        let i = 0
        while (i < q.length) {
            let n = q.length - i
            if (n > 60) n = 60
            pins.i2cWriteBuffer(addr, pins.createBufferFromArray(q.slice(i, i + n)))
            i += n
        }
        q = []
    }

    // ---------- 排他(背景の切り替えと、メイン側の表示がぶつからないように) ----------
    function lock() {
        wantLock++
        while (busy) basic.pause(1)
        busy = true
        wantLock--
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

    // 文字列の中身の形を判定する(最初の1回だけ)。
    //   "あ" の長さが2以上 → UTF-8のバイト列(全角1文字=3バイト)
    //   "あ" の文字コードが256未満 → 下位1バイトしか取れない環境
    function isLossy(): boolean {
        if (lossy < 0) lossy = ("あ".length < 3 && "あ".charCodeAt(0) < 256) ? 1 : 0
        return lossy == 1
    }

    // 文字列 s の i 文字目(UTF-8バイト列なら i バイト目)の文字コード。その文字の長さは lastLen に入る。
    function codeAt(s: string, i: number): number {
        let c = s.charCodeAt(i)
        lastLen = 1
        if ("あ".length >= 3 && c >= 0xE0 && i + 2 < s.length) {
            // UTF-8 のバイト列として届いている場合: 3バイトを1文字に戻す
            lastLen = 3
            return ((c & 0x0F) << 12) | ((s.charCodeAt(i + 1) & 0x3F) << 6) | (s.charCodeAt(i + 2) & 0x3F)
        }
        if (isLossy()) {
            // 下位1バイトしか取れない環境: ひらがな(0x3041〜)・カタカナ(0x30A1〜)・記号(0x3001〜)だけ復元する
            if (c >= 0x41 && c <= 0x93) return 0x3000 + c
            if (c >= 0xA1 && c <= 0xFC) return 0x3000 + c
            if (c >= 0x01 && c <= 0x0F) return 0x3000 + c
        }
        return c
    }

    // 文字列 s の最初の1文字の文字コード。空なら -1
    function firstCode(s: string): number {
        if (s.length == 0) return -1
        return codeAt(s, 0)
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

    // 収録文字(ひらがな・カタカナ・記号・漢字すべて)は1つの表 KANJI_CODES に入っている。
    function findIndex(code: number): number {
        if (code < 0) return -1
        return searchCode(KANJI_CODES, GLYPH_COUNT, code)
    }

    function hasGlyph(code: number): boolean {
        return code >= 0 && (customIndex(code) >= 0 || findIndex(code) >= 0)
    }

    // ---------- グリフをCGRAMへ ----------
    // 15x16ドットのグリフ(base から30バイト)の bitpos 番目のドット
    function getBit(buf: Buffer, base: number, bitpos: number): number {
        let byte = base + (bitpos >> 3)
        return (buf.getUint8(byte) >> (7 - (bitpos & 7))) & 1
    }

    // 15x16のデータを、縦2マス x 横3マスの CGRAM 6個に、そのまま書き込む(縮めも伸ばしもしない)
    function writeData(buf: Buffer, base: number) {
        let per = cells * 2
        for (let c = 0; c < per; c++) {
            let cx = c % cells          // 左→右のマス
            let ry = c < cells ? 0 : 1  // 上段/下段
            qsend(0x40 | (c << 3), 0)   // CGRAM の書き込み位置
            for (let y = 0; y < 8; y++) {
                let row = ry * 8 + y
                let v = 0
                for (let k = 0; k < 5; k++) {
                    v |= getBit(buf, base, row * 15 + cx * 5 + k) << (4 - k)
                }
                qsend(v, 1)
            }
        }
    }

    // 文字 g をCGRAMに書く(送信待ちに積む)。見つからなければ false
    function writeGlyph(g: number): boolean {
        let k = customIndex(g)
        if (k >= 0) {
            writeData(customBufs[k], 0)
            return true
        }
        let idx = findIndex(g)
        if (idx >= 0) {
            writeData(BLOCKS[Math.idiv(idx, BLOCK_SIZE)], (idx % BLOCK_SIZE) * GLYPH_BYTES)
            return true
        }
        return false
    }

    // ---------- 配置と、字の切り替え(時分割) ----------
    // LCD1602 の自作文字は8個しかなく、1文字に6個使うので、同時に持てる字の種類は1つ。
    // 字の種類が2つ以上のときは、背景で種類を順に高速に切り替える(液晶は反応が遅いので、全部が同時に点いて見える)。

    // items に含まれる字の種類(重複なし、出てきた順)
    function distinctKinds(): number[] {
        let ks: number[] = []
        for (let i = 0; i < items.length; i++) {
            if (ks.indexOf(items[i]) < 0) ks.push(items[i])
        }
        return ks
    }

    function qblankAt(col: number) {
        qsend(0x80 | col, 0)
        for (let i = 0; i < cells; i++) qsend(0x20, 1)
        qsend(0xC0 | col, 0)
        for (let i = 0; i < cells; i++) qsend(0x20, 1)
    }

    // 字 g の番を描く: いま出している字(別の種類)を消し → CGRAMにgを書き → g のある桁に置く
    function drawKind(g: number) {
        for (let i = 0; i < shown.length; i++) qblankAt(shown[i])
        shown = []
        writeGlyph(g)
        for (let n = 0; n < items.length; n++) {
            if (items[n] != g) continue
            let col = cols[n]
            qsend(0x80 | col, 0)
            for (let i = 0; i < cells; i++) qsend(i, 1)                 // 上段
            qsend(0xC0 | col, 0)
            for (let i = 0; i < cells; i++) qsend(cells + i, 1)         // 下段
            shown.push(col)
        }
        flush()
    }

    // 種類が2つ以上あるあいだ、背景で順に切り替え続ける
    function startPaging() {
        if (pageRunning) return
        pageRunning = true
        control.inBackground(function () {
            while (true) {
                while (wantLock > 0) basic.pause(2)   // メイン側が表示を変えたがっているときは先に譲る
                lock()
                let ks = distinctKinds()
                if (ks.length < 2) {
                    if (ks.length == 1) drawKind(ks[0])
                    pageRunning = false
                    unlock()
                    return
                }
                pageIdx = (pageIdx + 1) % ks.length
                drawKind(ks[pageIdx])
                unlock()
                basic.pause(pageMs < 1 ? 1 : pageMs)
            }
        })
    }

    // 配置を変えたあとに画面へ反映する。showLast=true なら最後に置いた字から、falseなら先頭の字から出す。
    function refresh(showLast: boolean) {
        let ks = distinctKinds()
        if (ks.length == 0) return
        pageIdx = 0
        if (showLast) pageIdx = ks.indexOf(items[items.length - 1])
        drawKind(ks[pageIdx])
        if (ks.length > 1) startPaging()
    }

    // 文字を配置に追加(桁が重なる古い字は取り除く)。描画はしない。
    function addItem(g: number, col: number): boolean {
        if (col < 0 || col > 16 - cells || !hasGlyph(g)) return false
        let i = 0
        while (i < items.length) {
            if (Math.abs(cols[i] - col) < cells) {
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
     * 漢字・ひらがな・カタカナを1文字表示する(縦2マス x 横3マス)。
     * 続けて何文字置いてもよい。字の種類が2つ以上になると、背景で高速に切り替えて、全部が同時に点いて見えるようにする。
     * 桁は3つ以上離して指定する(例: 0, 3, 6)。
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
     * 字の種類が2つ以上になると、背景で高速に切り替えて、全部が同時に点いて見えるようにする。
     * @param text 文字列, eg: "あいうえお"
     * @param col 最初の文字の左端の桁, eg: 0
     * @param step 1文字ごとの桁の間隔(3以上。足りなければ3に直す), eg: 3
     */
    //% blockId=kanjilcd_string block="漢字LCD 文字列 %text を 桁 %col から %step 桁おきに表示"
    //% text.defl="あいうえお" col.min=0 col.max=14 col.defl=0 step.min=2 step.max=8 step.defl=3
    //% weight=87
    export function showString(text: string, col: number, step: number = 3) {
        if (step < cells) step = cells
        let c = col
        let i = 0
        let any = false
        lock()
        while (i < text.length) {
            let g = codeAt(text, i)
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
     * 文字コード(Unicode の数値)で文字を1つ表示する。漢字はこちらが確実。
     * 例: 仙=20185(0x4ED9)、日=26085、曜=26332。
     * @param code 文字コード, eg: 20185
     * @param col 左端の桁(0〜14), eg: 0
     */
    //% blockId=kanjilcd_showcode block="漢字LCD 文字コード %code を 桁 %col に表示"
    //% code.defl=20185 col.min=0 col.max=14 col.defl=0
    //% weight=89
    export function showCode(code: number, col: number) {
        lock()
        if (addItem(code, col)) refresh(true)
        unlock()
    }

    /**
     * 文字コードの並びを左から順に表示する(JavaScript用)。
     * 例: kanjiLCD.showCodes([26085, 26332], 0, 3)  // 日曜
     */
    export function showCodes(codes: number[], col: number, step: number = 3) {
        if (step < cells) step = cells
        let c = col
        let any = false
        lock()
        for (let i = 0; i < codes.length; i++) {
            if (addItem(codes[i], c)) {
                any = true
                c += step
            }
        }
        if (any) refresh(false)
        unlock()
    }

    // "20185 21488, 0x3042" のような文字(半角の数字と区切りだけ)から、文字コードの並びを作る。
    // 10進数、または 0x で始まる16進数。数字以外はすべて区切りとして扱う。
    function parseCodes(text: string): number[] {
        let out: number[] = []
        let n = 0
        let has = false
        let hexMode = false
        for (let i = 0; i <= text.length; i++) {
            let c = i < text.length ? text.charCodeAt(i) : 32
            let d = -1
            if (c >= 48 && c <= 57) d = c - 48
            else if (hexMode && c >= 65 && c <= 70) d = c - 55
            else if (hexMode && c >= 97 && c <= 102) d = c - 87
            if (d >= 0) {
                n = n * (hexMode ? 16 : 10) + d
                has = true
            } else if ((c == 120 || c == 88) && has && n == 0 && !hexMode) {
                hexMode = true // 0x...
            } else {
                if (has) out.push(n)
                n = 0
                has = false
                hexMode = false
            }
        }
        return out
    }

    /**
     * 文字コードを半角の数字で並べた文字列から、左から順に表示する。ブロック用。
     * 例: "20185 21488 12398 26085 26332" (仙台の日曜)。区切りは空白かカンマ。0x3042 のような16進も使える。
     * 数字だけの文字列なので、実機でも文字化けしない。文字コードは変換ページで作れる。
     * 字の種類が2つ以上になると、背景で高速に切り替えて、全部が同時に点いて見えるようにする。
     * @param codes 文字コードの並び, eg: "20185 21488 12398 26085 26332"
     * @param col 最初の文字の左端の桁, eg: 0
     * @param step 1文字ごとの桁の間隔(3以上。足りなければ3に直す), eg: 3
     */
    //% blockId=kanjilcd_codetext block="漢字LCD 文字コード列 %codes を 桁 %col から %step 桁おきに表示"
    //% codes.defl="20185 21488 12398 26085 26332" col.min=0 col.max=14 col.defl=0 step.min=2 step.max=8 step.defl=3
    //% weight=88
    export function showCodeText(codes: string, col: number, step: number = 3) {
        showCodes(parseCodes(codes), col, step)
    }

    /**
     * 字の種類が2つ以上のとき、字を切り替える間の待ち(ミリ秒)。0 = いちばん速く切り替える(全部が同時に点いて見える)。
     * 大きくすると、1文字ずつゆっくり順に表示される。
     * @param ms 待ち, eg: 0
     */
    //% blockId=kanjilcd_pagems block="漢字LCD 切り替えの間隔 %ms ms"
    //% ms.defl=0 ms.min=0 ms.max=10000
    //% weight=40 advanced=true
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
        let i = 0
        while (i < text.length) {
            let g = codeAt(text, i)
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
     * 診断用: 「文字数/文字コード/収録番号/環境」を文字列で返す。環境は 0=文字コードが正常に取れる、1=下位1バイトしか取れない。表示できないときの調査に使う。
     * @param ch 調べる文字, eg: "あ"
     */
    //% blockId=kanjilcd_debug block="漢字LCD 診断 %ch"
    //% ch.defl="あ"
    //% weight=65 advanced=true
    export function debugInfo(ch: string): string {
        let g = firstCode(ch)
        return "" + ch.length + "/" + g + "/" + findIndex(g) + "/" + (isLossy() ? 1 : 0)
    }

    /**
     * 文字を自分で追加する(15x16ドットを詰めた30バイト = 60桁の16進文字列)。
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
