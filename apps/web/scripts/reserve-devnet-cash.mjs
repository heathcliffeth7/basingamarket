#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToCheckedInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import {
  isSolanaPubkey,
  parseTokenAmountToBaseUnits,
  resolveFilesystemPath
} from './setup-devnet-cash.mjs';

const DEFAULT_ENV_PATH = '../../.env';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_API_TIMEOUT_MS = 5000;
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';
const CASH_DECIMALS = 6;

export function parseArgs(argv) {
  const options = {
    env: DEFAULT_ENV_PATH,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiTimeoutMs: DEFAULT_API_TIMEOUT_MS,
    rpcUrl: null,
    wsUrl: null,
    skipLiquidity: false,
    verifyOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (flag === '--verify-only') {
      options.verifyOnly = true;
      continue;
    }
    if (flag === '--skip-liquidity') {
      options.skipLiquidity = true;
      continue;
    }
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--amount') options.amount = next;
    else if (flag === '--payer-keypair') options.payerKeypair = next;
    else if (flag === '--source-keypair') options.sourceKeypair = next;
    else if (flag === '--mint-authority-keypair') options.mintAuthorityKeypair = next;
    else if (flag === '--env') options.env = next;
    else if (flag === '--api-base-url') options.apiBaseUrl = next;
    else if (flag === '--api-timeout-ms') options.apiTimeoutMs = parsePositiveInteger(next, flag);
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) {
    if (!options.verifyOnly && !options.amount) throw new Error('Missing --amount <BUSDC>');
    if (options.sourceKeypair && options.mintAuthorityKeypair) {
      throw new Error('Use either --source-keypair or --mint-authority-keypair, not both');
    }
    if (options.amount) parseTokenAmountToBaseUnits(options.amount);
  }

  return options;
}

export function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value.trim()) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function liquidityStatusFromValues(vaultCashBalance, totalCashLiabilities) {
  const vault = BigInt(vaultCashBalance);
  const liabilities = BigInt(totalCashLiabilities);
  const available = vault > liabilities ? vault - liabilities : 0n;
  return {
    available_cash_reserve: available.toString(),
    status: available > 0n ? 'ready' : 'liquidity_pending'
  };
}

export function manualReserveInstructions({ amount, baseUnits, mint, vaultOwner, vaultTokenAccount }) {
  return [
    'Manual Phantom devnet reserve top-up:',
    `1. Send exactly ${amount} BUSDC (${baseUnits} base units).`,
    `2. Mint: ${mint}`,
    `3. Phantom recipient wallet: ${vaultOwner}`,
    `4. Target vault token account / ATA: ${vaultTokenAccount}`,
    '5. This is app/admin reserve liquidity; do not verify it as a user deposit.',
    '6. After sending, run: npm run reserve:devnet-cash -- --verify-only'
  ].join('\n');
}

async function reserveDevnetCash(options) {
  const config = await loadReserveConfig(options);
  if (options.verifyOnly) {
    return {
      mode: 'verify',
      liquidity: await fetchDepositLiquidity(options.apiBaseUrl, { timeoutMs: options.apiTimeoutMs })
    };
  }

  const amount = parseTokenAmountToBaseUnits(options.amount);
  if (!options.sourceKeypair) {
    const mintAuthorityKeypair = options.mintAuthorityKeypair ?? config.mintAuthorityKeypair;
    if (mintAuthorityKeypair) {
      const signature = await mintReserveFromAuthority(
        mintAuthorityKeypair,
        options.payerKeypair ?? config.reservePayerKeypair,
        config,
        amount
      );
      return {
        mode: 'mint',
        signature,
        liquidity: options.skipLiquidity
          ? null
          : await fetchDepositLiquidity(options.apiBaseUrl, { timeoutMs: options.apiTimeoutMs }).catch(() => null)
      };
    }
    return {
      mode: 'manual',
      instructions: manualReserveInstructions({
        amount: options.amount,
        baseUnits: amount.toString(),
        mint: config.mint,
        vaultOwner: config.vaultOwner,
        vaultTokenAccount: config.vaultTokenAccount
      })
    };
  }

  const signature = await transferReserveFromSourceKeypair(options, config, amount);
  return {
    mode: 'transfer',
    signature,
    liquidity: options.skipLiquidity
      ? null
      : await fetchDepositLiquidity(options.apiBaseUrl, { timeoutMs: options.apiTimeoutMs }).catch(() => null)
  };
}

async function loadReserveConfig(options) {
  const envPath = resolveFilesystemPath(options.env);
  const env = fs.existsSync(envPath)
    ? parseEnvText(await fs.promises.readFile(envPath, 'utf8'))
    : {};
  const mint = env.SOLANA_CASH_MINT ?? process.env.SOLANA_CASH_MINT;
  const vaultOwner = env.SOLANA_DEPOSIT_VAULT_OWNER ?? process.env.SOLANA_DEPOSIT_VAULT_OWNER;
  const mintAuthorityKeypair = env.SOLANA_CASH_MINT_AUTHORITY_KEYPAIR
    ?? process.env.SOLANA_CASH_MINT_AUTHORITY_KEYPAIR
    ?? null;
  const reservePayerKeypair = env.SOLANA_CASH_RESERVE_PAYER_KEYPAIR
    ?? process.env.SOLANA_CASH_RESERVE_PAYER_KEYPAIR
    ?? env.SOLANA_WITHDRAW_VAULT_OWNER_KEYPAIR
    ?? process.env.SOLANA_WITHDRAW_VAULT_OWNER_KEYPAIR
    ?? null;
  if (!mint || !isSolanaPubkey(mint)) {
    throw new Error('Missing or invalid SOLANA_CASH_MINT in env');
  }
  if (!vaultOwner || !isSolanaPubkey(vaultOwner)) {
    throw new Error('Missing or invalid SOLANA_DEPOSIT_VAULT_OWNER in env');
  }
  const rpcUrl = options.rpcUrl ?? env.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const wsUrl = options.wsUrl ?? env.SOLANA_WS_URL ?? process.env.SOLANA_WS_URL ?? DEFAULT_WS_URL;
  const [derivedVaultTokenAccount] = await findAssociatedTokenPda({
    owner: address(vaultOwner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: address(mint)
  });
  const vaultTokenAccount = env.SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT
    ?? process.env.SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT
    ?? derivedVaultTokenAccount;
  if (!isSolanaPubkey(vaultTokenAccount)) {
    throw new Error('SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT must be a valid Solana pubkey');
  }
  if (vaultTokenAccount !== derivedVaultTokenAccount) {
    throw new Error('SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT must be the ATA for SOLANA_DEPOSIT_VAULT_OWNER and SOLANA_CASH_MINT');
  }
  return {
    mint,
    mintAuthorityKeypair,
    reservePayerKeypair,
    rpcUrl,
    vaultOwner,
    vaultTokenAccount,
    wsUrl
  };
}

async function mintReserveFromAuthority(mintAuthorityKeypair, payerKeypair, config, amount) {
  const authority = await loadKeypairSigner(mintAuthorityKeypair);
  const payer = payerKeypair ? await loadKeypairSigner(payerKeypair) : authority;
  const mint = address(config.mint);
  const rpc = createSolanaRpc(config.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(config.wsUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: address(config.vaultTokenAccount),
      owner: address(config.vaultOwner),
      mint
    }),
    getMintToCheckedInstruction({
      mint,
      token: address(config.vaultTokenAccount),
      mintAuthority: authority,
      amount,
      decimals: CASH_DECIMALS
    })
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(payer, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions(instructions, transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signedTransaction);
}

async function transferReserveFromSourceKeypair(options, config, amount) {
  const source = await loadKeypairSigner(options.sourceKeypair);
  const mint = address(config.mint);
  const rpc = createSolanaRpc(config.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(config.wsUrl);
  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner: source.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: source,
      ata: address(config.vaultTokenAccount),
      owner: address(config.vaultOwner),
      mint
    }),
    getTransferCheckedInstruction({
      source: sourceTokenAccount,
      mint,
      destination: address(config.vaultTokenAccount),
      authority: source,
      amount,
      decimals: CASH_DECIMALS
    })
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(source, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions(instructions, transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signedTransaction);
}

export async function fetchDepositLiquidity(apiBaseUrl, { timeoutMs = DEFAULT_API_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/deposit/liquidity`, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API ${response.status} for /deposit/liquidity`);
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms for /deposit/liquidity`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadKeypairSigner(keypairPath) {
  const resolved = resolveFilesystemPath(keypairPath);
  const bytes = JSON.parse(await fs.promises.readFile(resolved, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`${resolved} must point to a 64-byte Solana keypair JSON file`);
  }
  const { createKeyPairSignerFromBytes } = await import('@solana/kit');
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}

function printLiquidity(liquidity) {
  console.log(`Status: ${liquidity.status}`);
  console.log(`Vault owner: ${liquidity.vault_owner ?? 'n/a'}`);
  console.log(`Vault token account: ${liquidity.vault_token_account ?? 'n/a'}`);
  console.log(`Vault BUSDC balance: ${liquidity.vault_cash_balance}`);
  console.log(`Total App BUSDC liabilities: ${liquidity.total_cash_liabilities}`);
  console.log(`Available BUSDC reserve: ${liquidity.available_cash_reserve}`);
}

function printHelp() {
  console.log(`Usage:
  npm run reserve:devnet-cash -- --amount <BUSDC>
  npm run reserve:devnet-cash -- --amount <BUSDC> --source-keypair <keypair.json>
  npm run reserve:devnet-cash -- --amount <BUSDC> --mint-authority-keypair <keypair.json> [--payer-keypair <keypair.json>]
  npm run reserve:devnet-cash -- --amount <BUSDC> --mint-authority-keypair <keypair.json> --skip-liquidity
  npm run reserve:devnet-cash -- --verify-only

Adds devnet-only app/admin BUSDC reserve to the configured vault. This does not credit any user App BUSDC balance.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await reserveDevnetCash(options);
  if (result.mode === 'verify') {
    printLiquidity(result.liquidity);
  } else if (result.mode === 'manual') {
    console.log(result.instructions);
  } else {
    console.log(result.mode === 'mint'
      ? 'Devnet BUSDC reserve mint complete.'
      : 'Devnet BUSDC reserve top-up complete.');
    console.log(`Transaction: ${result.signature}`);
    if (result.liquidity) printLiquidity(result.liquidity);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
