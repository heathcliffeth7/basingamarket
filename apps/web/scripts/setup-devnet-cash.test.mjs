import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSixDecimalSplMint,
  envLinesForSetup,
  isSolanaPubkey,
  loadOrCreateKeypairSigner,
  parseArgs,
  parseTokenAmountToBaseUnits,
  resolveFilesystemPath,
  upsertEnvValues
} from './setup-devnet-cash.mjs';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('setup-devnet-cash script helpers', () => {
  it('parses required payer and user arguments', () => {
    expect(parseArgs(['--payer', 'payer.json', '--user', SOLANA_DEVNET_PUBKEY])).toMatchObject({
      amount: '1000',
      payer: 'payer.json',
      rpcUrl: 'https://api.devnet.solana.com',
      user: SOLANA_DEVNET_PUBKEY,
      writeEnv: null
    });
  });

  it('parses an existing devnet cash mint without requiring a payer', () => {
    const parsed = parseArgs([
      '--cash-mint',
      SOLANA_DEVNET_PUBKEY,
      '--mint-authority-keypair',
      'mint-authority.json',
      '--vault-owner-keypair',
      '~/.config/solana/basingamarket-devnet-vault-owner.json',
      '--write-env',
      '../../.env'
    ]);

    expect(parsed).toMatchObject({
      cashMint: SOLANA_DEVNET_PUBKEY,
      mintAuthorityKeypair: 'mint-authority.json',
      vaultOwnerKeypair: '~/.config/solana/basingamarket-devnet-vault-owner.json',
      writeEnv: '../../.env'
    });
    expect(parsed).not.toHaveProperty('payer');
    expect(parsed).not.toHaveProperty('user');
  });

  it('rejects malformed Solana pubkeys', () => {
    expect(isSolanaPubkey(SOLANA_DEVNET_PUBKEY)).toBe(true);
    expect(isSolanaPubkey('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(() => parseArgs(['--payer', 'payer.json', '--user', 'abc'])).toThrow(/valid 32-byte Solana pubkey/);
    expect(() => parseArgs(['--cash-mint', 'abc'])).toThrow(/--cash-mint/);
    expect(() => parseArgs([
      '--cash-mint',
      SOLANA_DEVNET_PUBKEY,
      '--vault-owner',
      SOLANA_DEVNET_PUBKEY,
      '--vault-owner-keypair',
      'vault.json'
    ])).toThrow(/either --vault-owner or --vault-owner-keypair/);
  });

  it('parses 6-decimal token amounts to base units', () => {
    expect(parseTokenAmountToBaseUnits('1000').toString()).toBe('1000000000');
    expect(parseTokenAmountToBaseUnits('1.234567').toString()).toBe('1234567');
    expect(() => parseTokenAmountToBaseUnits('1.2345678')).toThrow(/at most 6 decimal/);
  });

  it('validates that existing cash mint is a 6-decimal SPL mint', () => {
    const mintData = Buffer.alloc(82);
    mintData[44] = 6;
    mintData[45] = 1;

    expect(() => assertSixDecimalSplMint({
      data: [mintData.toString('base64'), 'base64'],
      owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    }, SOLANA_DEVNET_PUBKEY)).not.toThrow();

    const tokenAccountData = Buffer.alloc(165);
    expect(() => assertSixDecimalSplMint({
      data: [tokenAccountData.toString('base64'), 'base64'],
      owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    }, SOLANA_DEVNET_PUBKEY)).toThrow(/mint account/);
  });

  it('prints and upserts devnet BUSDC env values', () => {
    const values = envLinesForSetup({
      mint: SOLANA_DEVNET_PUBKEY,
      mintAuthorityKeypairPath: 'payer.json',
      vaultOwner: 'So11111111111111111111111111111111111111112',
      vaultTokenAccount: '9VgAk7ro7kVQZwGTQ6aoQ24ZY75hGdjL7ST4Tq3c4Eqf'
    });

    expect(values).toContain(`SOLANA_CASH_MINT=${SOLANA_DEVNET_PUBKEY}`);
    expect(values).toContain('SOLANA_CASH_DECIMALS=6');
    expect(values).toContain('SOLANA_CASH_MINT_AUTHORITY_KEYPAIR=payer.json');

    const next = upsertEnvValues('RUST_LOG=info\nSOLANA_CASH_MINT=old\n', values);
    expect(next).toContain('RUST_LOG=info\n');
    expect(next).toContain(`SOLANA_CASH_MINT=${SOLANA_DEVNET_PUBKEY}\n`);
    expect(next).toContain('SOLANA_DEPOSIT_COMMITMENT=confirmed\n');
    expect(next).not.toContain('SOLANA_CASH_MINT=old');
  });

  it('creates and reuses a local vault owner keypair', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'basingamarket-vault-'));
    const keypairPath = path.join(dir, 'vault-owner.json');
    try {
      const first = await loadOrCreateKeypairSigner(keypairPath);
      const second = await loadOrCreateKeypairSigner(keypairPath);
      const stat = await fs.promises.stat(keypairPath);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(first.signer.address).toBe(second.signer.address);
      expect(JSON.parse(await fs.promises.readFile(keypairPath, 'utf8'))).toHaveLength(64);
      expect(stat.mode & 0o777).toBe(0o600);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves home-relative keypair paths', () => {
    expect(resolveFilesystemPath('~/basingamarket-vault.json')).toContain('/basingamarket-vault.json');
  });
});
