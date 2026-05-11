#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
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
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import {
  isSolanaPubkey,
  parseTokenAmountToBaseUnits,
  resolveFilesystemPath
} from './setup-devnet-cash.mjs';

const DEFAULT_ENV_PATH = '../../.env';
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';
const DEFAULT_VAULT_OWNER_KEYPAIR = '~/.config/solana/basingamarket-devnet-vault-owner.json';
const CASH_DECIMALS = 6;

export function parseArgs(argv) {
  const options = {
    env: DEFAULT_ENV_PATH,
    rpcUrl: null,
    wsUrl: null,
    vaultOwnerKeypair: DEFAULT_VAULT_OWNER_KEYPAIR
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

    if (flag === '--amount') options.amount = next;
    else if (flag === '--destination') options.destination = next;
    else if (flag === '--cash-mint') options.cashMint = next;
    else if (flag === '--vault-token-account') options.vaultTokenAccount = next;
    else if (flag === '--vault-owner-keypair') options.vaultOwnerKeypair = next;
    else if (flag === '--env') options.env = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) {
    if (!options.destination) throw new Error('Missing --destination <wallet_pubkey>');
    if (!options.amount) throw new Error('Missing --amount <BUSDC>');
    if (!isSolanaPubkey(options.destination)) throw new Error('--destination must be a valid 32-byte Solana pubkey');
    if (options.cashMint && !isSolanaPubkey(options.cashMint)) throw new Error('--cash-mint must be a valid 32-byte Solana pubkey');
    if (options.vaultTokenAccount && !isSolanaPubkey(options.vaultTokenAccount)) {
      throw new Error('--vault-token-account must be a valid 32-byte Solana pubkey');
    }
    parseTokenAmountToBaseUnits(options.amount);
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

export async function loadEnvValues(envPath) {
  const resolved = resolveFilesystemPath(envPath);
  if (!fs.existsSync(resolved)) return {};
  return parseEnvText(await fs.promises.readFile(resolved, 'utf8'));
}

async function withdrawDevnetCash(options) {
  const env = await loadEnvValues(options.env);
  const cashMint = options.cashMint ?? env.SOLANA_CASH_MINT;
  if (!cashMint) throw new Error('Missing SOLANA_CASH_MINT in env or --cash-mint');
  if (!isSolanaPubkey(cashMint)) throw new Error('SOLANA_CASH_MINT must be a valid 32-byte Solana pubkey');

  const rpcUrl = options.rpcUrl ?? env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const wsUrl = options.wsUrl ?? env.SOLANA_WS_URL ?? DEFAULT_WS_URL;
  const amount = parseTokenAmountToBaseUnits(options.amount);
  const mint = address(cashMint);
  const destination = address(options.destination);
  const vaultOwner = await loadKeypairSigner(options.vaultOwnerKeypair);

  if (env.SOLANA_DEPOSIT_VAULT_OWNER && env.SOLANA_DEPOSIT_VAULT_OWNER !== vaultOwner.address) {
    throw new Error(`Vault owner keypair address ${vaultOwner.address} does not match SOLANA_DEPOSIT_VAULT_OWNER`);
  }

  const [derivedVaultTokenAccount] = await findAssociatedTokenPda({
    owner: vaultOwner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const vaultTokenAccount = address(options.vaultTokenAccount ?? env.SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT ?? derivedVaultTokenAccount);
  if (vaultTokenAccount !== derivedVaultTokenAccount) {
    throw new Error('Vault token account must be the ATA for the vault owner and cash mint');
  }

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    owner: destination,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: vaultOwner,
      ata: destinationTokenAccount,
      owner: destination,
      mint
    }),
    getTransferCheckedInstruction({
      source: vaultTokenAccount,
      mint,
      destination: destinationTokenAccount,
      authority: vaultOwner,
      amount,
      decimals: CASH_DECIMALS
    })
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(vaultOwner, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions(instructions, transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });

  return {
    amount: amount.toString(),
    destination,
    destinationTokenAccount,
    mint,
    signature: getSignatureFromTransaction(signedTransaction),
    vaultOwner: vaultOwner.address,
    vaultTokenAccount
  };
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

function printHelp() {
  console.log(`Usage:
  npm run withdraw:devnet-cash -- --destination <wallet_pubkey> --amount <BUSDC>
  npm run withdraw:devnet-cash -- --destination <wallet_pubkey> --amount <BUSDC> --vault-owner-keypair ${DEFAULT_VAULT_OWNER_KEYPAIR}

Transfers devnet BUSDC tokens out of the app vault. This uses only the devnet app vault keypair, never a user private key.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await withdrawDevnetCash(options);
  console.log('Devnet BUSDC withdraw complete.');
  console.log(`Transaction: ${result.signature}`);
  console.log(`Mint: ${result.mint}`);
  console.log(`Vault token account: ${result.vaultTokenAccount}`);
  console.log(`Destination token account: ${result.destinationTokenAccount}`);
  console.log(`Withdrawn base units: ${result.amount}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
