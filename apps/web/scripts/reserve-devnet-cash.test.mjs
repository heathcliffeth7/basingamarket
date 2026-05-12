import { describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  fetchDepositLiquidity,
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
      'http://api.test',
      '--api-timeout-ms',
      '2500',
      '--skip-liquidity'
    ])).toMatchObject({
      amount: '25.50',
      apiBaseUrl: 'http://api.test',
      apiTimeoutMs: 2500,
      mintAuthorityKeypair: 'mint-authority.json',
      payerKeypair: 'payer.json',
      skipLiquidity: true
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
    expect(() => parseArgs(['--amount', '1', '--api-timeout-ms', '0'])).toThrow(/positive integer/);
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

  it('fetches deposit liquidity with a timeout', async () => {
    await withServer((request, response) => {
      expect(request.url).toBe('/deposit/liquidity');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'ready',
        available_cash_reserve: '1000000'
      }));
    }, async (baseUrl) => {
      await expect(fetchDepositLiquidity(baseUrl, { timeoutMs: 100 })).resolves.toMatchObject({
        status: 'ready',
        available_cash_reserve: '1000000'
      });
    });
  });

  it('fails deposit liquidity fetches that exceed the timeout', async () => {
    await withServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      }, 50);
    }, async (baseUrl) => {
      await expect(fetchDepositLiquidity(baseUrl, { timeoutMs: 10 })).rejects.toThrow(/timeout/);
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

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}
