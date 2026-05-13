import type { TransferDepositAsset } from '@/lib/api/types';
import { solanaRpcUrl } from '@/lib/api/env';

export const PENDING_EXTERNAL_DEPOSIT_KEY = 'bm_pending_external_deposit';

const SIGNATURE_CONFIRMATION_DELAYS_MS = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000];

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type PendingExternalDeposit = {
  walletAddress: string;
  externalWalletAddress: string;
  quoteId: string | null;
  reference: string | null;
  signature: string;
  asset: TransferDepositAsset;
  amount: string;
  createdAt: string;
};

type SignatureStatus = {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
  confirmations?: number | null;
  err?: unknown;
};

type SignatureStatusResponse = {
  result?: {
    value?: Array<SignatureStatus | null>;
  };
  error?: unknown;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

export function readPendingExternalDeposit(storage = browserStorage()): PendingExternalDeposit | null {
  if (!storage) return null;
  try {
    return parsePendingExternalDeposit(JSON.parse(storage.getItem(PENDING_EXTERNAL_DEPOSIT_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function writePendingExternalDeposit(deposit: PendingExternalDeposit, storage = browserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(PENDING_EXTERNAL_DEPOSIT_KEY, JSON.stringify(deposit));
  } catch {
    // ignore
  }
}

export function clearPendingExternalDeposit(storage = browserStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_EXTERNAL_DEPOSIT_KEY);
  } catch {
    // ignore
  }
}

export async function waitForSignatureConfirmation({
  signature,
  rpcUrl = solanaRpcUrl,
  fetchFn = globalThis.fetch.bind(globalThis) as FetchLike,
  sleep = delay,
  retryDelaysMs = SIGNATURE_CONFIRMATION_DELAYS_MS
}: {
  signature: string;
  rpcUrl?: string;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: number[];
}) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const status = await fetchSignatureStatus({ signature, rpcUrl, fetchFn });
    if (status?.err) {
      throw new Error('Transaction failed on Solana.');
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return status;
    }
    if (attempt >= retryDelaysMs.length) {
      throw new Error('Transaction is not confirmed on devnet yet. Use Verify again in a few seconds.');
    }
    await sleep(retryDelaysMs[attempt] ?? 1000);
  }

  throw new Error('Transaction confirmation check failed.');
}

async function fetchSignatureStatus({
  signature,
  rpcUrl,
  fetchFn
}: {
  signature: string;
  rpcUrl: string;
  fetchFn: FetchLike;
}) {
  const response = await fetchFn(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'getSignatureStatuses',
      method: 'getSignatureStatuses',
      params: [[signature], { searchTransactionHistory: true }]
    })
  });
  if (!response.ok) {
    throw new Error('Solana RPC is not responding right now.');
  }
  const body = await response.json() as SignatureStatusResponse;
  if (body.error) {
    throw new Error('Solana RPC could not read the transaction status.');
  }
  return body.result?.value?.[0] ?? null;
}

function parsePendingExternalDeposit(value: unknown): PendingExternalDeposit | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const asset = record.asset;
  if (asset !== 'BUSDC' && asset !== 'SOL') return null;
  if (
    typeof record.walletAddress !== 'string' ||
    typeof record.externalWalletAddress !== 'string' ||
    typeof record.signature !== 'string' ||
    typeof record.amount !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    walletAddress: record.walletAddress,
    externalWalletAddress: record.externalWalletAddress,
    quoteId: typeof record.quoteId === 'string' ? record.quoteId : null,
    reference: typeof record.reference === 'string' ? record.reference : null,
    signature: record.signature,
    asset,
    amount: record.amount,
    createdAt: record.createdAt
  };
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
