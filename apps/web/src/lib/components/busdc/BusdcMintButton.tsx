'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Loader2 } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { useAuth } from '@/lib/auth/privy';
import { cn } from '@/lib/utils/cn';
import { formatTokenAmount } from '@/lib/utils/amount';

type BusdcMintButtonProps = {
  walletAddress: string;
  compact?: boolean;
};

export function busdcMintStatusQueryKey(walletAddress: string) {
  return ['busdc-mint-status', walletAddress] as const;
}

export function busdcMintInvalidationKeys(walletAddress: string) {
  return [cashBalanceQueryKey(walletAddress), busdcMintStatusQueryKey(walletAddress)];
}

export default function BusdcMintButton({ walletAddress, compact = false }: BusdcMintButtonProps) {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuth();
  const statusQuery = useQuery({
    queryKey: busdcMintStatusQueryKey(walletAddress),
    queryFn: () => api.getBusdcMintStatus(walletAddress),
    staleTime: 30_000
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      return api.mintBusdc(walletAddress, accessToken);
    },
    onSuccess: () => {
      busdcMintInvalidationKeys(walletAddress).forEach((queryKey) => {
        void queryClient.invalidateQueries({ queryKey });
      });
    }
  });
  const state = busdcMintButtonState({
    isError: statusQuery.isError || mutation.isError,
    isLoading: statusQuery.isLoading,
    isPending: mutation.isPending,
    remaining: mutation.data?.daily_mints_remaining ?? statusQuery.data?.daily_mints_remaining,
    limit: mutation.data?.daily_mints_limit ?? statusQuery.data?.daily_mints_limit,
    mintAmount: mutation.data?.minted_amount ?? statusQuery.data?.mint_amount,
    error: mutation.error
  });

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border border-market-positive/55 bg-market-positive/12 font-black text-terminal-text transition hover:border-market-positive hover:bg-market-positive/20 disabled:cursor-not-allowed disabled:border-terminal-line disabled:bg-terminal-panel disabled:text-terminal-muted',
        compact ? 'h-9 px-2.5 text-xs' : 'h-10 px-3 text-sm'
      )}
      aria-label="Mint BUSDC"
      title={state.title}
      disabled={state.disabled}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Coins size={15} />}
      <span className="whitespace-nowrap">{state.label}</span>
    </button>
  );
}

export function busdcMintButtonState({
  isError,
  isLoading,
  isPending,
  remaining,
  limit,
  mintAmount,
  error
}: {
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  remaining?: number | null;
  limit?: number | null;
  mintAmount?: string | null;
  error?: unknown;
}) {
  const limitHit = remaining === 0;
  const amountLabel = mintAmount ? `${formatTokenAmount(mintAmount)} BUSDC` : '50,000 BUSDC';
  const limitLabel = limit ? `${limit}x/day` : '5x/day';
  return {
    disabled: Boolean(isLoading || isPending || limitHit),
    label: isPending ? 'Minting' : limitHit ? 'Limit hit' : 'Mint BUSDC',
    title: isError
      ? busdcMintErrorMessage(error)
      : limitHit
        ? 'Daily BUSDC mint limit reached.'
        : `Mint ${amountLabel}. Limit ${limitLabel}.`
  };
}

export function busdcMintErrorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.code === 'busdc_mint_limit_exceeded') {
    return 'Daily BUSDC mint limit reached.';
  }
  if (error instanceof ApiClientError && error.code === 'busdc_mint_reserve_unavailable') {
    return 'BUSDC reserve is not ready. Add devnet vault backing before minting.';
  }
  if (error instanceof Error) return error.message;
  return 'BUSDC mint status unavailable.';
}
