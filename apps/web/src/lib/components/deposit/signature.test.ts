import { describe, expect, it } from 'vitest';
import { encodeDepositSignature } from './signature';

describe('deposit signature helpers', () => {
  it('keeps deposit transaction signatures encoded as base58', () => {
    expect(encodeDepositSignature(new Uint8Array(64).fill(7))).toBe('99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8');
  });
});
