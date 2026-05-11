#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';
export const DEFAULT_PUBLIC_API_BASE_URL = '/api/backend';
export const DEFAULT_WEB_HOST = '0.0.0.0';
export const DEFAULT_WEB_PORT = '5173';
export const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
export const DEFAULT_HEALTH_INTERVAL_MS = 500;
export const BUY_INTENT_PROBE_ROUND_ID = '0';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(scriptDir, '../../..');

export function normalizeBaseUrl(value = DEFAULT_API_BASE_URL) {
  return String(value || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

export function healthUrlForApiBaseUrl(apiBaseUrl = DEFAULT_API_BASE_URL) {
  return new URL('/health/live', normalizeBaseUrl(apiBaseUrl)).toString();
}

export function buyIntentProbeUrlForApiBaseUrl(apiBaseUrl = DEFAULT_API_BASE_URL) {
  return new URL(`/rounds/${BUY_INTENT_PROBE_ROUND_ID}/buy-intent`, normalizeBaseUrl(apiBaseUrl)).toString();
}

export function resolveDevConfig(env = process.env) {
  const apiBaseUrl = normalizeBaseUrl(env.API_INTERNAL_BASE_URL || DEFAULT_API_BASE_URL);
  return {
    apiBaseUrl,
    buyIntentProbeUrl: buyIntentProbeUrlForApiBaseUrl(apiBaseUrl),
    devnetRoundKeeper: devnetRoundKeeperEnabled(env),
    healthUrl: healthUrlForApiBaseUrl(apiBaseUrl),
    healthTimeoutMs: Number(env.API_HEALTH_TIMEOUT_MS || DEFAULT_HEALTH_TIMEOUT_MS),
    healthIntervalMs: Number(env.API_HEALTH_INTERVAL_MS || DEFAULT_HEALTH_INTERVAL_MS),
    webHost: env.WEB_HOST || DEFAULT_WEB_HOST,
    webPort: String(env.PORT || DEFAULT_WEB_PORT)
  };
}

export function nextDevEnv(env = process.env, apiBaseUrl = DEFAULT_API_BASE_URL, webHost = DEFAULT_WEB_HOST) {
  return {
    ...env,
    HOST: webHost,
    API_INTERNAL_BASE_URL: normalizeBaseUrl(apiBaseUrl),
    NEXT_PUBLIC_API_BASE_URL: DEFAULT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_USE_MOCK_FALLBACK: env.NEXT_PUBLIC_USE_MOCK_FALLBACK || 'true'
  };
}

export function apiStartupAction(apiHealthy) {
  return apiHealthy ? 'use-existing-api' : 'spawn-api';
}

export function webDevUrlForConfig(config) {
  return `http://127.0.0.1:${config.webPort}`;
}

export function devnetRoundKeeperEnabled(env = process.env) {
  const configured = String(env.DEVNET_ROUND_KEEPER ?? '').trim().toLowerCase();
  if (!configured) return true;
  if (['0', 'false', 'no', 'off'].includes(configured)) return false;
  return ['1', 'true', 'yes', 'on'].includes(configured);
}

export function roundKeeperArgsForConfig(config) {
  return ['scripts/devnet-live-round-keeper.mjs', '--watch', '--api-base-url', config.apiBaseUrl];
}

export async function isApiHealthy({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const response = await fetchImpl(healthUrlForApiBaseUrl(apiBaseUrl), { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

export async function isApiCompatible({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const response = await fetchImpl(buyIntentProbeUrlForApiBaseUrl(apiBaseUrl), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: '{}'
    });
    return response.status !== 404;
  } catch {
    return false;
  }
}

export async function isWebDevServerReachable({
  webPort = DEFAULT_WEB_PORT,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${webPort}`, { cache: 'no-store' });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function waitForApiReady({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (await isApiHealthy({ apiBaseUrl, fetchImpl })) return true;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for API health at ${healthUrlForApiBaseUrl(apiBaseUrl)}`);
}

export async function waitForApiCompatible({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (await isApiCompatible({ apiBaseUrl, fetchImpl })) return true;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for API buy-intent route at ${buyIntentProbeUrlForApiBaseUrl(apiBaseUrl)}`);
}

function spawnChild(command, args, options) {
  return spawn(command, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    ...options
  });
}

function startApiProcess(env = process.env) {
  return spawnChild('cargo', ['run', '-p', 'basingamarket-api'], {
    cwd: workspaceRoot,
    env
  });
}

function startNextProcess(config, env = process.env) {
  return spawnChild('next', ['dev', '-H', config.webHost, '-p', config.webPort], {
    cwd: webRoot,
    env: nextDevEnv(env, config.apiBaseUrl, config.webHost)
  });
}

export function startRoundKeeperProcess(config, env = process.env, spawnImpl = spawnChild) {
  return spawnImpl('node', roundKeeperArgsForConfig(config), {
    cwd: webRoot,
    env
  });
}

async function main() {
  const config = resolveDevConfig();
  const children = new Set();
  let shuttingDown = false;

  function track(child, label) {
    children.add(child);
    child.once('exit', (code, signal) => {
      stopChild(child);
      children.delete(child);
      if (!shuttingDown && label === 'api') {
        console.error(`[dev] Rust API exited unexpectedly (${signal ?? code ?? 0}); stopping web dev server.`);
        shutdown(code || 1);
      } else if (!shuttingDown && label === 'devnet-round-keeper') {
        console.error(`[dev] Devnet live round keeper exited (${signal ?? code ?? 0}); live devnet rounds will not be auto-bootstrapped.`);
      }
    });
    return child;
  }

  function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      stopChild(child);
    }
    setTimeout(() => process.exit(code), 250).unref();
  }

  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));

  const healthy = await isApiHealthy({ apiBaseUrl: config.apiBaseUrl });
  if (apiStartupAction(healthy) === 'use-existing-api') {
    if (!(await isApiCompatible({ apiBaseUrl: config.apiBaseUrl }))) {
      throw new Error(`[dev] Existing Rust API at ${config.apiBaseUrl} is stale. Restart it so /rounds/:roundId/buy-intent is available.`);
    }
    console.log(`[dev] Using existing Rust API at ${config.apiBaseUrl}`);
  } else {
    console.log(`[dev] Starting Rust API at ${config.apiBaseUrl}`);
    track(startApiProcess(), 'api');
    await waitForApiReady(config);
    await waitForApiCompatible(config);
    console.log('[dev] Rust API is ready');
  }

  if (config.devnetRoundKeeper) {
    console.log('[dev] Starting devnet live round keeper');
    track(startRoundKeeperProcess(config), 'devnet-round-keeper');
  }

  if (await isWebDevServerReachable({ webPort: config.webPort })) {
    console.log(`[dev] Using existing Next dev server at ${webDevUrlForConfig(config)}`);
    await holdUntilShutdown();
    return;
  }

  const next = track(startNextProcess(config), 'web');
  const { code, signal } = await waitForChildExit(next);
  stopChild(next);
  shutdown(signal ? 1 : code ?? 0);
}

function stopChild(child) {
  if (child.killed || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }
}

function waitForChildExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function holdUntilShutdown() {
  const interval = setInterval(() => {}, 60_000);
  return new Promise((resolve) => {
    process.once('exit', () => {
      clearInterval(interval);
      resolve();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
