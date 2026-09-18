import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

import type { StructuredAppendRead, StructuredAppendSymbol } from '../src/index.js';

const require = createRequire(import.meta.url);

class ImageDataLike {
  public readonly colorSpace = 'srgb';
  public constructor(
    public readonly data: Uint8ClampedArray,
    public readonly width: number,
    public readonly height: number,
  ) {}
}
(globalThis as { ImageData?: unknown }).ImageData ??= ImageDataLike;

let prepared: Promise<unknown> | undefined;

/** zxing-cpp, the decoder the apps read with, loaded from its own wasm file. */
function ready(): Promise<unknown> {
  prepared ??= Promise.resolve(
    prepareZXingModule({
      overrides: {
        wasmBinary: readFileSync(
          require.resolve('zxing-wasm/reader/zxing_reader.wasm'),
        ).buffer,
      },
      fireImmediately: true,
    }),
  );
  return prepared;
}

/** The symbol as a camera-free image: black modules on white, with the standard quiet zone. */
export function render(symbol: StructuredAppendSymbol, px = 4, quiet = 4): ImageData {
  const total = (symbol.size + quiet * 2) * px;
  const data = new Uint8ClampedArray(total * total * 4).fill(255);
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (!symbol.isDark(x, y)) continue;
      for (let dy = 0; dy < px; dy += 1) {
        for (let dx = 0; dx < px; dx += 1) {
          const at = (((y + quiet) * px + dy) * total + (x + quiet) * px + dx) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    }
  }
  return new (globalThis as unknown as { ImageData: typeof ImageDataLike }).ImageData(
    data,
    total,
    total,
  ) as unknown as ImageData;
}

/** What zxing-cpp reports for one symbol, as the assembler takes it. */
export async function read(image: ImageData): Promise<StructuredAppendRead & { size: number }> {
  await ready();
  const [result] = await readBarcodes(image, { formats: ['QRCode'], tryHarder: true });
  if (!result || !result.isValid) throw new Error('zxing read nothing');
  return {
    index: result.sequenceIndex,
    count: result.sequenceSize,
    parity: Number(result.sequenceId),
    bytes: result.bytes,
    size: result.sequenceSize,
  };
}
