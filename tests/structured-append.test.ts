import { describe, expect, it } from 'vitest';

import {
  createStructuredAppend,
  MAX_SYMBOLS,
  parityOf,
  StructuredAppendAssembler,
  StructuredAppendError,
} from '../src/index.js';
import { read, render } from './zxing.js';

/** A pairing code as it travels: base64url, about 1,250 characters. */
function pairingCode(length = 1248): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let seed = 7;
  return Array.from({ length }, () => {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0;
    return alphabet[Math.floor((seed / 2 ** 32) * alphabet.length)];
  }).join('');
}

describe('creating a Structured Append message', () => {
  it('splits into the fewest symbols that fit the version cap, balanced between them', () => {
    const message = pairingCode();
    const symbols = createStructuredAppend(message, { maxVersion: 20 });
    expect(symbols).toHaveLength(2);
    for (const symbol of symbols) {
      expect(symbol.version).toBeLessThanOrEqual(20);
      expect(symbol.count).toBe(2);
      expect(symbol.parity).toBe(parityOf(new TextEncoder().encode(message)));
    }
    expect(Math.abs(symbols[0]!.bytes.length - symbols[1]!.bytes.length)).toBeLessThanOrEqual(1);

    expect(createStructuredAppend(message, { maxVersion: 15 }).length).toBeGreaterThan(2);
    expect(createStructuredAppend(message, { maxVersion: 40 })).toHaveLength(1);
  });

  it('refuses what it cannot carry', () => {
    const codeOf = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof StructuredAppendError ? error.code : 'other';
      }
      return 'none';
    };
    expect(codeOf(() => createStructuredAppend(''))).toBe('empty-message');
    expect(codeOf(() => createStructuredAppend('x', { maxVersion: 41 }))).toBe('invalid-option');
    expect(codeOf(() => createStructuredAppend('x', { maxVersion: 2.5 }))).toBe('invalid-option');
    expect(
      codeOf(() => createStructuredAppend(pairingCode(20_000), { maxVersion: 10 })),
    ).toBe('too-many-symbols');
    expect(MAX_SYMBOLS).toBe(16);
  });

  it('draws a symbol as SVG with the quiet zone around it', () => {
    const [symbol] = createStructuredAppend('hello', { maxVersion: 5 });
    const svg = symbol!.toSvg();
    expect(svg).toContain(`viewBox="0 0 ${symbol!.size + 8} ${symbol!.size + 8}"`);
    expect(symbol!.toDataUri().startsWith('data:image/svg+xml,')).toBe(true);
  });
});

describe('reading it back with zxing-cpp', () => {
  it('joins symbols read in any order, and says which read was which', async () => {
    const message = pairingCode();
    const symbols = createStructuredAppend(message, { maxVersion: 15 });
    expect(symbols.length).toBeGreaterThanOrEqual(3);
    const reads = await Promise.all(symbols.map((symbol) => read(render(symbol))));
    for (const [position, got] of reads.entries()) {
      expect(got.index).toBe(position);
      expect(got.count).toBe(symbols.length);
      expect(got.parity).toBe(symbols[0]!.parity);
    }

    const assembler = new StructuredAppendAssembler();
    const last = reads[reads.length - 1]!;
    expect(assembler.add(last).result).toBe('accepted');
    expect(assembler.add(last).result).toBe('duplicate');
    expect(assembler.missing()).toEqual(
      Array.from({ length: symbols.length - 1 }, (_, index) => index),
    );
    for (const got of reads.slice(0, -1).reverse()) expect(assembler.add(got).result).toBe('accepted');
    expect(assembler.isComplete()).toBe(true);
    expect(assembler.text()).toBe(message);
  });

  it('carries text whose characters fall across a symbol boundary', async () => {
    const message = '連結QRコード（Structured Append）で、日本語の文字列を運ぶ。'.repeat(20);
    const symbols = createStructuredAppend(message, { maxVersion: 10 });
    expect(symbols.length).toBeGreaterThan(1);
    const assembler = new StructuredAppendAssembler();
    for (const symbol of symbols) assembler.add(await read(render(symbol)));
    expect(assembler.text()).toBe(message);
  });

  it('marks even a message of one symbol as a sequence of one', async () => {
    const [symbol] = createStructuredAppend('short', { maxVersion: 40 });
    const got = await read(render(symbol!));
    expect(got).toMatchObject({ index: 0, count: 1 });
    const assembler = new StructuredAppendAssembler();
    assembler.add(got);
    expect(assembler.text()).toBe('short');
  });
});

describe('assembling', () => {
  const symbols = createStructuredAppend(pairingCode(), { maxVersion: 15 });
  const readOf = (index: number) => ({
    index,
    count: symbols[index]!.count,
    parity: symbols[index]!.parity,
    bytes: symbols[index]!.bytes,
  });

  it('leaves a symbol of another message out, and keeps what it has', () => {
    const other = createStructuredAppend(pairingCode(1300) + 'x', { maxVersion: 15 });
    const assembler = new StructuredAppendAssembler();
    assembler.add(readOf(0));
    const foreign = assembler.add({
      index: 1,
      count: other[1]!.count,
      parity: (symbols[0]!.parity + 1) % 256,
      bytes: other[1]!.bytes,
    });
    expect(foreign).toMatchObject({ result: 'foreign', received: 1 });
    expect(assembler.add({ ...readOf(1), count: symbols.length + 1 }).result).toBe('foreign');
    expect(assembler.add(readOf(1)).result).toBe('accepted');
  });

  it('refuses a position filled twice with different content, and a join that breaks the parity', () => {
    const assembler = new StructuredAppendAssembler();
    assembler.add(readOf(0));
    const changed = readOf(0).bytes.slice();
    changed[0] = changed[0]! ^ 1;
    expect(() => assembler.add({ ...readOf(0), bytes: changed })).toThrowError(
      expect.objectContaining({ code: 'conflicting-symbol' }),
    );

    const tampered = new StructuredAppendAssembler();
    tampered.add({ ...readOf(0), bytes: changed });
    for (let index = 1; index < symbols.length; index += 1) tampered.add(readOf(index));
    expect(() => tampered.bytes()).toThrowError(expect.objectContaining({ code: 'parity-mismatch' }));
  });

  it('refuses a read that is not a Structured Append read, and says what is missing before the end', () => {
    const assembler = new StructuredAppendAssembler();
    expect(() => assembler.add({ index: 0, count: 0, parity: 0, bytes: new Uint8Array() })).toThrow();
    expect(() => assembler.add({ index: 16, count: 17, parity: 0, bytes: new Uint8Array() })).toThrow();
    assembler.add(readOf(1));
    expect(assembler.isComplete()).toBe(false);
    expect(() => assembler.bytes()).toThrowError(expect.objectContaining({ code: 'incomplete' }));
    assembler.clear();
    expect(assembler.count()).toBe(0);
  });
});
