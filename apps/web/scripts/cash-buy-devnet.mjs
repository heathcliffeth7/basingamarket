#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressEncoder,
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
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import {
  isSolanaPubkey,
  resolveFilesystemPath
} from './setup-devnet-cash.mjs';

const DEFAULT_ENV_PATH = '../../.env';
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';
const DEFAULT_CASHIER_KEYPAIR = '~/.config/solana/basingamarket-devnet-vault-owner.json';
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
const ADDRESS_ENCODER = getAddressEncoder();

export function parseArgs(argv) {
  const options = {
    cashierKeypair: DEFAULT_CASHIER_KEYPAIR,
    env: DEFAULT_ENV_PATH,
    rpcUrl: null,
    wsUrl: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);

    if (flag === '--program-id') options.programId = next;
    else if (flag === '--global') options.global = next;
    else if (flag === '--round') options.round = next;
    else if (flag === '--position-lot') options.positionLot = next;
    else if (flag === '--usdc-mint') options.usdcMint = next;
    else if (flag === '--cash-vault') options.cashVault = next;
    else if (flag === '--round-vault') options.roundVault = next;
    else if (flag === '--fee-vault') options.feeVault = next;
    else if (flag === '--cashier-keypair') options.cashierKeypair = next;
    else if (flag === '--lot-id') options.lotId = parsePositiveInteger(next, flag);
    else if (flag === '--side') options.side = next.toUpperCase();
    else if (flag === '--position-owner') options.positionOwner = next;
    else if (flag === '--usdc-in') options.usdcIn = parsePositiveInteger(next, flag);
    else if (flag === '--min-tickets-out') options.minTicketsOut = parsePositiveInteger(next, flag);
    else if (flag === '--env') options.env = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) validateOptions(options);
  return options;
}

export function buyFreshFromVaultData({
  lotId,
  side,
  positionOwner,
  usdcIn,
  minTicketsOut
}) {
  return concatBytes(
    anchorDiscriminator('buy_fresh_from_vault'),
    u64Bytes(lotId),
    new Uint8Array([side === 'UP' ? 0 : 1]),
    addressBytes(positionOwner),
    u64Bytes(usdcIn),
    u64Bytes(minTicketsOut)
  );
}

async function cashBuyDevnet(options) {
  const env = await loadEnvValues(options.env);
  const programId = options.programId ?? env.SOLANA_PROGRAM_ID;
  const usdcMint = options.usdcMint ?? env.SOLANA_CASH_MINT;
  const rpcUrl = options.rpcUrl ?? env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const wsUrl = options.wsUrl ?? env.SOLANA_WS_URL ?? DEFAULT_WS_URL;
  const cashier = await loadKeypairSigner(options.cashierKeypair);

  if (!programId || !isSolanaPubkey(programId)) throw new Error('Missing or invalid program id');
  if (!usdcMint || !isSolanaPubkey(usdcMint)) throw new Error('Missing or invalid BUSDC mint');
  if (env.SOLANA_DEPOSIT_VAULT_OWNER && env.SOLANA_DEPOSIT_VAULT_OWNER !== cashier.address) {
    throw new Error(`Cashier keypair address ${cashier.address} does not match SOLANA_DEPOSIT_VAULT_OWNER`);
  }

  const mint = address(usdcMint);
  const [derivedVault] = await findAssociatedTokenPda({
    owner: cashier.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const cashVault = address(options.cashVault ?? env.SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT ?? derivedVault);
  if (cashVault !== derivedVault) {
    throw new Error('Cash vault must be the ATA for the cashier and cash mint');
  }

  const global = address(options.global);
  const round = address(options.round);
  const positionLot = address(options.positionLot);
  const [derivedRoundVault] = await findAssociatedTokenPda({
    owner: round,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const [derivedFeeVault] = await findAssociatedTokenPda({
    owner: global,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const roundVault = address(options.roundVault);
  const feeVault = address(options.feeVault);
  if (roundVault !== derivedRoundVault) {
    throw new Error('Round vault must be the ATA for the round PDA and cash mint');
  }
  if (feeVault !== derivedFeeVault) {
    throw new Error('Fee vault must be the ATA for the global PDA and cash mint');
  }
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: cashier,
      ata: roundVault,
      owner: round,
      mint
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: cashier,
      ata: feeVault,
      owner: global,
      mint
    }),
    {
      programAddress: address(programId),
      accounts: [
        writable(global, false),
        writable(round, false),
        writable(positionLot, false),
        readonly(mint, false),
        writable(cashVault, false),
        writable(roundVault, false),
        writable(feeVault, false),
        writable(cashier.address, true),
        readonly(TOKEN_PROGRAM_ADDRESS, false),
        readonly(SYSTEM_PROGRAM_ADDRESS, false)
      ],
      data: buyFreshFromVaultData({
        lotId: options.lotId,
        side: options.side,
        positionOwner: options.positionOwner,
        usdcIn: options.usdcIn,
        minTicketsOut: options.minTicketsOut
      })
    }
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(cashier, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions(instructions, transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
  return {
    signature: getSignatureFromTransaction(signedTransaction),
    cashier: cashier.address,
    cashVault,
    positionLot,
    round,
    usdcMint
  };
}

async function loadEnvValues(envPath) {
  const resolved = resolveFilesystemPath(envPath);
  if (!fs.existsSync(resolved)) return {};
  return parseEnvText(await fs.promises.readFile(resolved, 'utf8'));
}

function parseEnvText(text) {
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

async function loadKeypairSigner(keypairPath) {
  const resolved = resolveFilesystemPath(keypairPath);
  const bytes = JSON.parse(await fs.promises.readFile(resolved, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`${resolved} must point to a 64-byte Solana keypair JSON file`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}

function validateOptions(options) {
  const pubkeyFields = [
    'programId',
    'global',
    'round',
    'positionLot',
    'roundVault',
    'feeVault',
    'positionOwner'
  ];
  for (const field of pubkeyFields) {
    if (!options[field] || !isSolanaPubkey(options[field])) {
      throw new Error(`--${kebab(field)} must be a valid Solana pubkey`);
    }
  }
  if (options.usdcMint && !isSolanaPubkey(options.usdcMint)) {
    throw new Error('--usdc-mint must be a valid Solana pubkey');
  }
  if (options.cashVault && !isSolanaPubkey(options.cashVault)) {
    throw new Error('--cash-vault must be a valid Solana pubkey');
  }
  if (options.side !== 'UP' && options.side !== 'DOWN') {
    throw new Error('--side must be UP or DOWN');
  }
}

function writable(pubkey, isSigner) {
  return {
    address: address(pubkey),
    role: isSigner ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE
  };
}

function readonly(pubkey, isSigner) {
  return {
    address: address(pubkey),
    role: isSigner ? AccountRole.READONLY_SIGNER : AccountRole.READONLY
  };
}

function anchorDiscriminator(name) {
  return new Uint8Array(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}

function addressBytes(value) {
  return ADDRESS_ENCODER.encode(address(value));
}

function u64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function concatBytes(...chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${flag} must be a positive integer`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 18_446_744_073_709_551_615n) {
    throw new Error(`${flag} must fit in u64`);
  }
  return parsed.toString();
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

export function formatScriptError(error) {
  const lines = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim() && !lines.includes(value.trim())) {
      lines.push(value.trim());
    }
  };
  push(error instanceof Error ? error.message : String(error));
  appendErrorLogs(error, push);
  if (error && typeof error === 'object' && 'cause' in error) {
    appendErrorLogs(error.cause, push);
    if (error.cause instanceof Error) push(`Cause: ${error.cause.message}`);
  }
  if (error instanceof Error && error.stack) push(error.stack);
  return lines.join('\n');
}

function appendErrorLogs(error, push) {
  if (!error || typeof error !== 'object') return;
  for (const key of ['logs', 'transactionLogs']) {
    const logs = error[key];
    if (Array.isArray(logs)) {
      for (const log of logs) push(`Simulation log: ${log}`);
    }
  }
  for (const key of ['context', 'details']) {
    appendErrorLogs(error[key], push);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/cash-buy-devnet.mjs --program-id <program> --global <global> --round <round> --position-lot <lot_pda> --round-vault <round_vault> --fee-vault <fee_vault> --lot-id <id> --side UP --position-owner <wallet> --usdc-in <base_units> --min-tickets-out <base_units>

Sends a devnet buy_fresh_from_vault transaction from the app cash vault. It uses only the devnet app vault keypair, never a user private key.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    cashBuyDevnet(options)
      .then((result) => {
        console.log('Devnet cash buy complete.');
        console.log(`Transaction: ${result.signature}`);
        console.log(`Round: ${result.round}`);
        console.log(`Position lot: ${result.positionLot}`);
        console.log(`Cash vault: ${result.cashVault}`);
      })
      .catch((error) => {
        console.error(formatScriptError(error));
        process.exitCode = 1;
      });
  }
}
