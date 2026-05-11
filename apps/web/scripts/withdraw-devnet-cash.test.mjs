import { describe, expect, it } from 'vitest';
import { parseArgs, parseEnvText } from './withdraw-devnet-cash.mjs';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('withdraw-devnet-cash script helpers', () => {
  it('parses withdraw smoke arguments', () => {
    expect(parseArgs([
      '--destination',
      SOLANA_DEVNET_PUBKEY,
      '--amount',
      '1.25',
      '--vault-owner-keypair',
      '~/.config/solana/basingamarket-devnet-vault-owner.json'
    ])).toMatchObject({
      amount: '1.25',
      destination: SOLANA_DEVNET_PUBKEY,
      vaultOwnerKeypair: '~/.config/solana/basingamarket-devnet-vault-owner.json'
    });
  });

  it('rejects missing or malformed withdraw inputs', () => {
    expect(() => parseArgs(['--amount', '1'])).toThrow(/Missing --destination/);
    expect(() => parseArgs(['--destination', SOLANA_DEVNET_PUBKEY])).toThrow(/BUSDC/);
    expect(() => parseArgs(['--destination', 'abc', '--amount', '1'])).toThrow(/valid 32-byte Solana pubkey/);
    expect(() => parseArgs(['--destination', SOLANA_DEVNET_PUBKEY, '--amount', '0'])).toThrow(/greater than zero/);
  });

  it('loads simple env values for cash mint and vault config', () => {
    expect(parseEnvText(`
      SOLANA_CASH_MINT=${SOLANA_DEVNET_PUBKEY}
      SOLANA_DEPOSIT_VAULT_OWNER='${SOLANA_DEVNET_PUBKEY}'
      # ignored
    `)).toMatchObject({
      SOLANA_CASH_MINT: SOLANA_DEVNET_PUBKEY,
      SOLANA_DEPOSIT_VAULT_OWNER: SOLANA_DEVNET_PUBKEY
    });
  });
});
