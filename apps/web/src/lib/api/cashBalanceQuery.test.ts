import { describe, expect, it } from 'vitest';
import {
  CASH_BALANCE_ERROR_REFETCH_INTERVAL_MS,
  cashBalanceQueryKey,
  cashBalanceQueryOptions,
  cashBalanceRefetchInterval
} from './cashBalanceQuery';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('cash balance query options', () => {
  it('builds a stable cash balance query key', () => {
    expect(cashBalanceQueryKey(SOLANA_DEVNET_PUBKEY)).toEqual(['cash-balance', SOLANA_DEVNET_PUBKEY]);
    expect(cashBalanceQueryKey(null)).toEqual(['cash-balance', null]);
  });

  it('enables only when both caller and wallet allow it', () => {
    expect(cashBalanceQueryOptions({ walletAddress: SOLANA_DEVNET_PUBKEY, enabled: true })).toMatchObject({
      enabled: true,
      retry: 3,
      retryDelay: 750,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true
    });

    expect(cashBalanceQueryOptions({ walletAddress: SOLANA_DEVNET_PUBKEY, enabled: false }).enabled).toBe(false);
    expect(cashBalanceQueryOptions({ walletAddress: null, enabled: true }).enabled).toBe(false);
  });

  it('retries periodically only while the query is in error state', () => {
    expect(cashBalanceRefetchInterval({ state: { status: 'error' } } as Parameters<typeof cashBalanceRefetchInterval>[0])).toBe(CASH_BALANCE_ERROR_REFETCH_INTERVAL_MS);
    expect(cashBalanceRefetchInterval({ state: { status: 'success' } } as Parameters<typeof cashBalanceRefetchInterval>[0])).toBe(false);
    expect(cashBalanceRefetchInterval({ state: { status: 'pending' } } as Parameters<typeof cashBalanceRefetchInterval>[0])).toBe(false);
  });
});
