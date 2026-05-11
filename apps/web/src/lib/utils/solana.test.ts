import { describe, expect, it } from 'vitest';
import { encodeBase58, encodeBase64, isSolanaPubkey, isSolanaSignature } from './solana';

describe('solana utils', () => {
  it('accepts 32-byte base58 Solana pubkeys', () => {
    expect(isSolanaPubkey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')).toBe(true);
  });

  it('rejects 0x and malformed addresses', () => {
    expect(isSolanaPubkey('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(isSolanaPubkey('abc')).toBe(false);
  });

  it('encodes signatures as base58 and validates 64-byte signatures', () => {
    const signature = encodeBase58(new Uint8Array(64).fill(7));

    expect(isSolanaSignature(signature)).toBe(true);
    expect(isSolanaSignature('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('encodes bytes as browser-safe base64', () => {
    expect(encodeBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    expect(encodeBase64(new Uint8Array(64).fill(7))).toBe('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw==');
  });
});
