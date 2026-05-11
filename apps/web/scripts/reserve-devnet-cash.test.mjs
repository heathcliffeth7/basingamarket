import { describe, expect, it } from 'vitest';
import {
  liquidityStatusFromValues,
  manualReserveInstructions,
  parseArgs,
  parseEnvText
} from './reserve-devnet-cash.mjs';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('reserve-devnet-cash script helpers', () => {
  it('parses verify-only and source-keypair modes', () => {
    expect(parseArgs(['--verify-only'])).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:8080',
      verifyOnly: true
    });

    expect(parseArgs([
      '--amount',
      '25.50',
      '--mint-authority-keypair',
      'mint-authority.json',
      '--payer-keypair',
      'payer.json',
      '--api-base-url',
      'http://api.test'
    ])).toMatchObject({
      amount: '25.50',
      apiBaseUrl: 'http://api.test',
      mintAuthorityKeypair: 'mint-authority.json',
      payerKeypair: 'payer.json'
    });

    expect(parseArgs([
      '--amount',
      '25.50',
      '--source-keypair',
      'source.json'
    ])).toMatchObject({
      amount: '25.50',
      sourceKeypair: 'source.json'
    });
  });

  it('rejects missing or invalid reserve amount', () => {
    expect(() => parseArgs([])).toThrow(/Missing --amount/);
    expect(() => parseArgs(['--amount', '0'])).toThrow(/greater than zero/);
    expect(() => parseArgs(['--amount', '1.0000001'])).toThrow(/at most 6 decimal/);
    expect(() => parseArgs([
      '--amount',
      '1',
      '--source-keypair',
      'source.json',
      '--mint-authority-keypair',
      'authority.json'
    ])).toThrow(/either --source-keypair or --mint-authority-keypair/);
  });

  it('loads devnet cash env values', () => {
    expect(parseEnvText(`
      SOLANA_CASH_MINT=${SOLANA_DEVNET_PUBKEY}
      SOLANA_DEPOSIT_VAULT_OWNER='${SOLANA_DEVNET_PUBKEY}'
      SOLANA_CASH_MINT_AUTHORITY_KEYPAIR=authority.json
    `)).toMatchObject({
      SOLANA_CASH_MINT: SOLANA_DEVNET_PUBKEY,
      SOLANA_DEPOSIT_VAULT_OWNER: SOLANA_DEVNET_PUBKEY,
      SOLANA_CASH_MINT_AUTHORITY_KEYPAIR: 'authority.json'
    });
  });

  it('computes available reserve without going negative', () => {
    expect(liquidityStatusFromValues('2500000', '1000000')).toMatchObject({
      available_cash_reserve: '1500000',
      status: 'ready'
    });
    expect(liquidityStatusFromValues('1000000', '1000000')).toMatchObject({
      available_cash_reserve: '0',
      status: 'liquidity_pending'
    });
  });

  it('prints Phantom-safe manual top-up instructions', () => {
    const instructions = manualReserveInstructions({
      amount: '5',
      baseUnits: '5000000',
      mint: SOLANA_DEVNET_PUBKEY,
      vaultOwner: SOLANA_DEVNET_PUBKEY,
      vaultTokenAccount: 'So11111111111111111111111111111111111111112'
    });

    expect(instructions).toContain('Manual Phantom devnet reserve top-up');
    expect(instructions).toContain('5 BUSDC');
    expect(instructions).toContain('5000000 base units');
    expect(instructions).toContain('npm run reserve:devnet-cash -- --verify-only');
    expect(instructions).toContain('do not verify it as a user deposit');
  });
});
