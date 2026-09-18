/**
 * The Structured Append parity: every byte of the whole message XORed together.
 *
 * It is what marks symbols as belonging to one message, and all it can do: eight bits, so two
 * unrelated messages share a parity one time in 256. A caller that needs to know which message it has,
 * or that it arrived intact, carries its own identifier and hash inside the message.
 */
export function parityOf(bytes: Uint8Array): number {
  let parity = 0;
  for (const byte of bytes) parity ^= byte;
  return parity;
}
