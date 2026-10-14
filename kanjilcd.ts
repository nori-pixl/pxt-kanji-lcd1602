/**
 * LCD1602(I2C, PCF8574バックパック)に漢字・ひらがな・カタカナを表示するライブラリ。
 *
 * すべての字(ひらがな・カタカナ・記号・漢字)は 縦2マス x 横3マス(15x16ドット)の、
 * 東雲フォントそのままの細い字(縦横比 2:3)。
 *
 * 表示のしかたは2通り(setMode)。既定は「全部の字を切り替えて表示」: 何文字でも同時に見える。
 * CGRAM に収まらない字は、ページに分けて背景で素早く切り替える(薄く・ちらつく)。
 * 「1文字を固定」にすると、点滅しない(入る字だけを出す)。
 *
 * LCD1602 が自由に使える文字パターン(CGRAM)は8マスだけで、1文字に最大6マス使う。
 * 空白のマスはCGRAMを使わず、同じ形のマスは共有するが、それでも同時に固定して出せるのは
 * たいてい【1文字】(2文字になることは、まれ)。入りきらない字は表示しない。
 * 何文字も出したいときは showSequence(1文字ずつ順に切り替え)を使う。
 *
 * 文字の探し方: 文字列で渡された字は、文字そのもので KEYS(収録文字を並べた文字列)から探す。
 * (最初のコミットと同じ考え方。文字コードの数値は読まないので、全角の漢字もそのまま文字で指定できる。)
 *
 * 【メモ】MakeCode の実機(micro:bit)では、文字列の全角文字から charCodeAt で数値を読むと、下位1バイトしか
 * 返らないことがある(「仙」0x4ED9 と「ベ」0x30D9 が同じ 0xD9 になる)。このライブラリは数値を読まない。
 * 数字の文字コードで指定したいときは showCode / showCodes / showCodeText が使える(例: 仙 = 20185)。
 */

//% weight=90 color=#2E86AB icon="\uf2bb" block="漢字LCD"
namespace kanjiLCD {
    export enum KanjiMode {
        //% block="全部の字を切り替えて表示"
        All = 0,
        //% block="1文字を固定(点滅なし)"
        Fixed = 1
    }

    let addr = 0x27
    let backlight = 0x08
    let customKeys: number[] = []
    let customBufs: Buffer[] = []
    let lastLen = 1
    let unit = 0     // 全角1文字が文字列の何単位ぶんか(1 か 3)。0 = 未判定

    // 画面に置いた全角文字の一覧(置いた順)。各文字は2桁ぶんの幅。
    let items: number[] = []
    let cols: number[] = []
    let q: number[] = []   // まとめて送るI2Cのバイト列
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

    // 文字列の中身の形(最初の1回だけ判定): 全角1文字が文字列の何単位ぶんか。
    //   KEYS の長さ = 収録文字数 → 1文字=1単位
    //   KEYS の長さ = 収録文字数 x 3 → UTF-8のバイト列(全角1文字=3バイト)
    function getUnit(): number {
        if (unit == 0) unit = KEYS.length > GLYPH_COUNT ? 3 : 1
        return unit
    }

    // 文字列 s の i 文字目から全角1文字を取り出し、その字を【文字そのもの】で KEYS から探して、
    // Unicode の文字コードを返す。見つからない字(英数字など)は -1 で、1つ進める。
    // その文字の長さは lastLen に入る。
    // charCodeAt は使わない: 実機の MakeCode では、全角文字の charCodeAt が下位1バイトしか返さず
    // (「仙」と「ベ」が同じになる)、数値で扱うと別の字になってしまうため。文字列の検索なら正しく動く。
    function codeAt(s: string, i: number): number {
        let u = getUnit()
        lastLen = 1
        let ch = s.substr(i, u)
        if (ch.length < u) return -1
        let p = KEYS.indexOf(ch)
        if (p < 0) return -1
        lastLen = u
        let idx = u == 3 ? Math.idiv(p, 3) : p
        return (KANJI_CODES.getUint8(idx * 2) << 8) | KANJI_CODES.getUint8(idx * 2 + 1)
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

    // ---------- 配置と描画 ----------
    // 表示モード(setMode):
    //   0 = 全部の字を表示する。CGRAM(8個)に収まらないときは、字をいくつかの「ページ」に分けて、
    //       背景で素早く切り替える(そのぶん薄くなり、ちらつく)。ページ数がいちばん少なくなるように詰める。
    //   1 = 点滅なしの固定表示。入る字だけを出す。
    let mode = 0
    let pageMs = 0
    let gen = 0                          // 配置を変えるたびに増やす。背景の切り替えは、これが変わると止まる
    let looping = false

    let iKeys: string[][] = []           // 字ごとの6マスの形("" = 空白マス)
    let iRows: number[][][] = []         // 字ごとの6マスの中身(8行 x 5ビット)
    let pItems: number[][] = []          // ページごとの、字の番号(items の添字)
    let pKeys: string[][] = []           // ページごとの、使うマスの形(最大8個)
    let pRows: number[][][] = []         // 上の中身
    let curKeys: string[] = []           // いま CGRAM 0..7 に入っている形
    let curByCol: number[][] = []        // いま各桁に出している6マスの文字コード([] = 何も出していない)

    // 字 g の (cx, ry) のマスの8行を返す。g が見つからなければ空の配列
    function cellRows(g: number, cx: number, ry: number): number[] {
        let buf: Buffer
        let base = 0
        let k = customIndex(g)
        if (k >= 0) {
            buf = customBufs[k]
        } else {
            let idx = findIndex(g)
            if (idx < 0) return []
            buf = BLOCKS[Math.idiv(idx, BLOCK_SIZE)]
            base = (idx % BLOCK_SIZE) * GLYPH_BYTES
        }
        let rows: number[] = []
        for (let y = 0; y < 8; y++) {
            let v = 0
            for (let b = 0; b < 5; b++) {
                v |= getBit(buf, base, (ry * 8 + y) * 15 + cx * 5 + b) << (4 - b)
            }
            rows.push(v)
        }
        return rows
    }

    function isBlankRows(rows: number[]): boolean {
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] != 0) return false
        }
        return true
    }

    function qblankAt(col: number) {
        qsend(0x80 | col, 0)
        for (let i = 0; i < cells; i++) qsend(0x20, 1)
        qsend(0xC0 | col, 0)
        for (let i = 0; i < cells; i++) qsend(0x20, 1)
        curByCol[col] = []
    }

    // 字ごとの6マスの形を調べる
    function prepare() {
        iKeys = []
        iRows = []
        for (let i = 0; i < items.length; i++) {
            let keys: string[] = []
            let rowsOf: number[][] = []
            for (let c = 0; c < 6; c++) {
                let rows = cellRows(items[i], c % 3, c < 3 ? 0 : 1)
                if (rows.length == 0) {
                    keys = []
                    rowsOf = []
                    break
                }
                keys.push(isBlankRows(rows) ? "" : rows.join(","))
                rowsOf.push(rows)
            }
            iKeys.push(keys)
            iRows.push(rowsOf)
        }
    }

    // その字が使う形(重複なし・空白なし)
    function needOf(i: number): string[] {
        let r: string[] = []
        for (let c = 0; c < iKeys[i].length; c++) {
            if (iKeys[i][c] != "" && r.indexOf(iKeys[i][c]) < 0) r.push(iKeys[i][c])
        }
        return r
    }

    // 字をページに分ける。mode=1(固定)なら最初のページだけ。
    function buildPages(newestFirst: boolean) {
        pItems = []
        pKeys = []
        pRows = []
        let n = items.length
        let order: number[] = []
        for (let t = 0; t < n; t++) order.push(newestFirst ? n - 1 - t : t)
        if (mode == 0) {
            // 使う形が多い字から先に詰めると、ページ数が少なくなる(挿入ソート)
            for (let a = 1; a < order.length; a++) {
                let v = order[a]
                let nv = needOf(v).length
                let b = a - 1
                while (b >= 0 && needOf(order[b]).length < nv) {
                    order[b + 1] = order[b]
                    b--
                }
                order[b + 1] = v
            }
        }
        for (let t = 0; t < order.length; t++) {
            let i = order[t]
            if (iKeys[i].length == 0) continue
            let need = needOf(i)
            let placed = false
            for (let p = 0; p < pItems.length && !placed; p++) {
                let fresh = 0
                for (let k = 0; k < need.length; k++) {
                    if (pKeys[p].indexOf(need[k]) < 0) fresh++
                }
                if (pKeys[p].length + fresh <= 8) {
                    for (let c = 0; c < 6; c++) {
                        if (iKeys[i][c] != "" && pKeys[p].indexOf(iKeys[i][c]) < 0) {
                            pKeys[p].push(iKeys[i][c])
                            pRows[p].push(iRows[i][c])
                        }
                    }
                    pItems[p].push(i)
                    placed = true
                }
            }
            if (!placed && !(mode == 1 && pItems.length >= 1)) {
                let keys: string[] = []
                let rows: number[][] = []
                for (let c = 0; c < 6; c++) {
                    if (iKeys[i][c] != "" && keys.indexOf(iKeys[i][c]) < 0) {
                        keys.push(iKeys[i][c])
                        rows.push(iRows[i][c])
                    }
                }
                pItems.push([i])
                pKeys.push(keys)
                pRows.push(rows)
            }
        }
    }

    // ページ p を画面に出す。変わる部分だけを、まとめて1回で送る。
    function drawPage(p: number) {
        let want = pKeys[p]
        // 1) このページで使う形に、CGRAM の番号を割り当てる(すでに入っている形は、そのまま使う)
        let assign: number[] = []
        let used: boolean[] = []
        for (let j = 0; j < 8; j++) used.push(false)
        for (let k = 0; k < want.length; k++) {
            let j = curKeys.indexOf(want[k])
            assign.push(j)
            if (j >= 0) used[j] = true
        }
        let writeSlots: number[] = []     // 中身を書き換える CGRAM 番号
        let writeKeys: number[] = []      // その形(want の添字)
        for (let k = 0; k < want.length; k++) {
            if (assign[k] >= 0) continue
            let j = 0
            while (used[j]) j++
            used[j] = true
            assign[k] = j
            writeSlots.push(j)
            writeKeys.push(k)
        }
        // 2) これから書き換える CGRAM を使っている桁は、先に空白にする(乱れて見えるのを避ける)
        for (let col = 0; col < 16; col++) {
            let cur = curByCol[col]
            if (!cur || cur.length == 0) continue
            for (let c = 0; c < 6; c++) {
                if (cur[c] < 8 && writeSlots.indexOf(cur[c]) >= 0) {
                    qblankAt(col)
                    break
                }
            }
        }
        // 3) 使わなくなった桁を空白にする
        for (let col = 0; col < 16; col++) {
            let cur = curByCol[col]
            if (!cur || cur.length == 0) continue
            let keep = false
            for (let t = 0; t < pItems[p].length; t++) {
                if (cols[pItems[p][t]] == col) keep = true
            }
            if (!keep) qblankAt(col)
        }
        // 4) CGRAM の書き換え
        for (let w = 0; w < writeSlots.length; w++) {
            qsend(0x40 | (writeSlots[w] << 3), 0)
            for (let y = 0; y < 8; y++) qsend(pRows[p][writeKeys[w]][y], 1)
            curKeys[writeSlots[w]] = want[writeKeys[w]]
        }
        // 5) このページの字を出す(変わるときだけ)
        for (let t = 0; t < pItems[p].length; t++) {
            let i = pItems[p][t]
            let col = cols[i]
            let codes: number[] = []
            for (let c = 0; c < 6; c++) codes.push(iKeys[i][c] == "" ? 0x20 : assign[want.indexOf(iKeys[i][c])])
            let cur = curByCol[col]
            let same = cur && cur.length == 6
            for (let c = 0; same && c < 6; c++) {
                if (cur[c] != codes[c]) same = false
            }
            if (same) continue
            qsend(0x80 | col, 0)
            for (let c = 0; c < 3; c++) qsend(codes[c], 1)         // 上段
            qsend(0xC0 | col, 0)
            for (let c = 3; c < 6; c++) qsend(codes[c], 1)         // 下段
            curByCol[col] = codes
        }
        qsend(0x80, 0)
        flush()
    }

    // 背景で、ページを順に切り替え続ける
    function startLoop() {
        if (looping) return
        looping = true
        control.inBackground(function () {
            while (pItems.length > 1) {
                let g = gen
                for (let p = 0; p < pItems.length; p++) {
                    if (g != gen) break
                    drawPage(p)
                    basic.pause(pageMs)
                }
            }
            looping = false
        })
    }

    // 配置を変えたあとに画面へ反映する。showLast=true なら最後に置いた字を優先する。
    function refresh(showLast: boolean) {
        if (items.length == 0) return
        gen++
        prepare()
        buildPages(showLast)
        if (pItems.length == 0) {
            for (let col = 0; col < 16; col++) {
                if (curByCol[col] && curByCol[col].length > 0) qblankAt(col)
            }
            flush()
            return
        }
        if (pItems.length == 1) drawPage(0)       // 1ページなら固定表示(点滅しない)
        else startLoop()
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
        addr = address
        items = []
        cols = []
        gen++
        pItems = []
        pKeys = []
        pRows = []
        curKeys = []
        curByCol = []
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
        // 全角文字が正しく届いていない(pxt.json の utf8:true が効いていない/古い版が残っている)ときは、
        // 2行目に警告を出す。出たら、拡張機能を削除して、入れ直す。
        if (!utf8Ok()) showText("UTF8 OFF", 0, 1)
    }

    /**
     * 画面を消す
     */
    //% blockId=kanjilcd_clear block="漢字LCD 画面を消す"
    //% weight=95
    export function clear() {
        send(0x01, 0)
        basic.pause(2)
        items = []
        cols = []
        gen++
        pItems = []
        pKeys = []
        pRows = []
        curKeys = []
        curByCol = []
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
     * 点滅せず固定で表示する。同時に出せるのはたいてい1文字(入らない字は表示されない)。桁は3つ以上離して指定する。
     * @param ch 表示する文字(1文字), eg: "あ"
     * @param col 左端の桁(0〜14), eg: 0
     */
    //% blockId=kanjilcd_show block="漢字LCD 文字 %ch を 桁 %col に表示"
    //% ch.defl="あ" col.min=0 col.max=14 col.defl=0
    //% weight=90
    export function showKanji(ch: string, col: number) {
        let g = firstCode(ch)
        if (g < 0) return
        if (addItem(g, col)) refresh(true)
    }

    /**
     * 文字列を左から順に並べて表示する。
     * 点滅せず固定で表示する。1画面に収まらない字は表示されない(1文字ずつ順に出したいときは showSequence)。
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
        if (addItem(code, col)) refresh(true)
    }

    /**
     * 文字コードの並びを左から順に表示する(JavaScript用)。
     * 例: kanjiLCD.showCodes([26085, 26332], 0, 3)  // 日曜
     */
    export function showCodes(codes: number[], col: number, step: number = 3) {
        if (step < cells) step = cells
        let c = col
        let any = false
        for (let i = 0; i < codes.length; i++) {
            if (addItem(codes[i], c)) {
                any = true
                c += step
            }
        }
        if (any) refresh(false)
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
     * 点滅せず固定で表示する。1画面に収まらない字は表示されない(1文字ずつ順に出したいときは showSequence)。
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
     * 字を切り替える間の待ち(ミリ秒)。0 = できるだけ速く切り替える(ちらつきがいちばん少ない)。
     * @param ms 待ち時間, eg: 0
     */
    //% blockId=kanjilcd_pagems block="漢字LCD 切り替えの間隔 %ms ms"
    //% ms.defl=0 ms.min=0 ms.max=10000
    //% weight=60 advanced=true
    export function setPageTime(ms: number) {
        pageMs = ms
    }

    /**
     * 表示のしかたを選ぶ。
     * 「全部を切り替えて表示」: 何文字でも同時に見える(薄く、ちらつく)。
     * 「1文字を固定」: 点滅しない。入る字(たいてい1文字)だけを出す。
     * @param m 表示のしかた
     */
    //% blockId=kanjilcd_mode block="漢字LCD 表示のしかた %m"
    //% weight=62 advanced=true
    export function setMode(m: KanjiMode) {
        mode = m
        if (items.length > 0) refresh(true)
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
                items = []
                cols = []
                let ok = addItem(g, col)
                if (ok) refresh(true)
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
     * 全角文字が、正しく(文字化けせずに)届いているか。false のときは、拡張機能を削除して入れ直してください。
     * (pxt.json の utf8:true が効いていないと、全角文字が下位1バイトに削られて false になる)
     */
    //% blockId=kanjilcd_utf8 block="漢字LCD UTF-8が有効"
    //% weight=66 advanced=true
    export function utf8Ok(): boolean {
        return "仙".length == 1 && "仙".charCodeAt(0) == 20185
    }

    /**
     * 診断用: 「文字列の長さ/文字コード/収録番号/単位」を文字列で返す。文字コードが -1 や収録番号が -1 なら、その字は収録されていない。単位は 1(1文字=1単位) か 3(UTF-8のバイト列)。表示できないときの調査に使う。
     * @param ch 調べる文字, eg: "あ"
     */
    //% blockId=kanjilcd_debug block="漢字LCD 診断 %ch"
    //% ch.defl="あ"
    //% weight=65 advanced=true
    export function debugInfo(ch: string): string {
        let g = firstCode(ch)
        return "" + ch.length + "/" + g + "/" + findIndex(g) + "/" + getUnit()
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
