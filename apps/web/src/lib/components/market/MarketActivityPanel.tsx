'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import type { BidBook, CashBid, MarketCurve, Ticket } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/privy';
import { useWalletSession } from '@/lib/auth/walletSession';
import { cn } from '@/lib/utils/cn';
import { formatTokenAmount, formatUsdPrice } from '@/lib/utils/amount';
import Badge from '@/lib/components/ui/Badge';
import Button from '@/lib/components/ui/Button';

type TradeSide = 'UP' | 'DOWN';

export default function MarketActivityPanel({
  curve,
  marketId,
  roundId,
  viewingLive = true
}: {
  curve?: MarketCurve | null;
  marketId: string;
  roundId: string | null;
  viewingLive?: boolean;
}) {
  const queryClient = useQueryClient();
  const {
    loginSolana,
    walletAddress,
    solanaWalletsReady,
    solanaWalletResolving
  } = useAuth();
  const { getWalletSession } = useWalletSession();
  const walletConnectPending = !walletAddress && (solanaWalletResolving || !solanaWalletsReady);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const bidsQuery = useQuery({
    queryKey: ['round-bids', roundId, marketId],
    queryFn: () => api.getBids(roundId ?? '', marketId),
    enabled: Boolean(roundId && walletAddress),
    staleTime: 0,
    refetchInterval: walletAddress ? 4_000 : false,
    refetchIntervalInBackground: true
  });
  const ticketsQuery = useQuery({
    queryKey: ['market-tickets', marketId, roundId],
    queryFn: () => api.getMarketTickets(marketId, roundId),
    enabled: Boolean(walletAddress && roundId),
    staleTime: 0,
    refetchInterval: walletAddress ? 4_000 : false,
    refetchIntervalInBackground: true
  });
  const freshBidBook = bidsQuery.data?.round_id === roundId ? bidsQuery.data : null;
  const activeOrders = useMemo(
    () => buildActiveOrderRows(freshBidBook, { marketId, roundId, walletAddress }),
    [freshBidBook, marketId, roundId, walletAddress]
  );
  const ownedPositions = useMemo(
    () => buildOwnedPositionRows(ticketsQuery.data ?? [], { marketId, roundId, walletAddress }),
    [marketId, ticketsQuery.data, roundId, walletAddress]
  );
  const itemCount = activeOrders.length + ownedPositions.length;
  const loading = Boolean(walletAddress && (bidsQuery.isLoading || ticketsQuery.isLoading));
  const cancelBidMutation = useMutation({
    mutationFn: async (bid: CashBid) => {
      if (!roundId) throw new Error('Round is not ready.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      const walletSession = await getWalletSession(walletAddress);
      return api.cancelBid({
        roundId,
        bidId: bid.bid_id,
        buyerWallet: walletAddress,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
    },
    onSuccess: (result) => {
      setLastSignature(null);
      setStatusMessage(`Cancelled order ${result.bid_id}`);
      invalidateActivityQueries();
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const cancelListingMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!roundId) throw new Error('Round is not ready.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      const walletSession = await getWalletSession(walletAddress);
      return api.cancelListing({
        ticketId: ticket.ticket_id,
        sellerWallet: walletAddress,
        marketId,
        roundId,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
    },
    onSuccess: (result) => {
      setLastSignature(result.signature);
      setStatusMessage(`Cancelled listing #${result.ticket_id}`);
      invalidateActivityQueries();
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const claimTicketMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      const walletSession = await getWalletSession(walletAddress);
      return api.claimTicket({
        ticketId: ticket.ticket_id,
        claimerWallet: walletAddress,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
    },
    onSuccess: (result) => {
      setLastSignature(null);
      setStatusMessage(`Claimed ${formatUsdPrice(result.amount)} from #${result.ticket_id}`);
      syncClaimedTicketCache(result.ticket);
      invalidateActivityQueries(result.ticket_id);
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });

  function invalidateActivityQueries(ticketId?: string) {
    if (ticketId) {
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    }
    void queryClient.invalidateQueries({ queryKey: ['round-bids', roundId, marketId] });
    void queryClient.invalidateQueries({ queryKey: ['round-orderbook', roundId, marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market-tickets', marketId, roundId] });
    void queryClient.invalidateQueries({ queryKey: ['market-tickets', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market-curve', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market', marketId] });
    if (walletAddress) {
      void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(walletAddress) });
      void queryClient.invalidateQueries({ queryKey: ['profile-positions', walletAddress] });
    }
  }

  function syncClaimedTicketCache(ticket: Ticket) {
    queryClient.setQueryData<Ticket>(['ticket', ticket.ticket_id], ticket);
    queryClient.setQueryData<Ticket[]>(['market-tickets', ticket.market_id, ticket.round_id], (current) => replaceCachedTicket(current, ticket));
    queryClient.setQueryData<Ticket[]>(['market-tickets', ticket.market_id], (current) => replaceCachedTicket(current, ticket));
    if (walletAddress) {
      queryClient.setQueryData<Ticket[]>(['profile-positions', walletAddress], (current) => replaceCachedTicket(current, ticket));
    }
  }

  return (
    <section className="rounded-2xl border border-terminal-line bg-terminal-panel p-3" aria-label="My activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-terminal-text">My activity</p>
          <p className="mt-0.5 text-xs font-semibold text-terminal-muted">Active orders and owned positions for this market.</p>
        </div>
        <Badge tone={itemCount > 0 ? 'positive' : loading ? 'warning' : 'neutral'}>
          {loading ? 'loading' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
        </Badge>
      </div>

      {!walletAddress ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-terminal-line bg-terminal-bg px-3 py-3">
          <p className="text-xs font-semibold text-terminal-muted">
            {walletConnectPending ? 'Solana wallet is syncing; activity will appear here shortly.' : 'Connect your Solana wallet to see your active orders and positions here.'}
          </p>
          <Button className="h-9 px-3 text-xs" disabled={walletConnectPending} onClick={() => void loginSolana()} variant="secondary">
            <Wallet size={14} /> {walletConnectPending ? 'Wallet syncing' : 'Connect wallet'}
          </Button>
        </div>
      ) : !roundId ? (
        <p className="mt-3 rounded-xl border border-terminal-line bg-terminal-bg px-3 py-3 text-xs font-semibold text-terminal-muted">Round data is loading.</p>
      ) : itemCount === 0 ? (
        <p className="mt-3 rounded-xl border border-terminal-line bg-terminal-bg px-3 py-3 text-xs font-semibold text-terminal-muted">
          {loading ? 'Loading your activity...' : 'No active orders or owned positions in this market yet.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <ActivityGroup title="Active orders" count={activeOrders.length}>
            {activeOrders.length === 0 ? (
              <EmptyActivityLine>No active limit orders.</EmptyActivityLine>
            ) : activeOrders.map((bid) => (
              <div key={bid.bid_id} className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn('text-sm font-black', bid.side === 'UP' ? 'text-market-positive' : 'text-market-negative')}>
                      {bid.side} limit order
                    </p>
                    <p className="mt-1 text-xs font-semibold text-terminal-muted">
                      {formatUsdPrice(bid.price_per_ticket)} limit · {formatTokenAmount(bid.remaining_usdc)} BUSDC open
                    </p>
                  </div>
                  <Button
                    className="h-8 shrink-0 px-3 text-xs"
                    disabled={cancelBidMutation.isPending && cancelBidMutation.variables?.bid_id === bid.bid_id}
                    onClick={() => cancelBidMutation.mutate(bid)}
                    variant="ghost"
                  >
                    {cancelBidMutation.isPending && cancelBidMutation.variables?.bid_id === bid.bid_id ? <Loader2 className="animate-spin" size={13} /> : null}
                    Cancel order
                  </Button>
                </div>
              </div>
            ))}
          </ActivityGroup>

          <ActivityGroup title="Owned positions" count={ownedPositions.length}>
            {ownedPositions.length === 0 ? (
              <EmptyActivityLine>No owned positions.</EmptyActivityLine>
            ) : ownedPositions.map((ticket) => {
              const side = sideFromTicket(ticket);
              const pnl = positionPnl(ticket, side, freshBidBook, curve);
              return (
                <div key={ticket.ticket_id} className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn('flex items-center gap-1 text-xs font-black', side === 'UP' ? 'text-market-positive' : 'text-market-negative')}>
                        {ticket.token_name ? (
                          <>
                            <span className="truncate">{ticket.token_name.replace(/-(up|down)$/i, '')}</span>
                            <span className="shrink-0 whitespace-nowrap">{side}</span>
                          </>
                        ) : (
                          <span>#{ticket.ticket_id} {side}</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-terminal-muted">
                        {formatTokenAmount(ticketTokenAmount(ticket))} token · cost {formatUsdPrice(ticketCostBasis(ticket))}
                      </p>
                      <p className={cn(
                        'mt-1 text-xs font-black',
                        pnl?.tone === 'positive' ? 'text-market-positive' : pnl?.tone === 'negative' ? 'text-market-negative' : 'text-terminal-muted'
                      )}>
                        {pnl ? `${pnl.label} PnL ${formatSignedUsdPrice(pnl.amount)}` : 'PnL pending'}
                        <span className="font-semibold text-terminal-muted">
                          {' '}· {ticket.listed_price ? `listed ${formatUsdPrice(ticket.listed_price)}` : ticket.status}
                        </span>
                      </p>
                    </div>
                    {ticket.listed_price ? (
                      <Button
                        className="h-8 shrink-0 px-3 text-xs"
                        disabled={cancelListingMutation.isPending && cancelListingMutation.variables?.ticket_id === ticket.ticket_id}
                        onClick={() => cancelListingMutation.mutate(ticket)}
                        variant="ghost"
                      >
                        {cancelListingMutation.isPending && cancelListingMutation.variables?.ticket_id === ticket.ticket_id ? <Loader2 className="animate-spin" size={13} /> : null}
                        Cancel listing
                      </Button>
                    ) : canClaimTicket(ticket) ? (
                      <Button
                        className="h-8 shrink-0 px-3 text-xs"
                        disabled={claimTicketMutation.isPending && claimTicketMutation.variables?.ticket_id === ticket.ticket_id}
                        onClick={() => claimTicketMutation.mutate(ticket)}
                        variant="secondary"
                      >
                        {claimTicketMutation.isPending && claimTicketMutation.variables?.ticket_id === ticket.ticket_id ? <Loader2 className="animate-spin" size={13} /> : null}
                        Claim
                      </Button>
                    ) : (
                      <Badge className="shrink-0 px-2 py-0.5 text-[10px]" tone="neutral">{ticket.status}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </ActivityGroup>
        </div>
      )}

      {statusMessage ? <p className="mt-3 text-xs font-semibold text-terminal-muted">{statusMessage}</p> : null}
      {lastSignature ? (
        <a className="mt-2 inline-flex text-xs font-bold text-market-positive underline underline-offset-4" href={`https://explorer.solana.com/tx/${lastSignature}?cluster=devnet`} rel="noreferrer" target="_blank">
          View transaction
        </a>
      ) : null}
    </section>
  );
}

function ActivityGroup({
  children,
  count,
  title
}: {
  children: ReactNode;
  count: number;
  title: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-terminal-muted">{title}</p>
        <span className="font-mono text-xs font-bold text-terminal-muted">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyActivityLine({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-terminal-line bg-terminal-bg px-3 py-3 text-xs font-semibold text-terminal-muted">{children}</p>;
}

export function buildActiveOrderRows(
  bidBook: BidBook | null | undefined,
  {
    marketId,
    roundId,
    walletAddress
  }: {
    marketId: string;
    roundId: string | null;
    walletAddress: string | null;
  }
) {
  if (!bidBook || !roundId || bidBook.round_id !== roundId || !walletAddress) return [];

  return bidBook.bids.filter((bid) =>
    bid.market_id === marketId
    && bid.round_id === roundId
    && sameWallet(bid.buyer_wallet, walletAddress)
    && bid.status.toLowerCase() === 'active'
    && amountIsPositive(bid.remaining_usdc)
  );
}

export function buildOwnedPositionRows(
  tickets: Ticket[],
  {
    marketId,
    roundId,
    walletAddress
  }: {
    marketId: string;
    roundId: string | null;
    walletAddress: string | null;
  }
) {
  if (!walletAddress) return [];

  return tickets.filter((ticket) =>
    ticket.market_id === marketId
    && (!roundId || ticket.round_id === roundId)
    && sameWallet(ticket.current_owner, walletAddress)
    && !ticket.claimed
    && (ticket.status === 'active' || ticket.status === 'listed' || ticket.status === 'won' || ticket.status === 'lost' || ticket.status === 'refundable')
  );
}

function canClaimTicket(ticket: Ticket) {
  return !ticket.claimed && (ticket.status === 'won' || ticket.status === 'refundable');
}

function replaceCachedTicket(current: Ticket[] | undefined, ticket: Ticket) {
  if (!current) return current;
  return current.map((cachedTicket) => cachedTicket.ticket_id === ticket.ticket_id ? ticket : cachedTicket);
}

function sideFromTicket(ticket: Ticket): TradeSide {
  return ticket.outcome_id === 1 ? 'DOWN' : 'UP';
}

function sameWallet(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left === right);
}

function amountIsPositive(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

export function positionPnl(
  ticket: Ticket,
  side: TradeSide,
  bidBook: BidBook | null | undefined,
  curve: MarketCurve | null | undefined
) {
  if (ticket.realized_pnl_usdc !== null && ticket.realized_pnl_usdc !== undefined) {
    const amount = safeBigInt(ticket.realized_pnl_usdc);
    if (amount === null) return null;
    return {
      amount,
      label: 'Realized',
      tone: pnlTone(amount)
    };
  }

  if (ticket.status === 'lost') {
    const costBasis = safeBigInt(ticketCostBasis(ticket));
    if (costBasis === null) return null;
    const amount = costBasis === 0n ? 0n : -costBasis;
    return {
      amount,
      label: 'Realized',
      tone: pnlTone(amount)
    };
  }

  if (ticket.status !== 'active' && ticket.status !== 'listed') {
    return null;
  }

  const tokenAmount = safeBigInt(ticketTokenAmount(ticket));
  const costBasis = safeBigInt(ticketCostBasis(ticket));
  const markPrice = markPriceForSide(side, bidBook, curve);
  if (tokenAmount === null || costBasis === null || markPrice === null) {
    return null;
  }

  const markValue = (tokenAmount * markPrice) / 1_000_000n;
  const amount = markValue - costBasis;
  return {
    amount,
    label: 'Unrealized',
    tone: pnlTone(amount)
  };
}

function markPriceForSide(
  side: TradeSide,
  bidBook: BidBook | null | undefined,
  curve: MarketCurve | null | undefined
) {
  const bestBid = (bidBook?.bids ?? [])
    .filter((bid) => bid.side === side && amountIsPositive(bid.remaining_usdc))
    .reduce<bigint | null>((best, bid) => {
      const price = safeBigInt(bid.price_per_ticket);
      if (price === null) return best;
      return best === null || price > best ? price : best;
    }, null);
  if (bestBid !== null) return bestBid;

  const curvePrice = curve?.sides.find((candidate) => candidate.side === side)?.price;
  return safeBigInt(curvePrice);
}

function ticketTokenAmount(ticket: Ticket) {
  return ticket.token_amount ?? ticket.reward_shares ?? ticket.stake_amount;
}

function ticketCostBasis(ticket: Ticket) {
  if (ticket.cost_basis_usdc) return ticket.cost_basis_usdc;
  const tokenAmount = safeBigInt(ticketTokenAmount(ticket));
  const entryPrice = safeBigInt(ticket.entry_odds);
  if (tokenAmount === null || entryPrice === null) return '0';
  return ((tokenAmount * entryPrice) / 1_000_000n).toString();
}

function safeBigInt(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    return null;
  }
}

function pnlTone(amount: bigint) {
  if (amount > 0n) return 'positive' as const;
  if (amount < 0n) return 'negative' as const;
  return 'neutral' as const;
}

function formatSignedUsdPrice(value: bigint) {
  const sign = value > 0n ? '+' : value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${formatUsdPrice(absolute)}`;
}

function tradeErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Trade action failed.';
}
