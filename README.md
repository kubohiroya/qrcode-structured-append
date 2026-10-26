# qrcode-structured-append

English | [日本語](README.ja.md)

QR Code **Structured Append** (ISO/IEC 18004) for JavaScript: split a message into up to 16 linked QR
symbols, and join them back from whatever decoder read them.

Structured Append is the standard way to carry one message in several QR codes. Each symbol begins
with a 20-bit header — its position, the number of symbols, and a parity byte of the whole message —
so a reader knows which symbols belong together and in what order. Being the standard, the symbols
are read by any decoder that implements it, such as zxing-cpp (`zxing-wasm`), and the header costs 20
bits rather than a JSON envelope.

## Creating

```ts
import { createStructuredAppend } from '@kubohiroya/qrcode-structured-append';

const symbols = createStructuredAppend(message, { level: 'M', maxVersion: 20 });
for (const symbol of symbols) {
  show(symbol.toDataUri()); // or symbol.toSvg(), or symbol.isDark(x, y) to draw it yourself
}
```

- `maxVersion` (1 to 40, default 40) caps how fine a symbol may get. A camera reads a coarse symbol
  from further away and at a steeper angle, so a lower cap reads more reliably, in more symbols.
- The message is split into the fewest symbols that fit the cap, with the bytes shared evenly between
  them. More than 16 symbols is refused, as the standard allows no more.
- Text is carried as UTF-8 bytes in byte mode, without ECI. A symbol boundary may fall inside a
  character; the bytes are joined before they become text again.

## Joining

```ts
import { StructuredAppendAssembler } from '@kubohiroya/qrcode-structured-append';

const assembler = new StructuredAppendAssembler();
// From zxing-wasm: result.sequenceIndex, result.sequenceSize, result.sequenceId, result.bytes
const { result } = assembler.add({ index, count, parity, bytes });
// result: 'accepted' (new), 'duplicate' (already read), or 'foreign' (another message, left out)
if (assembler.isComplete()) use(assembler.text());
```

- Symbols are taken in any order. The same symbol read again is reported as `duplicate` and changes
  nothing, because a camera reads the code in front of it many times a second.
- The first symbol decides the message. A symbol with another count or parity is reported as
  `foreign` and left out, rather than failing the message.
- A position filled twice with different content throws `conflicting-symbol`, and a joined message
  that does not match its parity throws `parity-mismatch`.

The parity is eight bits. It groups symbols; it does not identify a message or prove it intact — two
unrelated messages share a parity one time in 256. Carry your own identifier and hash inside the
message when that matters.

## About the encoder

No JavaScript QR encoder writes Structured Append headers today. This package bundles the encoder of
[@nuintun/qrcode](https://github.com/nuintun/qrcode) (MIT) with a small change that adds a
`structured` hint (`patches/`), and ships it inside `dist/index.js`. See `THIRD_PARTY_NOTICES.md`.

## Development

Node.js >= 24 and pnpm 11.28.8. `pnpm run check` runs type checking, lint, the tests (which read
the generated symbols back with zxing-cpp), the build and an npm package dry run.

## License

MPL-2.0. The bundled encoder is MIT; see `THIRD_PARTY_NOTICES.md`.
