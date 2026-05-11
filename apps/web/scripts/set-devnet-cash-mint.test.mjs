import { describe, expect, it } from 'vitest';
import {
  decodeGlobalConfigAccount,
  deriveGlobalPda,
  parseArgs,
  setCashMintData
} from './set-devnet-cash-mint.mjs';

const PROGRAM_ID = '3oAve8qsR5oVtqUcsXtSELBVz5CnJifj4UCvM6AiHa2r';
const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('set-devnet-cash-mint script helpers', () => {
  it('parses explicit cash mint update options', () => {
    expect(parseArgs([
      '--program-id',
      PROGRAM_ID,
      '--cash-mint',
      SOLANA_DEVNET_PUBKEY,
      '--admin-keypair',
      'admin.json',
      '--env',
      '../../.env'
    ])).toMatchObject({
      adminKeypair: 'admin.json',
      cashMint: SOLANA_DEVNET_PUBKEY,
      env: '../../.env',
      programId: PROGRAM_ID
    });
  });

  it('rejects malformed pubkeys', () => {
    expect(() => parseArgs(['--program-id', 'abc'])).toThrow(/--program-id/);
    expect(() => parseArgs(['--cash-mint', 'abc'])).toThrow(/--cash-mint/);
    expect(() => parseArgs(['--global', 'abc'])).toThrow(/--global/);
  });

  it('encodes set_cash_mint instruction data deterministically', () => {
    const data = setCashMintData({ usdcMint: SOLANA_DEVNET_PUBKEY });

    expect(data).toHaveLength(40);
    expect(Buffer.from(data).toString('hex').slice(0, 16)).toBe('1ba3ec0f3edeacf5');
  });

  it('decodes admin and current mint from a global config account', () => {
    const data = Buffer.alloc(160);
    const encodedMint = setCashMintData({ usdcMint: SOLANA_DEVNET_PUBKEY }).subarray(8);
    data.set(encodedMint, 8);
    data.set(encodedMint, 72);

    expect(decodeGlobalConfigAccount(data)).toMatchObject({
      admin: SOLANA_DEVNET_PUBKEY,
      usdcMint: SOLANA_DEVNET_PUBKEY
    });
  });

  it('derives the existing devnet global PDA', async () => {
    await expect(deriveGlobalPda(PROGRAM_ID)).resolves.toBe('5k2zQuYhuk6UvJDkw142Nz9AiAgoSjkFdGbhdUu5KEK1');
  });
});
