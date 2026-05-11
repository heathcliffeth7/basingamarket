import type { Query } from '@tanstack/react-query';
import { api } from './client';
import type { CashBalance } from './types';

export const CASH_BALANCE_ERROR_REFETCH_INTERVAL_MS = 3_000;
export const CASH_BALANCE_STALE_TIME_MS = 10_000;

export function cashBalanceQueryKey(walletAddress?: string | null) {
  return ['cash-balance', walletAddress ?? null] as const;
}

type CashBalanceQuery = Query<CashBalance, Error, CashBalance, ReturnType<typeof cashBalanceQueryKey>>;

export function cashBalanceRefetchInterval(query: CashBalanceQuery) {
  return query.state.status === 'error' ? CASH_BALANCE_ERROR_REFETCH_INTERVAL_MS : false;
}

export function cashBalanceQueryOptions({
  walletAddress,
  enabled = true
}: {
  walletAddress?: string | null;
  enabled?: boolean;
}) {
  const normalizedWalletAddress = walletAddress ?? null;

  return {
    queryKey: cashBalanceQueryKey(normalizedWalletAddress),
    queryFn: () => {
      if (!normalizedWalletAddress) {
        throw new Error('cash wallet address missing');
      }
      return api.getCashBalance(normalizedWalletAddress);
    },
    enabled: Boolean(enabled && normalizedWalletAddress),
    staleTime: CASH_BALANCE_STALE_TIME_MS,
    retry: 3,
    retryDelay: 750,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: cashBalanceRefetchInterval,
    refetchIntervalInBackground: true
  };
}
