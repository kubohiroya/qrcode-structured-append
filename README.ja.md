# qrcode-structured-append

[English](README.md) | 日本語

JavaScriptで扱う、QRコードの**連結QR（Structured Append、ISO/IEC 18004）**です。1つのメッセージを最大16枚の
連結したQRシンボルに分け、どの復号器で読んだものからでも元に戻します。

連結QRは、1つのメッセージを複数のQRコードで運ぶための規格の方法です。各シンボルの先頭に20ビットの
ヘッダー（そのシンボルの位置、シンボルの総数、メッセージ全体のパリティ）が入るので、読む側はどのシンボルが
同じ組で、どの順に並ぶかが分かります。規格なので、zxing-cpp（`zxing-wasm`）など連結QRに対応した復号器なら
読めます。ヘッダーも、JSONの封筒ではなく20ビットで済みます。

## 作る

```ts
import { createStructuredAppend } from '@kubohiroya/qrcode-structured-append';

const symbols = createStructuredAppend(message, { level: 'M', maxVersion: 20 });
for (const symbol of symbols) {
  show(symbol.toDataUri()); // symbol.toSvg()、または symbol.isDark(x, y) で自分で描く
}
```

- `maxVersion`（1〜40、既定40）は、1枚のシンボルをどこまで細かくしてよいかの上限です。カメラは粗いシンボルほど
  遠くから、また斜めからでも読めるので、上限を下げるほど確実に読めます。その分、枚数は増えます。
- メッセージは、上限に収まる最少の枚数に分け、バイトを各シンボルに均等に割り振ります。規格の上限である16枚を
  超えるものは拒否します。
- 文字列はUTF-8のバイトとして、ECIなしのバイトモードで運びます。シンボルの境目が文字の途中に来ることがありますが、
  バイトを結合してから文字列に戻すので問題ありません。

## 結合する

```ts
import { StructuredAppendAssembler } from '@kubohiroya/qrcode-structured-append';

const assembler = new StructuredAppendAssembler();
// zxing-wasm なら result.sequenceIndex、result.sequenceSize、result.sequenceId、result.bytes
const { result } = assembler.add({ index, count, parity, bytes });
// result: 'accepted'（新しいシンボル）、'duplicate'（読み取り済み）、'foreign'（別のメッセージ。入れない）
if (assembler.isComplete()) use(assembler.text());
```

- シンボルはどの順で読んでも揃います。同じシンボルをもう一度読むと`duplicate`として報告し、何も変えません。
  カメラは目の前のコードを1秒に何度も読むためです。
- 最初に読んだシンボルでメッセージが決まります。総数かパリティが違うシンボルは`foreign`として報告し、
  メッセージを失敗にはせず、入れずにおきます。
- 同じ位置に違う中身が来たときは`conflicting-symbol`を、結合したメッセージがパリティと合わないときは
  `parity-mismatch`を投げます。

パリティは8ビットです。シンボルをまとめる目印であって、メッセージを識別したり、壊れていないことを保証したりは
しません。無関係な2つのメッセージのパリティは256回に1回一致します。必要なら、メッセージの中に自前の識別子と
hashを入れてください。

## エンコーダーについて

いまのところ、連結QRのヘッダーを書けるJavaScriptのQRエンコーダーはありません。このパッケージは
[@nuintun/qrcode](https://github.com/nuintun/qrcode)（MIT）のエンコーダーに`structured`ヒントを足す小さな変更
（`patches/`）を加え、`dist/index.js`に同梱しています。`THIRD_PARTY_NOTICES.md`を参照してください。

## 開発

Node.js 24以上、pnpm 11.28.8。`pnpm run check`で、型検査、lint、テスト（作ったシンボルをzxing-cppで
読み戻す）、ビルド、npmパッケージのdry runを行います。

## ライセンス

MPL-2.0。同梱のエンコーダーはMITです（`THIRD_PARTY_NOTICES.md`）。
