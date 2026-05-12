#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
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
  parseTokenAmountToBaseUnits,
  resolveFilesystemPath
} from './setup-devnet-cash.mjs';

export const DEFAULT_ENV_PATH = '../../.env';
export const DEFAULT_PAYER_KEYPAIR = '~/.config/solana/basingamarket-devnet-vault-owner.json';
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
export const DEFAULT_WS_URL = 'wss://api.devnet.solana.com';
export const DEFAULT_ASSET = 'BTC';
export const DEFAULT_MARKET_ID = 1;
export const DEFAULT_DURATION_SECONDS = 300;
export const DEFAULT_MIN_REMAINING_SECONDS = 60;
export const DEFAULT_OPENING_BATCH_SECONDS = 5;
export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
export const DEFAULTS = {
  buyFeeBps: 50,
  resaleFeeBps: 50,
  settlementFeeBps: 0,
  minSideRealUsdc: '10',
  virtualUsdc: '50000',
  virtualTicket: '100000',
  openingWalletSideCapUsdc: '500'
};

export const ASSET_CONFIG = {
  BTC: { variant: 0, symbol: 'BTCUSDT', marketIds: { 60: 11, 300: 1 } },
  ETH: { variant: 1, symbol: 'ETHUSDT', marketIds: { 60: 12, 300: 2 } },
  SOL: { variant: 2, symbol: 'SOLUSDT', marketIds: { 60: 13, 300: 3 } }
};

const ADDRESS_ENCODER = getAddressEncoder();

export function parseArgs(argv) {
  const options = {
    asset: DEFAULT_ASSET,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    env: DEFAULT_ENV_PATH,
    marketId: DEFAULT_MARKET_ID,
    minRemainingSeconds: DEFAULT_MIN_REMAINING_SECONDS,
    openingBatchSeconds: DEFAULT_OPENING_BATCH_SECONDS,
    payer: DEFAULT_PAYER_KEYPAIR,
    rpcUrl: DEFAULT_RPC_URL,
    wait: true,
    wsUrl: DEFAULT_WS_URL
  };
  let marketIdProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (flag === '--no-wait') {
      options.wait = false;
      continue;
    }
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--asset') options.asset = next.toUpperCase();
    else if (flag === '--duration') options.durationSeconds = parsePositiveInt(next, flag);
    else if (flag === '--env') options.env = next;
    else if (flag === '--market-id') {
      options.marketId = parsePositiveInt(next, flag);
      marketIdProvided = true;
    }
    else if (flag === '--min-remaining-seconds') options.minRemainingSeconds = parsePositiveInt(next, flag);
    else if (flag === '--opening-batch-seconds') options.openingBatchSeconds = parsePositiveInt(next, flag);
    else if (flag === '--payer') options.payer = next;
    else if (flag === '--program-id') options.programId = next;
    else if (flag === '--round-id') options.roundId = parsePositiveInt(next, flag);
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--now-ts') options.nowTs = parsePositiveInt(next, flag);
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.help) {
    if (!ASSET_CONFIG[options.asset]) throw new Error('bootstrap-devnet-round supports --asset BTC, ETH, or SOL');
    if (![60, 300].includes(options.durationSeconds)) throw new Error('bootstrap-devnet-round supports --duration 60 or 300');
    if (!marketIdProvided) options.marketId = defaultMarketId(options.asset, options.durationSeconds);
    if (options.programId && !isSolanaPubkey(options.programId)) throw new Error('--program-id must be a valid Solana pubkey');
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

export function selectRoundWindow({
  nowTs,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  minRemainingSeconds = DEFAULT_MIN_REMAINING_SECONDS,
  roundId = null
}) {
  if (roundId !== null && roundId !== undefined) {
    const startAt = Number(roundId) * durationSeconds;
    return {
      roundId: Number(roundId),
      startAt,
      endAt: startAt + durationSeconds,
      waitSeconds: Math.max(0, startAt - nowTs)
    };
  }

  const currentRoundId = Math.floor(nowTs / durationSeconds);
  const currentStartAt = currentRoundId * durationSeconds;
  const currentEndAt = currentStartAt + durationSeconds;
  if (currentEndAt - nowTs >= minRemainingSeconds) {
    return {
      roundId: currentRoundId,
      startAt: currentStartAt,
      endAt: currentEndAt,
      waitSeconds: 0
    };
  }

  return {
    roundId: currentRoundId + 1,
    startAt: currentEndAt,
    endAt: currentEndAt + durationSeconds,
    waitSeconds: currentEndAt - nowTs
  };
}

export async function deriveDevnetPdas(programId, marketId, roundId) {
  const programAddress = address(programId);
  const [global] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8Bytes('global')]
  });
  const [market] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8Bytes('market'), u64Bytes(marketId)]
  });
  const [round] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8Bytes('round'), addressBytes(market), u64Bytes(roundId)]
  });

  return {
    global,
    market,
    round
  };
}

export function anchorDiscriminator(name) {
  return new Uint8Array(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}

export function fixedBytes(value, length) {
  const bytes = utf8Bytes(value);
  if (bytes.length > length) throw new Error(`${value} is longer than ${length} bytes`);
  const output = new Uint8Array(length);
  output.set(bytes);
  return output;
}

export function parseDecimalToScaledAmount(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fractional = ''] = text.split('.');
  const output = BigInt(whole) * 1_000_000n;
  const trimmedFractional = fractional.slice(0, 6).padEnd(6, '0');
  return (output + BigInt(trimmedFractional || '0')).toString();
}

export function initializeGlobalConfigData({
  protocolTreasury,
  usdcMint,
  trustedSettlementActor,
  buyFeeBps,
  resaleFeeBps,
  settlementFeeBps,
  minSideRealUsdc
}) {
  return concatBytes(
    anchorDiscriminator('initialize_global_config'),
    addressBytes(protocolTreasury),
    addressBytes(usdcMint),
    addressBytes(trustedSettlementActor),
    u16Bytes(buyFeeBps),
    u16Bytes(resaleFeeBps),
    u16Bytes(settlementFeeBps),
    u64Bytes(minSideRealUsdc)
  );
}

export function createMarketConfigData({
  asset,
  marketId,
  durationSeconds,
  symbol,
  interval,
  virtualUsdc,
  virtualTicket,
  openingBatchSeconds,
  openingWalletSideCapUsdc
}) {
  return concatBytes(
    anchorDiscriminator('create_market_config'),
    u64Bytes(marketId),
    new Uint8Array([assetVariant(asset)]),
    u64Bytes(durationSeconds),
    fixedBytes(symbol, 16),
    fixedBytes(interval, 8),
    u64Bytes(virtualUsdc),
    u64Bytes(virtualTicket),
    u16Bytes(openingBatchSeconds),
    u64Bytes(openingWalletSideCapUsdc)
  );
}

export function openRoundData({
  roundId,
  startAt,
  batchUntil,
  endAt,
  startPrice,
  symbol,
  interval,
  binanceOpenTimeMs
}) {
  return concatBytes(
    anchorDiscriminator('open_round'),
    u64Bytes(roundId),
    i64Bytes(startAt),
    i64Bytes(batchUntil),
    i64Bytes(endAt),
    u64Bytes(startPrice),
    fixedBytes(symbol, 16),
    fixedBytes(interval, 8),
    i64Bytes(binanceOpenTimeMs)
  );
}

export function assertBinanceOpenTime(snapshot, startAt) {
  const expectedOpenTimeMs = startAt * 1000;
  if (snapshot.openTimeMs !== expectedOpenTimeMs) {
    throw new Error(`Binance kline open time mismatch: expected ${expectedOpenTimeMs}, got ${snapshot.openTimeMs}`);
  }
}

export async function bootstrapDevnetRound(options) {
  const envPath = resolveFilesystemPath(options.env);
  const env = fs.existsSync(envPath) ? parseEnvText(await fs.promises.readFile(envPath, 'utf8')) : {};
  const programId = options.programId ?? env.SOLANA_PROGRAM_ID ?? process.env.SOLANA_PROGRAM_ID;
  if (!programId || !isSolanaPubkey(programId)) {
    throw new Error('Missing or invalid SOLANA_PROGRAM_ID. Run npm run deploy:devnet-program first.');
  }
  const usdcMint = env.SOLANA_CASH_MINT ?? process.env.SOLANA_CASH_MINT;
  if (!usdcMint || !isSolanaPubkey(usdcMint)) {
    throw new Error('Missing or invalid SOLANA_CASH_MINT in env.');
  }

  const payer = await loadKeypairSigner(options.payer);
  const rpc = createSolanaRpc(options.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(options.wsUrl);
  await assertAccountExists(rpc, programId, `Program ${programId} is not deployed on devnet. Run npm run deploy:devnet-program first.`);

  const nowTs = options.nowTs ?? Math.floor(Date.now() / 1000);
  const roundWindow = selectRoundWindow({
    nowTs,
    durationSeconds: options.durationSeconds,
    minRemainingSeconds: options.minRemainingSeconds,
    roundId: options.roundId ?? null
  });
  if (roundWindow.waitSeconds > 0) {
    if (!options.wait) {
      throw new Error(`Selected next round starts in ${roundWindow.waitSeconds}s. Re-run without --no-wait or pass --round-id.`);
    }
    console.log(`Waiting ${roundWindow.waitSeconds}s for next ${options.asset} ${intervalForDuration(options.durationSeconds)} round boundary...`);
    await sleep(roundWindow.waitSeconds * 1000);
  }

  const freshNowTs = Math.floor(Date.now() / 1000);
  const windowAfterWait = options.roundId
    ? roundWindow
    : selectRoundWindow({
      nowTs: freshNowTs,
      durationSeconds: options.durationSeconds,
      minRemainingSeconds: 1,
      roundId: roundWindow.roundId
  });
  const batchUntil = windowAfterWait.startAt + options.openingBatchSeconds;
  const pdas = await deriveDevnetPdas(programId, options.marketId, windowAfterWait.roundId);
  const symbol = symbolForAsset(options.asset);
  const interval = intervalForDuration(options.durationSeconds);
  const snapshot = await fetchBinanceOpenSnapshot({
    startAt: windowAfterWait.startAt,
    symbol,
    interval
  });
  assertBinanceOpenTime(snapshot, windowAfterWait.startAt);

  const sent = [];
  if (!(await accountExists(rpc, pdas.global))) {
    sent.push(['initialize_global_config', await sendInstructions({
      instructions: [initializeGlobalConfigInstruction({
        admin: payer.address,
        global: pdas.global,
        programId,
        usdcMint
      })],
      payer,
      rpc,
      rpcSubscriptions
    })]);
  }

  if (!(await accountExists(rpc, pdas.market))) {
    sent.push(['create_market_config', await sendInstructions({
      instructions: [createMarketConfigInstruction({
        admin: payer.address,
        global: pdas.global,
        market: pdas.market,
        marketId: options.marketId,
        asset: options.asset,
        durationSeconds: options.durationSeconds,
        symbol,
        interval,
        programId,
        openingBatchSeconds: options.openingBatchSeconds
      })],
      payer,
      rpc,
      rpcSubscriptions
    })]);
  }

  if (!(await accountExists(rpc, pdas.round))) {
    sent.push(['open_round', await sendInstructions({
      instructions: [openRoundInstruction({
        authority: payer.address,
        global: pdas.global,
        market: pdas.market,
        programId,
        round: pdas.round,
        roundId: windowAfterWait.roundId,
        startAt: windowAfterWait.startAt,
        batchUntil,
        endAt: windowAfterWait.endAt,
        startPrice: snapshot.openPrice,
        symbol,
        interval,
        binanceOpenTimeMs: snapshot.openTimeMs
      })],
      payer,
      rpc,
      rpcSubscriptions
    })]);
  }

  if (options.wait) {
    const secondsUntilBatchEnd = batchUntil - Math.floor(Date.now() / 1000) + 1;
    if (secondsUntilBatchEnd > 0) {
      console.log(`Waiting ${secondsUntilBatchEnd}s for opening batch to finish...`);
      await sleep(secondsUntilBatchEnd * 1000);
    }
  }

  await assertAccountExists(rpc, pdas.round, `Round account ${pdas.round} was not created.`);
  return {
    batchUntil,
    endAt: windowAfterWait.endAt,
    marketId: options.marketId,
    pdas,
    programId,
    roundId: windowAfterWait.roundId,
    sent,
    startAt: windowAfterWait.startAt,
    startPrice: snapshot.openPrice,
    symbol,
    interval
  };
}

function initializeGlobalConfigInstruction({ admin, global, programId, usdcMint }) {
  return {
    programAddress: address(programId),
    accounts: [
      writable(global, false),
      writable(admin, true),
      readonly(SYSTEM_PROGRAM_ADDRESS, false)
    ],
    data: initializeGlobalConfigData({
      protocolTreasury: admin,
      usdcMint,
      trustedSettlementActor: admin,
      buyFeeBps: DEFAULTS.buyFeeBps,
      resaleFeeBps: DEFAULTS.resaleFeeBps,
      settlementFeeBps: DEFAULTS.settlementFeeBps,
      minSideRealUsdc: parseTokenAmountToBaseUnits(DEFAULTS.minSideRealUsdc)
    })
  };
}

function createMarketConfigInstruction({
  admin,
  global,
  market,
  marketId,
  asset,
  durationSeconds,
  symbol,
  interval,
  openingBatchSeconds,
  programId
}) {
  return {
    programAddress: address(programId),
    accounts: [
      writable(global, false),
      writable(market, false),
      writable(admin, true),
      readonly(SYSTEM_PROGRAM_ADDRESS, false)
    ],
    data: createMarketConfigData({
      asset,
      marketId,
      durationSeconds,
      symbol,
      interval,
      virtualUsdc: parseTokenAmountToBaseUnits(DEFAULTS.virtualUsdc),
      virtualTicket: parseTokenAmountToBaseUnits(DEFAULTS.virtualTicket),
      openingBatchSeconds,
      openingWalletSideCapUsdc: parseTokenAmountToBaseUnits(DEFAULTS.openingWalletSideCapUsdc)
    })
  };
}

function openRoundInstruction({
  authority,
  global,
  market,
  programId,
  round,
  roundId,
  startAt,
  batchUntil,
  endAt,
  startPrice,
  symbol,
  interval,
  binanceOpenTimeMs
}) {
  return {
    programAddress: address(programId),
    accounts: [
      readonly(global, false),
      readonly(market, false),
      writable(round, false),
      writable(authority, true),
      readonly(SYSTEM_PROGRAM_ADDRESS, false)
    ],
    data: openRoundData({
      roundId,
      startAt,
      batchUntil,
      endAt,
      startPrice,
      symbol,
      interval,
      binanceOpenTimeMs
    })
  };
}

async function fetchBinanceOpenSnapshot({ symbol, interval, startAt }) {
  const startTime = startAt * 1000;
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Binance API ${response.status} while fetching ${symbol} ${interval}`);
  const payload = await response.json();
  const [kline] = Array.isArray(payload) ? payload : [];
  if (!Array.isArray(kline)) throw new Error('Binance kline response was empty');
  return {
    openPrice: parseDecimalToScaledAmount(kline[1]),
    openTimeMs: Number(kline[0])
  };
}

async function sendInstructions({ instructions, payer, rpc, rpcSubscriptions }) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(payer, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions(instructions, transactionMessage)
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  try {
    await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
  } catch (error) {
    console.error('Transaction failed:', error);
    if (error && typeof error === 'object' && 'context' in error) {
      console.error('Error context:', JSON.stringify((error).context, null, 2));
    }
    throw error;
  }
  return getSignatureFromTransaction(signedTransaction);
}

async function accountExists(rpc, pubkey) {
  const { value } = await rpc.getAccountInfo(address(pubkey), { encoding: 'base64', commitment: 'confirmed' }).send();
  return Boolean(value);
}

async function assertAccountExists(rpc, pubkey, message) {
  if (!(await accountExists(rpc, pubkey))) throw new Error(message);
}

async function loadKeypairSigner(keypairPath) {
  const resolved = resolveFilesystemPath(keypairPath);
  const bytes = JSON.parse(await fs.promises.readFile(resolved, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`${resolved} must point to a 64-byte Solana keypair JSON file`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
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

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function defaultMarketId(asset, durationSeconds) {
  const marketId = ASSET_CONFIG[asset]?.marketIds?.[durationSeconds];
  if (!marketId) throw new Error(`No default market id for ${asset} ${durationSeconds}s`);
  return marketId;
}

export function symbolForAsset(asset) {
  const symbol = ASSET_CONFIG[asset]?.symbol;
  if (!symbol) throw new Error(`Unsupported asset: ${asset}`);
  return symbol;
}

export function assetVariant(asset) {
  const variant = ASSET_CONFIG[asset]?.variant;
  if (variant === undefined) throw new Error(`Unsupported asset: ${asset}`);
  return variant;
}

export function intervalForDuration(durationSeconds) {
  if (durationSeconds === 60) return '1m';
  if (durationSeconds === 300) return '5m';
  throw new Error(`Unsupported duration: ${durationSeconds}`);
}

function addressBytes(value) {
  return ADDRESS_ENCODER.encode(address(value));
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function u16Bytes(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, Number(value), true);
  return bytes;
}

function u64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function i64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function explorerUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function printHelp() {
  console.log(`Usage:
  npm run bootstrap:devnet-round
  npm run bootstrap:devnet-round -- --round-id <id>
  npm run bootstrap:devnet-round -- --asset ETH --duration 60
  npm run bootstrap:devnet-round -- --program-id <program> --payer <keypair.json>

Initializes devnet BTC/ETH/SOL 1m or 5m global config, market config, and live round accounts for trade intent testing.`);
}

function printResult(result) {
  console.log('Devnet round bootstrap complete.');
  console.log(`program_id=${result.programId}`);
  console.log(`market_id=${result.marketId}`);
  console.log(`symbol=${result.symbol}`);
  console.log(`interval=${result.interval}`);
  console.log(`round_id=${result.roundId}`);
  console.log(`start_at=${result.startAt}`);
  console.log(`batch_until=${result.batchUntil}`);
  console.log(`end_at=${result.endAt}`);
  console.log(`start_price=${result.startPrice}`);
  console.log(`global=${result.pdas.global}`);
  console.log(`market=${result.pdas.market}`);
  console.log(`round=${result.pdas.round}`);
  console.log(`opening_aggregate_up=${result.pdas.openingAggregateUp}`);
  console.log(`opening_aggregate_down=${result.pdas.openingAggregateDown}`);
  for (const [label, signature] of result.sent) {
    console.log(`${label}_tx=${signature}`);
    console.log(`${label}_explorer=${explorerUrl(signature)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    bootstrapDevnetRound(options)
      .then(printResult)
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
