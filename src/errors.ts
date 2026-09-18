export type StructuredAppendErrorCode =
  | 'empty-message'
  | 'invalid-option'
  | 'too-many-symbols'
  | 'invalid-read'
  | 'conflicting-symbol'
  | 'incomplete'
  | 'parity-mismatch';

/** A failure this library can name, so callers can tell a bad read from a bad message. */
export class StructuredAppendError extends Error {
  public readonly code: StructuredAppendErrorCode;

  public constructor(code: StructuredAppendErrorCode, message: string) {
    super(message);
    this.name = 'StructuredAppendError';
    this.code = code;
  }
}
