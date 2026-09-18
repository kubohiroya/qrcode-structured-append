import { StructuredAppendError } from './errors.js';
import { MAX_SYMBOLS } from './create.js';
import { parityOf } from './parity.js';

/** What a decoder read from one Structured Append symbol. */
export interface StructuredAppendRead {
  /** 0-based position. */
  readonly index: number;
  /** Symbols in the message, 1 to 16. */
  readonly count: number;
  readonly parity: number;
  readonly bytes: Uint8Array;
}

/**
 * What one read turned out to be.
 *
 * - `accepted`: a symbol of this message that had not arrived yet.
 * - `duplicate`: a symbol that had already arrived, with the same content. Harmless: a camera reads
 *   the symbol in front of it many times a second.
 * - `foreign`: a symbol of another message — a different count or parity. It is not kept.
 */
export type ReadResult = 'accepted' | 'duplicate' | 'foreign';

export interface AddOutcome {
  readonly result: ReadResult;
  readonly index: number;
  /** Symbols of this message received so far. */
  readonly received: number;
  /** Symbols in this message, or 0 before the first read. */
  readonly count: number;
}

/**
 * Collects the symbols of one message, in any order, from any decoder.
 *
 * The first symbol read decides the message — its count and parity. A symbol of a different message
 * is reported and left out, rather than failing the message, because a camera also sees whatever else
 * is in front of it. A symbol whose position is already filled with different content is damage to
 * this message, and throws.
 */
export class StructuredAppendAssembler {
  private readonly symbols = new Map<number, Uint8Array>();
  private expectedCount = 0;
  private expectedParity = -1;

  public add(read: StructuredAppendRead): AddOutcome {
    requireRead(read);
    if (this.expectedCount === 0) {
      this.expectedCount = read.count;
      this.expectedParity = read.parity;
    }
    if (read.count !== this.expectedCount || read.parity !== this.expectedParity) {
      return this.outcome('foreign', read.index);
    }
    const existing = this.symbols.get(read.index);
    if (existing) {
      if (!sameBytes(existing, read.bytes)) {
        throw new StructuredAppendError(
          'conflicting-symbol',
          `Symbol ${read.index + 1} of ${read.count} arrived twice with different content.`,
        );
      }
      return this.outcome('duplicate', read.index);
    }
    this.symbols.set(read.index, read.bytes.slice());
    return this.outcome('accepted', read.index);
  }

  public received(): number {
    return this.symbols.size;
  }

  /** Symbols in the message, or 0 before the first read. */
  public count(): number {
    return this.expectedCount;
  }

  /** 0-based positions still missing, in order. */
  public missing(): number[] {
    const missing: number[] = [];
    for (let index = 0; index < this.expectedCount; index += 1) {
      if (!this.symbols.has(index)) missing.push(index);
    }
    return missing;
  }

  public isComplete(): boolean {
    return this.expectedCount > 0 && this.symbols.size === this.expectedCount;
  }

  /** The message, joined in order and checked against its parity. */
  public bytes(): Uint8Array {
    if (!this.isComplete()) {
      throw new StructuredAppendError(
        'incomplete',
        `The message is missing ${this.expectedCount - this.symbols.size} of ${this.expectedCount} symbols.`,
      );
    }
    const parts = Array.from({ length: this.expectedCount }, (_, index) => this.symbols.get(index)!);
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    if (parityOf(joined) !== this.expectedParity) {
      throw new StructuredAppendError(
        'parity-mismatch',
        'The joined message does not match the parity its symbols carry.',
      );
    }
    return joined;
  }

  /** The message as UTF-8 text. */
  public text(): string {
    return new TextDecoder().decode(this.bytes());
  }

  public clear(): void {
    this.symbols.clear();
    this.expectedCount = 0;
    this.expectedParity = -1;
  }

  private outcome(result: ReadResult, index: number): AddOutcome {
    return { result, index, received: this.symbols.size, count: this.expectedCount };
  }
}

function requireRead(read: StructuredAppendRead): void {
  const whole = (value: number, low: number, high: number) =>
    Number.isInteger(value) && value >= low && value <= high;
  if (
    !whole(read.count, 1, MAX_SYMBOLS) ||
    !whole(read.index, 0, read.count - 1) ||
    !whole(read.parity, 0, 0xff) ||
    !(read.bytes instanceof Uint8Array)
  ) {
    throw new StructuredAppendError(
      'invalid-read',
      'A Structured Append read needs a position below its count (1 to 16), a parity byte and bytes.',
    );
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
