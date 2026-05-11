#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { webcrypto } from 'node:crypto';
import {
  address,
  appendTransactionMessageInstructionPlan,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
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
  getCreateMintInstructionPlan,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';
const DEFAULT_AMOUNT = '1000';
const DEFAULT_VAULT_OWNER_KEYPAIR = '~/.config/solana/basingamarket-devnet-vault-owner.json';
const CASH_DECIMALS = 6;

export function parseArgs(argv) {
  const options = {
    amount: DEFAULT_AMOUNT,
    rpcUrl: DEFAULT_RPC_URL,
    wsUrl: DEFAULT_WS_URL,
    writeEnv: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--help' || flag === '-h') {
      return { ...options, help: true };
    }
    if (!flag?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${flag}`);
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === '--payer') options.payer = next;
    else if (flag === '--user') options.user = next;
    else if (flag === '--cash-mint') options.cashMint = next;
    else if (flag === '--mint-authority-keypair') options.mintAuthorityKeypair = next;
    else if (flag === '--vault-owner') options.vaultOwner = next;
    else if (flag === '--vault-owner-keypair') options.vaultOwnerKeypair = next;
    else if (flag === '--amount') options.amount = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else if (flag === '--write-env') options.writeEnv = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) {
    if (options.vaultOwner && options.vaultOwnerKeypair) {
      throw new Error('Use either --vault-owner or --vault-owner-keypair, not both');
    }
    if (options.vaultOwner && !isSolanaPubkey(options.vaultOwner)) {
      throw new Error('--vault-owner must be a valid 32-byte Solana pubkey');
    }
    if (options.cashMint) {
      if (!isSolanaPubkey(options.cashMint)) throw new Error('--cash-mint must be a valid 32-byte Solana pubkey');
    } else {
      if (!options.payer) throw new Error('Missing --payer <keypair.json>');
      if (!options.user) throw new Error('Missing --user <phantom_pubkey>');
      if (!isSolanaPubkey(options.user)) throw new Error('--user must be a valid 32-byte Solana pubkey');
    }
  }

  return options;
}

export function parseTokenAmountToBaseUnits(value, decimals = CASH_DECIMALS) {
  const trimmed = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('--amount must be a positive decimal amount');
  }
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new Error(`--amount supports at most ${decimals} decimal places`);
  }
  const baseUnits = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (baseUnits <= 0n) {
    throw new Error('--amount must be greater than zero');
  }
  return baseUnits;
}

export function envLinesForSetup(result) {
  return [
    `SOLANA_CASH_MINT=${result.mint}`,
    `SOLANA_CASH_DECIMALS=${CASH_DECIMALS}`,
    `SOLANA_DEPOSIT_VAULT_OWNER=${result.vaultOwner}`,
    `SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT=${result.vaultTokenAccount}`,
    'SOLANA_DEPOSIT_COMMITMENT=confirmed',
    'SOLANA_SOL_DEPOSIT_ENABLED=true',
    `SOLANA_SOL_TREASURY=${result.vaultOwner}`,
    'SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS=60',
    'SOLANA_SOL_DEPOSIT_PRICE_SYMBOL=SOLUSDT',
    'SOLANA_WITHDRAW_ENABLED=true',
    `SOLANA_WITHDRAW_VAULT_OWNER_KEYPAIR=${result.vaultOwnerKeypairPath ?? DEFAULT_VAULT_OWNER_KEYPAIR}`,
    'SOLANA_WITHDRAW_QUOTE_TTL_SECONDS=60',
    ...(result.mintAuthorityKeypairPath
      ? [`SOLANA_CASH_MINT_AUTHORITY_KEYPAIR=${result.mintAuthorityKeypairPath}`]
      : [])
  ];
}

export function upsertEnvValues(current, values) {
  const byKey = new Map(values.map((line) => line.split('=', 1)[0]).map((key, index) => [key, values[index]]));
  const seen = new Set();
  const next = current
    .split(/\r?\n/)
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => {
      const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
      if (key && byKey.has(key)) {
        seen.add(key);
        return byKey.get(key);
      }
      return line;
    });

  for (const line of values) {
    const key = line.split('=', 1)[0];
    if (!seen.has(key)) next.push(line);
  }

  return `${next.join('\n')}\n`;
}

export function isSolanaPubkey(value) {
  return decodeBase58(String(value).trim())?.length === 32;
}

async function setupDevnetCash(options) {
  if (options.cashMint) {
    return setupExistingDevnetCashMint(options);
  }

  const payer = await loadKeypairSigner(options.payer);
  const user = address(options.user);
  const amount = parseTokenAmountToBaseUnits(options.amount);
  const rpc = createSolanaRpc(options.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(options.wsUrl);
  const mint = await generateKeyPairSigner();
  const mintAuthority = options.mintAuthorityKeypair
    ? await loadOrCreateKeypairSigner(options.mintAuthorityKeypair)
    : {
        created: false,
        path: options.payer,
        signer: payer
      };
  const vaultOwner = await resolveVaultOwner(options);
  const [vaultTokenAccount] = await findAssociatedTokenPda({
    owner: vaultOwner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mint.address
  });
  const [userTokenAccount] = await findAssociatedTokenPda({
    owner: user,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mint.address
  });
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const createMintPlan = getCreateMintInstructionPlan({
    payer,
    newMint: mint,
    decimals: CASH_DECIMALS,
    mintAuthority: mintAuthority.signer.address,
    freezeAuthority: null
  });
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: vaultTokenAccount,
      owner: vaultOwner.address,
      mint: mint.address
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: userTokenAccount,
      owner: user,
      mint: mint.address
    }),
    getMintToCheckedInstruction({
      mint: mint.address,
      token: userTokenAccount,
      mintAuthority: mintAuthority.signer,
      amount,
      decimals: CASH_DECIMALS
    })
  ];
  const messageWithMint = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(payer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) => appendTransactionMessageInstructionPlan(createMintPlan, message)
  );
  const message = appendTransactionMessageInstructions(instructions, messageWithMint);
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });

  return {
    amount: amount.toString(),
    mint: mint.address,
    payer: payer.address,
    mintAuthorityKeypairCreated: mintAuthority.created,
    mintAuthorityKeypairPath: mintAuthority.path,
    signature: getSignatureFromTransaction(signedTransaction),
    user: options.user,
    userTokenAccount,
    vaultOwner: vaultOwner.address,
    vaultOwnerKeypairCreated: vaultOwner.keypairCreated,
    vaultOwnerKeypairPath: vaultOwner.keypairPath,
    vaultOwnerWarning: vaultOwner.warning,
    vaultTokenAccount
  };
}

async function setupExistingDevnetCashMint(options) {
  const mint = address(options.cashMint);
  const rpc = createSolanaRpc(options.rpcUrl);
  await validateExistingMintAccount(rpc, mint);

  const vaultOwner = await resolveVaultOwner(options);
  const [vaultTokenAccount] = await findAssociatedTokenPda({
    owner: vaultOwner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });

  return {
    amount: '0',
    existingMint: true,
    mint,
    mintAuthorityKeypairPath: options.mintAuthorityKeypair ?? null,
    payer: null,
    signature: null,
    user: options.user ?? null,
    userTokenAccount: null,
    vaultOwner: vaultOwner.address,
    vaultOwnerKeypairCreated: vaultOwner.keypairCreated,
    vaultOwnerKeypairPath: vaultOwner.keypairPath,
    vaultOwnerWarning: vaultOwner.warning,
    vaultTokenAccount
  };
}

async function resolveVaultOwner(options) {
  if (options.vaultOwnerKeypair) {
    const keypair = await loadOrCreateKeypairSigner(options.vaultOwnerKeypair);
    return {
      address: keypair.signer.address,
      keypairCreated: keypair.created,
      keypairPath: keypair.path,
      warning: null
    };
  }
  if (options.vaultOwner) {
    return {
      address: address(options.vaultOwner),
      keypairCreated: false,
      keypairPath: null,
      warning: null
    };
  }

  const generatedVaultOwner = await generateKeyPairSigner();
  return {
    address: generatedVaultOwner.address,
    keypairCreated: false,
    keypairPath: null,
    warning: `Generated devnet-only vault owner without saving a keypair. Use --vault-owner-keypair ${DEFAULT_VAULT_OWNER_KEYPAIR} for recoverable withdraw tests.`
  };
}

async function validateExistingMintAccount(rpc, mint) {
  const { value } = await rpc.getAccountInfo(mint, { encoding: 'base64', commitment: 'confirmed' }).send();
  assertSixDecimalSplMint(value, mint);
}

export function assertSixDecimalSplMint(accountInfo, mint) {
  if (!accountInfo) {
    throw new Error(`--cash-mint ${mint} was not found on devnet`);
  }
  if (String(accountInfo.owner) !== String(TOKEN_PROGRAM_ADDRESS)) {
    throw new Error('--cash-mint must be an SPL Token mint account, not a token account or wallet address');
  }

  const encodedData = Array.isArray(accountInfo.data) ? accountInfo.data[0] : null;
  const data = encodedData ? Buffer.from(encodedData, 'base64') : Buffer.alloc(0);
  if (data.length !== 82) {
    throw new Error('--cash-mint must be an SPL Token mint account, not a token account or wallet address');
  }
  const decimals = data[44];
  const isInitialized = data[45] === 1;
  if (!isInitialized) {
    throw new Error('--cash-mint points to an uninitialized SPL mint');
  }
  if (decimals !== CASH_DECIMALS) {
    throw new Error(`--cash-mint must use ${CASH_DECIMALS} decimals; got ${decimals}`);
  }
}

async function loadKeypairSigner(keypairPath) {
  const raw = await fs.promises.readFile(resolveFilesystemPath(keypairPath), 'utf8');
  const bytes = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`${keypairPath} must point to a 64-byte Solana keypair JSON file`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}

export async function loadOrCreateKeypairSigner(keypairPath) {
  const resolvedPath = resolveFilesystemPath(keypairPath);
  if (fs.existsSync(resolvedPath)) {
    await fs.promises.chmod(resolvedPath, 0o600);
    return {
      created: false,
      path: resolvedPath,
      signer: await loadKeypairSigner(resolvedPath)
    };
  }

  const bytes = await generateSolanaKeypairBytes();
  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(resolvedPath, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
  await fs.promises.chmod(resolvedPath, 0o600);
  return {
    created: true,
    path: resolvedPath,
    signer: await createKeyPairSignerFromBytes(bytes)
  };
}

export async function generateSolanaKeypairBytes() {
  const seed = webcrypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', signer.keyPair.publicKey));
  const bytes = new Uint8Array(64);
  bytes.set(seed);
  bytes.set(publicKey, 32);
  return bytes;
}

export function resolveFilesystemPath(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') {
    return process.env.HOME ?? filePath;
  }
  if (filePath.startsWith('~/')) {
    return path.join(process.env.HOME ?? '~', filePath.slice(2));
  }
  return path.resolve(process.cwd(), filePath);
}

function decodeBase58(value) {
  if (!value) return null;
  const bytes = [];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit === -1) return null;

    let carry = digit;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return bytes;
}

function printHelp() {
  console.log(`Usage:
  npm run setup:devnet-cash -- --payer <keypair.json> --user <phantom_pubkey> [--mint-authority-keypair <keypair.json>] [--amount 1000] [--write-env ../../.env]
  npm run setup:devnet-cash -- --cash-mint <existing_devnet_busdc_mint> [--mint-authority-keypair <keypair.json>] [--vault-owner-keypair ${DEFAULT_VAULT_OWNER_KEYPAIR}] [--write-env ../../.env]
  npm run setup:devnet-cash -- --cash-mint <existing_devnet_busdc_mint> [--vault-owner <pubkey>] [--write-env ../../.env]

Creates a Solana devnet 6-decimal BasingaUSDC (BUSDC) legacy SPL mint, or validates and configures an existing 6-decimal devnet BUSDC token mint.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await setupDevnetCash(options);
  const envLines = envLinesForSetup(result);

  console.log('Devnet BUSDC setup complete.');
  if (result.signature) console.log(`Transaction: ${result.signature}`);
  if (result.userTokenAccount) console.log(`User token account: ${result.userTokenAccount}`);
  if (result.amount !== '0') console.log(`Minted base units: ${result.amount}`);
  if (result.vaultOwnerKeypairPath) {
    console.log(`Vault owner keypair: ${result.vaultOwnerKeypairPath} (${result.vaultOwnerKeypairCreated ? 'created' : 'reused'})`);
  }
  if (result.mintAuthorityKeypairPath) {
    console.log(`Mint authority keypair: ${result.mintAuthorityKeypairPath} (${result.mintAuthorityKeypairCreated ? 'created' : 'reused'})`);
  }
  if (result.vaultOwnerWarning) console.log(result.vaultOwnerWarning);
  console.log('');
  console.log(envLines.join('\n'));

  if (options.writeEnv) {
    const envPath = path.resolve(process.cwd(), options.writeEnv);
    const current = fs.existsSync(envPath) ? await fs.promises.readFile(envPath, 'utf8') : '';
    await fs.promises.writeFile(envPath, upsertEnvValues(current, envLines));
    console.log('');
    console.log(`Updated ${envPath}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
