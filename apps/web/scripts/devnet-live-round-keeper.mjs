#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  bootstrapDevnetRound,
  DEFAULT_ENV_PATH,
  DEFAULT_OPENING_BATCH_SECONDS,
  DEFAULT_PAYER_KEYPAIR,
  DEFAULT_RPC_URL,
  DEFAULT_WS_URL,
  defaultMarketId,
  intervalForDuration
} from './bootstrap-devnet-round.mjs';

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';
export const DEFAULT_WATCH_INTERVAL_MS = 2_000;
export const DEFAULT_LOOKAHEAD_SECONDS = 15;
export const SUPPORTED_DURATIONS = new Set([60, 300]);
export const SUPPORTED_ASSETS = new Set(['BTC', 'ETH', 'SOL']);

export function parseKeeperArgs(argv, env = process.env) {
  const options = {
    apiBaseUrl: normalizeBaseUrl(env.API_INTERNAL_BASE_URL || DEFAULT_API_BASE_URL),
    env: DEFAULT_ENV_PATH,
    intervalMs: DEFAULT_WATCH_INTERVAL_MS,
    lookaheadSeconds: DEFAULT_LOOKAHEAD_SECONDS,
    mode: 'once',
    openingBatchSeconds: DEFAULT_OPENING_BATCH_SECONDS,
    payer: DEFAULT_PAYER_KEYPAIR,
    rpcUrl: DEFAULT_RPC_URL,
    wait: true,
    wsUrl: DEFAULT_WS_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { ...options, help: true };
    if (flag === '--once') {
      options.mode = 'once';
      continue;
    }
    if (flag === '--watch') {
      options.mode = 'watch';
      continue;
    }
    if (flag === '--no-wait') {
      options.wait = false;
      continue;
    }
    if (!flag?.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--api-base-url') options.apiBaseUrl = normalizeBaseUrl(next);
    else if (flag === '--env') options.env = next;
    else if (flag === '--interval-ms') options.intervalMs = parsePositiveInt(next, flag);
    else if (flag === '--lookahead-seconds') options.lookaheadSeconds = parsePositiveInt(next, flag);
    else if (flag === '--opening-batch-seconds') options.openingBatchSeconds = parsePositiveInt(next, flag);
    else if (flag === '--payer') options.payer = next;
    else if (flag === '--program-id') options.programId = next;
    else if (flag === '--rpc-url') options.rpcUrl = next;
    else if (flag === '--ws-url') options.wsUrl = next;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }

  return options;
}

export function normalizeBaseUrl(value = DEFAULT_API_BASE_URL) {
  return String(value || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

export function marketsUrlForApiBaseUrl(apiBaseUrl = DEFAULT_API_BASE_URL) {
  return new URL('/markets', normalizeBaseUrl(apiBaseUrl)).toString();
}

export async function fetchMarkets({ apiBaseUrl = DEFAULT_API_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(marketsUrlForApiBaseUrl(apiBaseUrl), {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`API ${response.status} while fetching live markets`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('/markets did not return an array');
  return payload;
}

export function buildLiveRoundBootstrapTasks(
  markets,
  { lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS, nowTs = Math.floor(Date.now() / 1000) } = {}
) {
  const tasks = [];
  const seen = new Set();
  const addTask = ({ asset, durationSeconds, endAt, lookahead, marketId, roundId, startAt }) => {
    const key = taskKey({ marketId, roundId });
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({
      asset,
      durationSeconds,
      endAt,
      interval: intervalForDuration(durationSeconds),
      lookahead,
      marketId,
      roundId,
      startAt
    });
  };

  for (const market of markets) {
    const header = market?.price_header;
    const asset = String(header?.asset ?? '').toUpperCase();
    const durationSeconds = Number(header?.duration_seconds);
    const marketId = Number(market?.market_id);
    const roundId = Number(header?.round_id);
    if (!SUPPORTED_ASSETS.has(asset) || !SUPPORTED_DURATIONS.has(durationSeconds)) continue;
    if (!Number.isSafeInteger(marketId) || !Number.isSafeInteger(roundId) || roundId <= 0) continue;
    if (marketId !== defaultMarketId(asset, durationSeconds)) continue;
    const startAt = Number(header?.start_at);
    const endAt = Number(header?.end_at);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) continue;
    addTask({
      asset,
      durationSeconds,
      endAt,
      lookahead: false,
      marketId,
      roundId,
      startAt
    });

    if (endAt - nowTs <= lookaheadSeconds) {
      addTask({
        asset,
        durationSeconds,
        endAt: endAt + durationSeconds,
        lookahead: true,
        marketId,
        roundId: roundId + 1,
        startAt: endAt
      });
    }
  }
  return tasks.sort((left, right) =>
    Number(left.lookahead) - Number(right.lookahead)
    || left.marketId - right.marketId
    || left.roundId - right.roundId
  );
}

export async function fetchLiveRoundBootstrapTasks({ apiBaseUrl, fetchImpl, lookaheadSeconds } = {}) {
  return buildLiveRoundBootstrapTasks(await fetchMarkets({ apiBaseUrl, fetchImpl }), { lookaheadSeconds });
}

export async function bootstrapLiveRoundTask(task, options, deps = {}) {
  const bootstrap = deps.bootstrapDevnetRound ?? bootstrapDevnetRound;
  return bootstrap({
    asset: task.asset,
    durationSeconds: task.durationSeconds,
    env: options.env,
    marketId: task.marketId,
    openingBatchSeconds: options.openingBatchSeconds,
    payer: options.payer,
    programId: options.programId,
    roundId: task.roundId,
    rpcUrl: options.rpcUrl,
    wait: options.wait,
    wsUrl: options.wsUrl
  });
}

export async function runKeeperCycle(options, state = new Set(), deps = {}) {
  const log = deps.log ?? console.log;
  const tasks = deps.tasks ?? await fetchLiveRoundBootstrapTasks({
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl: deps.fetchImpl,
    lookaheadSeconds: options.lookaheadSeconds
  });
  const results = [];
  for (const task of tasks) {
    const key = taskKey(task);
    if (state.has(key)) continue;
    const timing = task.lookahead ? 'next' : 'current';
    log(`[devnet-live] bootstrapping ${timing} ${task.asset} ${task.interval} round ${task.roundId} (market ${task.marketId})`);
    const result = await bootstrapLiveRoundTask(task, options, deps);
    state.add(key);
    results.push(result);
    const sentLabels = result.sent.map(([label]) => label).join(', ') || 'already initialized';
    log(`[devnet-live] ready ${task.asset} ${task.interval} round ${task.roundId}: ${sentLabels}`);
  }
  return results;
}

export async function runKeeper(options, deps = {}) {
  const state = deps.state ?? new Set();
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (options.mode === 'once') {
    return runKeeperCycle(options, state, deps);
  }

  const log = deps.log ?? console.log;
  log(`[devnet-live] watching ${options.apiBaseUrl} every ${options.intervalMs}ms`);
  while (true) {
    try {
      await runKeeperCycle(options, state, deps);
    } catch (error) {
      const message = formatKeeperError(error);
      console.error(`[devnet-live] ${message}`);
      if (isFatalKeeperError(message)) throw error;
    }
    await sleep(options.intervalMs);
  }
}

export function formatKeeperError(error) {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    parts.push(cause.message);
  } else if (cause && typeof cause === 'object') {
    const code = 'code' in cause ? cause.code : null;
    const syscall = 'syscall' in cause ? cause.syscall : null;
    const address = 'address' in cause ? cause.address : null;
    const port = 'port' in cause ? cause.port : null;
    const detail = [code, syscall, address, port].filter(Boolean).join(' ');
    if (detail) parts.push(detail);
  }
  return parts.join(': ');
}

export function taskKey(task) {
  return `${task.marketId}:${task.roundId}`;
}

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function isFatalKeeperError(message) {
  return message.includes('ENOENT')
    || message.includes('Missing or invalid SOLANA_PROGRAM_ID')
    || message.includes('Missing or invalid SOLANA_CASH_MINT')
    || message.includes('must point to a 64-byte Solana keypair JSON file');
}

function printHelp() {
  console.log(`Usage:
  npm run bootstrap:devnet-live
  npm run bootstrap:devnet-live -- --once
  npm run bootstrap:devnet-live:watch
  npm run bootstrap:devnet-live -- --api-base-url http://127.0.0.1:8080

Bootstraps current and near-boundary next BTC/ETH/SOL 1m and 5m live devnet rounds from the API /markets response.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseKeeperArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    runKeeper(options).catch((error) => {
      console.error(`[devnet-live] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  }
}
