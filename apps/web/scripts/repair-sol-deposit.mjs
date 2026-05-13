#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallet = requiredArg(args, 'wallet');
  const cashAmount = parseUsdcAmount(args['cash-amount'] ?? args.amount ?? '5');
  const env = readRootEnv();
  const rpcUrl = args.rpc ?? process.env.SOLANA_RPC_URL ?? env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const apiBaseUrl = args['api-base-url'] ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const treasury = args.treasury ?? process.env.SOLANA_SOL_TREASURY ?? env.SOLANA_SOL_TREASURY;
  const accessToken = args['access-token'] ?? process.env.PRIVY_ACCESS_TOKEN ?? env.PRIVY_ACCESS_TOKEN;
  const walletSessionToken = args['wallet-session-token'] ?? process.env.BM_WALLET_SESSION_TOKEN ?? env.BM_WALLET_SESSION_TOKEN;
  const signature = args.signature ?? await findSignature({ rpcUrl, wallet, treasury });
  if (!accessToken) throw new Error('Missing --access-token or PRIVY_ACCESS_TOKEN');
  if (!walletSessionToken) throw new Error('Missing --wallet-session-token or BM_WALLET_SESSION_TOKEN');

  const response = await fetch(`${apiBaseUrl}/profiles/${wallet}/sol-deposit-repairs`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-bm-wallet-session': walletSessionToken
    },
    body: JSON.stringify({ signature, cash_amount: cashAmount })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Repair failed (${response.status}): ${JSON.stringify(body)}`);
  }

  console.log(JSON.stringify(body, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function requiredArg(args, name) {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function parseUsdcAmount(value) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error('--cash-amount must be a positive BUSDC amount with up to 6 decimals');
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (baseUnits <= 0n) throw new Error('--cash-amount must be greater than zero');
  return baseUnits.toString();
}

function readRootEnv() {
  const envPath = path.resolve(process.cwd(), '../../.env');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, '')];
      })
  );
}

async function findSignature({ rpcUrl, wallet, treasury }) {
  if (!treasury) {
    throw new Error('Missing --signature or SOLANA_SOL_TREASURY for treasury scan');
  }
  const signatures = await rpc(rpcUrl, 'getSignaturesForAddress', [
    treasury,
    { limit: 25, commitment: 'confirmed' }
  ]);
  const candidates = [];
  for (const item of signatures ?? []) {
    const transaction = await rpc(rpcUrl, 'getTransaction', [
      item.signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
    ]);
    if (hasWalletTreasuryTransfer(transaction, wallet, treasury)) {
      candidates.push(item.signature);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one wallet -> treasury SOL transfer, found ${candidates.length}: ${candidates.join(', ')}`
    );
  }
  return candidates[0];
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

function hasWalletTreasuryTransfer(transaction, wallet, treasury) {
  if (!transaction || transaction.meta?.err) return false;
  const signed = transaction.transaction?.message?.accountKeys?.some((key) => {
    const pubkey = typeof key === 'string' ? key : key.pubkey;
    return pubkey === wallet && key.signer === true;
  });
  if (!signed) return false;
  const instructions = transaction.transaction?.message?.instructions ?? [];
  return instructions.some((instruction) => {
    const info = instruction.parsed?.info;
    return instruction.program === 'system'
      && instruction.parsed?.type === 'transfer'
      && info?.source === wallet
      && info?.destination === treasury
      && Number(info?.lamports) > 0;
  });
}
