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
import { isSolanaPubkey, resolveFilesystemPath } from './setup-devnet-cash.mjs';

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

    if (flag === '--mode') options.mode = next;
    else if (flag === '--program-id') options.programId = next;
    else if (flag === '--global') options.global = next;
    else if (flag === '--round') options.round = next;
    else if (flag === '--position-lot') options.positionLot = next;
    else if (flag === '--seller-lot') options.sellerLot = next;
    else if (flag === '--buyer-lot') options.buyerLot = next;
    else if (flag === '--usdc-mint') options.usdcMint = next;
    else if (flag === '--cash-vault') options.cashVault = next;
    else if (flag === '--round-vault') options.roundVault = next;
    else if (flag === '--fee-vault') options.feeVault = next;
    else if (flag === '--cashier-keypair') options.cashierKeypair = next;
    else if (flag === '--seller-wallet') options.sellerWallet = next;
    else if (flag === '--buyer-wallet') options.buyerWallet = next;
    else if (flag === '--price-per-ticket') options.pricePerTicket = parsePositiveInteger(next, flag);
    else if (flag === '--max-price-per-ticket') options.maxPricePerTicket = parsePositiveInteger(next, flag);
    else if (flag === '--buyer-lot-id') options.buyerLotId = parseU64(next, flag);
    else if (flag === '--tickets-to-sell') options.ticketsToSell = parsePositiveInteger(next, flag);
    else if (flag === '--gross-usdc') options.grossUsdc = parsePositiveInteger(next, flag);
    else if (flag === '--env') options.env = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) validateOptions(options);
  return options;
}

export function listTicketFromCashierData({ sellerWallet, pricePerTicket }) {
  return concatBytes(
    anchorDiscriminator('list_ticket_from_cashier'),
    addressBytes(sellerWallet),
    u64Bytes(pricePerTicket)
  );
}

export function cancelListingFromCashierData({ sellerWallet }) {
  return concatBytes(
    anchorDiscriminator('cancel_listing_from_cashier'),
    addressBytes(sellerWallet)
  );
}

export function buyListingFromVaultData({ buyerWallet, maxPricePerTicket }) {
  return concatBytes(
    anchorDiscriminator('buy_listing_from_vault'),
    addressBytes(buyerWallet),
    u64Bytes(maxPricePerTicket)
  );
}

export function sellLotIntoBidFromVaultData({
  sellerWallet,
  buyerWallet,
  buyerLotId,
  ticketsToSell,
  grossUsdc
}) {
  return concatBytes(
    anchorDiscriminator('sell_lot_into_bid_from_vault'),
    addressBytes(sellerWallet),
    addressBytes(buyerWallet),
    u64Bytes(buyerLotId),
    u64Bytes(ticketsToSell),
    u64Bytes(grossUsdc)
  );
}

async function secondaryResaleDevnet(options) {
  const env = await loadEnvValues(options.env);
  const programId = options.programId ?? env.SOLANA_PROGRAM_ID;
  const usdcMint = options.usdcMint ?? env.SOLANA_CASH_MINT;
  const rpcUrl = options.rpcUrl ?? env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const wsUrl = options.wsUrl ?? env.SOLANA_WS_URL ?? DEFAULT_WS_URL;
  const cashier = await loadKeypairSigner(options.cashierKeypair);

  if (!programId || !isSolanaPubkey(programId)) throw new Error('Missing or invalid program id');
  if (env.SOLANA_DEPOSIT_VAULT_OWNER && env.SOLANA_DEPOSIT_VAULT_OWNER !== cashier.address) {
    throw new Error(`Cashier keypair address ${cashier.address} does not match SOLANA_DEPOSIT_VAULT_OWNER`);
  }

  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const instructions = [];
  const global = address(options.global);
  const round = address(options.round);
  const programAddress = address(programId);
  const mint = usdcMint ? address(usdcMint) : null;

  if (requiresVaultAccounts(options.mode)) {
    if (!mint) throw new Error('Missing or invalid BUSDC mint');
    const [derivedVault] = await findAssociatedTokenPda({
      owner: cashier.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint
    });
    const cashVault = address(options.cashVault ?? env.SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT ?? derivedVault);
    if (cashVault !== derivedVault) {
      throw new Error('Cash vault must be the ATA for the cashier and cash mint');
    }
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
    if (roundVault !== derivedRoundVault) throw new Error('Round vault must be the ATA for the round PDA and cash mint');
    if (feeVault !== derivedFeeVault) throw new Error('Fee vault must be the ATA for the global PDA and cash mint');

    instructions.push(
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
      })
    );

    if (options.mode === 'buy-listing') {
      instructions.push({
        programAddress,
        accounts: [
          writable(global, false),
          writable(round, false),
          writable(options.positionLot, false),
          readonly(mint, false),
          writable(cashVault, false),
          writable(roundVault, false),
          writable(feeVault, false),
          writable(cashier.address, true),
          readonly(TOKEN_PROGRAM_ADDRESS, false)
        ],
        data: buyListingFromVaultData({
          buyerWallet: options.buyerWallet,
          maxPricePerTicket: options.maxPricePerTicket
        })
      });
    } else if (options.mode === 'instant-sell') {
      instructions.push({
        programAddress,
        accounts: [
          writable(global, false),
          writable(round, false),
          writable(options.sellerLot, false),
          writable(options.buyerLot, false),
          readonly(mint, false),
          writable(cashVault, false),
          writable(roundVault, false),
          writable(feeVault, false),
          writable(cashier.address, true),
          readonly(TOKEN_PROGRAM_ADDRESS, false),
          readonly(SYSTEM_PROGRAM_ADDRESS, false)
        ],
        data: sellLotIntoBidFromVaultData({
          sellerWallet: options.sellerWallet,
          buyerWallet: options.buyerWallet,
          buyerLotId: options.buyerLotId,
          ticketsToSell: options.ticketsToSell,
          grossUsdc: options.grossUsdc
        })
      });
    }
  } else if (options.mode === 'list') {
    instructions.push({
      programAddress,
      accounts: [
        readonly(global, false),
        readonly(round, false),
        writable(options.positionLot, false),
        readonly(cashier.address, true)
      ],
      data: listTicketFromCashierData({
        sellerWallet: options.sellerWallet,
        pricePerTicket: options.pricePerTicket
      })
    });
  } else if (options.mode === 'cancel') {
    instructions.push({
      programAddress,
      accounts: [
        readonly(global, false),
        readonly(round, false),
        writable(options.positionLot, false),
        readonly(cashier.address, true)
      ],
      data: cancelListingFromCashierData({
        sellerWallet: options.sellerWallet
      })
    });
  }

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
    round,
    positionLot: options.positionLot ?? options.sellerLot,
    buyerLot: options.buyerLot ?? null
  };
}

function requiresVaultAccounts(mode) {
  return mode === 'buy-listing' || mode === 'instant-sell';
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
  if (!['list', 'cancel', 'buy-listing', 'instant-sell'].includes(options.mode)) {
    throw new Error('--mode must be list, cancel, buy-listing, or instant-sell');
  }
  for (const field of ['programId', 'global', 'round']) {
    if (!options[field] || !isSolanaPubkey(options[field])) {
      throw new Error(`--${kebab(field)} must be a valid Solana pubkey`);
    }
  }
  const positionField = options.mode === 'instant-sell' ? 'sellerLot' : 'positionLot';
  if (!options[positionField] || !isSolanaPubkey(options[positionField])) {
    throw new Error(`--${kebab(positionField)} must be a valid Solana pubkey`);
  }
  if ((options.mode === 'list' || options.mode === 'cancel' || options.mode === 'instant-sell') && !isSolanaPubkey(options.sellerWallet)) {
    throw new Error('--seller-wallet must be a valid Solana pubkey');
  }
  if ((options.mode === 'buy-listing' || options.mode === 'instant-sell') && !isSolanaPubkey(options.buyerWallet)) {
    throw new Error('--buyer-wallet must be a valid Solana pubkey');
  }
  if (requiresVaultAccounts(options.mode)) {
    for (const field of ['cashVault', 'roundVault', 'feeVault']) {
      if (options[field] && !isSolanaPubkey(options[field])) throw new Error(`--${kebab(field)} must be a valid Solana pubkey`);
    }
    if (options.usdcMint && !isSolanaPubkey(options.usdcMint)) throw new Error('--usdc-mint must be a valid Solana pubkey');
  }
  if (options.mode === 'list' && !options.pricePerTicket) throw new Error('--price-per-ticket is required');
  if (options.mode === 'buy-listing' && !options.maxPricePerTicket) throw new Error('--max-price-per-ticket is required');
  if (options.mode === 'instant-sell') {
    if (!options.buyerLot || !isSolanaPubkey(options.buyerLot)) throw new Error('--buyer-lot must be a valid Solana pubkey');
    if (options.buyerLotId === undefined) throw new Error('--buyer-lot-id is required');
    if (!options.ticketsToSell) throw new Error('--tickets-to-sell is required');
    if (!options.grossUsdc) throw new Error('--gross-usdc is required');
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
  const parsed = parseU64(value, flag);
  if (BigInt(parsed) <= 0n) throw new Error(`${flag} must be greater than zero`);
  return parsed;
}

function parseU64(value, flag) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${flag} must be an integer`);
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 18_446_744_073_709_551_615n) {
    throw new Error(`${flag} must fit in u64`);
  }
  return parsed.toString();
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/secondary-resale-devnet.mjs --mode list --program-id <program> --global <global> --round <round> --position-lot <lot> --seller-wallet <wallet> --price-per-ticket <base_units>
  node scripts/secondary-resale-devnet.mjs --mode buy-listing --program-id <program> --global <global> --round <round> --position-lot <lot> --buyer-wallet <wallet> --max-price-per-ticket <base_units>
  node scripts/secondary-resale-devnet.mjs --mode instant-sell --program-id <program> --global <global> --round <round> --seller-lot <lot> --buyer-lot <lot> --seller-wallet <wallet> --buyer-wallet <wallet> --buyer-lot-id <id> --tickets-to-sell <base_units> --gross-usdc <base_units>

Sends trusted-cashier secondary resale instructions from the app cash vault. It never asks for a user wallet signature.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    secondaryResaleDevnet(options)
      .then((result) => {
        console.log('Devnet secondary resale complete.');
        console.log(`Transaction: ${result.signature}`);
        console.log(`Round: ${result.round}`);
        console.log(`Position lot: ${result.positionLot}`);
        if (result.buyerLot) console.log(`Buyer lot: ${result.buyerLot}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
