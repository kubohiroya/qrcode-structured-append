import { Byte, Charset, Encoder } from '@nuintun/qrcode';

import { StructuredAppendError } from './errors.js';
import { parityOf } from './parity.js';

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** The standard allows at most sixteen symbols in one Structured Append message. */
export const MAX_SYMBOLS = 16;

export interface CreateOptions {
  /** Error correction level of every symbol. Default `M`. */
  readonly level?: ErrorCorrectionLevel;
  /**
   * Largest QR version a symbol may use, 1 to 40. Default 40. A lower cap makes each symbol coarser,
   * which a camera reads from further away and at a steeper angle, at the price of more symbols.
   */
  readonly maxVersion?: number;
}

export interface SvgOptions {
  /** Light modules around the symbol. The standard asks for 4; default 4. */
  readonly quietZone?: number;
  readonly dark?: string;
  readonly light?: string;
}

/** One symbol of a Structured Append message. */
export interface StructuredAppendSymbol {
  /** 0-based position of this symbol in the message. */
  readonly index: number;
  /** How many symbols the message has, 1 to 16. */
  readonly count: number;
  readonly parity: number;
  /** This symbol's share of the message. */
  readonly bytes: Uint8Array;
  readonly version: number;
  /** Modules along one side, without the quiet zone. */
  readonly size: number;
  isDark(x: number, y: number): boolean;
  toSvg(options?: SvgOptions): string;
  toDataUri(options?: SvgOptions): string;
}

const encoder = new TextEncoder();

/**
 * Splits a message into the fewest Structured Append symbols that each fit the version cap.
 *
 * Text is carried as its UTF-8 bytes in byte mode, with no ECI, so a symbol boundary may fall inside
 * a character: the bytes are joined before they are decoded as text again. The share of each symbol
 * is balanced rather than filled in order, so no symbol is much denser than the rest.
 */
export function createStructuredAppend(
  message: string | Uint8Array,
  options: CreateOptions = {},
): StructuredAppendSymbol[] {
  const bytes = typeof message === 'string' ? encoder.encode(message) : message;
  if (bytes.length === 0) {
    throw new StructuredAppendError('empty-message', 'A message needs at least one byte.');
  }
  const level = options.level ?? 'M';
  if (!['L', 'M', 'Q', 'H'].includes(level)) {
    throw new StructuredAppendError('invalid-option', `Unknown error correction level ${level}.`);
  }
  const maxVersion = options.maxVersion ?? 40;
  if (!Number.isInteger(maxVersion) || maxVersion < 1 || maxVersion > 40) {
    throw new StructuredAppendError(
      'invalid-option',
      `A version cap is a whole number from 1 to 40, not ${String(maxVersion)}.`,
    );
  }
  const parity = parityOf(bytes);
  const perSymbol = capacity(level, maxVersion);
  const count = Math.ceil(bytes.length / perSymbol);
  if (count > MAX_SYMBOLS) {
    throw new StructuredAppendError(
      'too-many-symbols',
      `The message needs ${count} symbols at version ${maxVersion}, more than the ${MAX_SYMBOLS} the standard allows.`,
    );
  }
  const share = Math.ceil(bytes.length / count);
  return Array.from({ length: count }, (_, index) => {
    const part = bytes.slice(index * share, (index + 1) * share);
    const encoded = new Encoder({
      level,
      hints: { structured: { index, count, parity } },
    }).encode(new Byte(latin1(part), Charset.ISO_8859_1));
    return symbol(index, count, parity, part, encoded);
  });
}

/** How many bytes one symbol carries at the cap, found by asking the encoder. */
function capacity(level: ErrorCorrectionLevel, version: number): number {
  const fits = (length: number) => {
    try {
      new Encoder({
        level,
        version,
        hints: { structured: { index: 15, count: 16, parity: 0 } },
      }).encode(new Byte('A'.repeat(length), Charset.ISO_8859_1));
      return true;
    } catch {
      return false;
    }
  };
  let low = 0;
  let high = 3000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  if (low < 1) {
    throw new StructuredAppendError(
      'invalid-option',
      `Version ${version} at level ${level} has no room for data after the Structured Append header.`,
    );
  }
  return low;
}

/** Bytes as the ISO-8859-1 string the byte-mode segment takes: one character per byte. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function symbol(
  index: number,
  count: number,
  parity: number,
  bytes: Uint8Array,
  encoded: { size: number; version: number; get(x: number, y: number): 0 | 1 },
): StructuredAppendSymbol {
  const isDark = (x: number, y: number) => encoded.get(x, y) === 1;
  const toSvg = (svg: SvgOptions = {}) => {
    const quiet = svg.quietZone ?? 4;
    const total = encoded.size + quiet * 2;
    const runs: string[] = [];
    for (let y = 0; y < encoded.size; y += 1) {
      let x = 0;
      while (x < encoded.size) {
        if (!isDark(x, y)) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < encoded.size && isDark(x, y)) x += 1;
        runs.push(`M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`);
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
      `<rect width="${total}" height="${total}" fill="${svg.light ?? '#ffffff'}"/>` +
      `<path fill="${svg.dark ?? '#000000'}" d="${runs.join('')}"/></svg>`
    );
  };
  return {
    index,
    count,
    parity,
    bytes,
    version: encoded.version,
    size: encoded.size,
    isDark,
    toSvg,
    toDataUri: (svg) => `data:image/svg+xml,${encodeURIComponent(toSvg(svg))}`,
  };
}
