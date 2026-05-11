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
  getBase58Decoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners
} from '@solana/kit';
import {
  isSolanaPubkey,
  resolveFilesystemPath
} from './setup-devnet-cash.mjs';
import { parseEnvText } from './reserve-devnet-cash.mjs';

export const DEFAULT_ENV_PATH = '../../.env';
export const DEFAULT_ADMIN_KEYPAIR = '~/.config/solana/basingamarket-devnet-vault-owner.json';
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
export const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';

const ADDRESS_ENCODER = getAddressEncoder();
const BASE58_DECODER = getBase58Decoder();

export function parseArgs(argv) {
  const options = {
    adminKeypair: DEFAULT_ADMIN_KEYPAIR,
    env: DEFAULT_ENV_PATH,
    rpcUrl: null,
    wsUrl: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);

    if (flag === '--admin-keypair') options.adminKeypair = next;
    else if (flag === '--cash-mint') options.cashMint = next;
    else if (flag === '--env') options.env = next;
    else if (flag === '--global') options.global = next;
    else if (flag === '--program-id') options.programId = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) {
    for (const [key, flag] of [
      ['cashMint', '--cash-mint'],
      ['global', '--global'],
      ['programId', '--program-id']
    ]) {
      if (options[key] && !isSolanaPubkey(options[key])) {
        throw new Error(`${flag} must be a valid Solana pubkey`);
      }
    }
  }

  return options;
}

export function setCashMintData({ usdcMint }) {
  return concatBytes(
    anchorDiscriminator('set_cash_mint'),
    addressBytes(usdcMint)
  );
}

export function decodeGlobalConfigAccount(encodedData) {
  const data = Buffer.isBuffer(encodedData)
    ? encodedData
    : Buffer.from(encodedData, 'base64');
  if (data.length < 160) throw new Error('Global config account is too short');
  return {
    admin: BASE58_DECODER.decode(data.subarray(8, 40)),
    usdcMint: BASE58_DECODER.decode(data.subarray(72, 104))
  };
}

export async function deriveGlobalPda(programId) {
  const [global] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [new TextEncoder().encode('global')]
  });
  return global;
}

export async function setDevnetCashMint(options) {
  const envPath = resolveFilesystemPath(options.env);
  const env = fs.existsSync(envPath) ? parseEnvText(await fs.promises.readFile(envPath, 'utf8')) : {};
  const programId = options.programId ?? env.SOLANA_PROGRAM_ID ?? process.env.SOLANA_PROGRAM_ID;
  const cashMint = options.cashMint ?? env.SOLANA_CASH_MINT ?? process.env.SOLANA_CASH_MINT;
  const rpcUrl = options.rpcUrl ?? env.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const wsUrl = options.wsUrl ?? env.SOLANA_WS_URL ?? process.env.SOLANA_WS_URL ?? DEFAULT_WS_URL;
  if (!programId || !isSolanaPubkey(programId)) throw new Error('Missing or invalid SOLANA_PROGRAM_ID');
  if (!cashMint || !isSolanaPubkey(cashMint)) throw new Error('Missing or invalid SOLANA_CASH_MINT');

  const admin = await loadKeypairSigner(options.adminKeypair);
  const global = options.global ?? await deriveGlobalPda(programId);
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const globalState = await fetchGlobalConfig(rpc, global);
  if (globalState.admin !== admin.address) {
    throw new Error(`Global admin ${globalState.admin} does not match admin keypair ${admin.address}`);
  }
  if (globalState.usdcMint === cashMint) {
    return {
      cashMint,
      currentCashMint: globalState.usdcMint,
      global,
      mode: 'unchanged',
      programId,
      signature: null
    };
  }

  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(admin, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions([
      setCashMintInstruction({
        admin: admin.address,
        cashMint,
        global,
        programId
      })
    ], transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });

  return {
    cashMint,
    currentCashMint: globalState.usdcMint,
    global,
    mode: 'updated',
    programId,
    signature: getSignatureFromTransaction(signedTransaction)
  };
}

function setCashMintInstruction({ admin, cashMint, global, programId }) {
  return {
    programAddress: address(programId),
    accounts: [
      writable(global, false),
      readonly(admin, true)
    ],
    data: setCashMintData({ usdcMint: cashMint })
  };
}

async function fetchGlobalConfig(rpc, global) {
  const { value } = await rpc.getAccountInfo(address(global), { encoding: 'base64', commitment: 'confirmed' }).send();
  if (!value) throw new Error(`Global config ${global} was not found`);
  const encoded = Array.isArray(value.data) ? value.data[0] : null;
  if (!encoded) throw new Error(`Global config ${global} has no base64 data`);
  return decodeGlobalConfigAccount(encoded);
}

async function loadKeypairSigner(keypairPath) {
  const resolved = resolveFilesystemPath(keypairPath);
  const bytes = JSON.parse(await fs.promises.readFile(resolved, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`${resolved} must point to a 64-byte Solana keypair JSON file`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}

function anchorDiscriminator(name) {
  return new Uint8Array(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}

function addressBytes(value) {
  return ADDRESS_ENCODER.encode(address(value));
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

function explorerUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function printHelp() {
  console.log(`Usage:
  npm run set:devnet-cash-mint
  npm run set:devnet-cash-mint -- --cash-mint <busdc_mint> --program-id <program> --admin-keypair <keypair.json>

Updates the devnet program global config to use the configured BasingaUSDC (BUSDC) mint.`);
}

function printResult(result) {
  if (result.mode === 'unchanged') {
    console.log('Devnet program cash mint already matches BUSDC env.');
  } else {
    console.log('Devnet program cash mint updated.');
    console.log(`transaction=${result.signature}`);
    console.log(`explorer=${explorerUrl(result.signature)}`);
  }
  console.log(`program_id=${result.programId}`);
  console.log(`global=${result.global}`);
  console.log(`previous_cash_mint=${result.currentCashMint}`);
  console.log(`cash_mint=${result.cashMint}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    setDevnetCashMint(options)
      .then(printResult)
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
