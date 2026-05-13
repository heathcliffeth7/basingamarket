'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ExternalLink, Loader2, Tag, Wallet } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey, cashBalanceQueryOptions } from '@/lib/api/cashBalanceQuery';
import type { CashBid, Market, MarketCurve, MarketPriceSeries, Ticket } from '@/lib/api/types';
import type { SimpleMarketRead } from '@/lib/utils/signals';
import { useAuth } from '@/lib/auth/privy';
import { useWalletSession } from '@/lib/auth/walletSession';
import { cn } from '@/lib/utils/cn';
import { formatTokenAmount, formatUsdPrice, parseTokenAmountToBaseUnits } from '@/lib/utils/amount';
import Badge from '@/lib/components/ui/Badge';
import Button from '@/lib/components/ui/Button';
import LiveConnectionBadge from './LiveConnectionBadge';
import type { RealtimeStatus } from './LiveConnectionBadge';
import type { SelectedOrderBookAsk } from './MarketOrderBook';

type TradeSide = 'UP' | 'DOWN';

export default function MarketActionPanel({
  simpleRead,
  curve = null,
  market = null,
  priceSeries = null,
  selectedStartAt,
  realtimeState = 'live',
  marketHref = '/markets',
  viewingLive = true,
  mock = false,
  selectedOrderBookAsk = null,
  onClearSelectedOrderBookAsk
}: {
  simpleRead: SimpleMarketRead;
  curve?: MarketCurve | null;
  market?: Market | null;
  priceSeries?: MarketPriceSeries | null;
  selectedStartAt?: number;
  realtimeState?: Exclude<RealtimeStatus, 'mock'>;
  marketHref?: string;
  viewingLive?: boolean;
  mock?: boolean;
  selectedOrderBookAsk?: SelectedOrderBookAsk | null;
  onClearSelectedOrderBookAsk?: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    loginSolana,
    solanaWalletAddress,
    solanaWalletsReady,
    solanaWalletResolving
  } = useAuth();
  const { getWalletSession } = useWalletSession();
  const [selectedSide, setSelectedSide] = useState<TradeSide>(selectedOrderBookAsk?.side ?? 'UP');
  const [amount, setAmount] = useState('1');
  const [activeTradeTab, setActiveTradeTab] = useState<'buy' | 'sell'>('buy');
  const [activeOrderType, setActiveOrderType] = useState<'market' | 'limit'>(selectedOrderBookAsk ? 'limit' : 'market');
  const [orderTypeMenuOpen, setOrderTypeMenuOpen] = useState(false);
  const [listingPrice, setListingPrice] = useState('0.75');
  const [bidSide, setBidSide] = useState<TradeSide>(selectedOrderBookAsk?.side ?? 'UP');
  const [bidPrice, setBidPrice] = useState('0.50');
  const [bidMax, setBidMax] = useState('1');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const confidenceTone = simpleRead.confidenceLabel === 'High' ? 'positive' : simpleRead.confidenceLabel === 'Medium' ? 'neutral' : 'warning';
  const upSide = curve?.sides.find((side) => side.side === 'UP') ?? null;
  const downSide = curve?.sides.find((side) => side.side === 'DOWN') ?? null;
  const walletAddress = solanaWalletAddress;
  const walletConnectPending = !walletAddress && (solanaWalletResolving || !solanaWalletsReady);
  const cashQuery = useQuery(cashBalanceQueryOptions({
    walletAddress,
    enabled: Boolean(walletAddress)
  }));
  const amountBaseUnits = useMemo(() => parseTokenAmountToBaseUnits(amount), [amount]);
  const bidMaxBaseUnits = useMemo(() => parseTokenAmountToBaseUnits(bidMax), [bidMax]);
  const cashBalanceBaseUnits = cashQuery.data?.status === 'ready' && cashQuery.data.cash_balance
    ? cashQuery.data.cash_balance
    : null;
  const hasEnoughCash = amountBaseUnits && cashBalanceBaseUnits !== null
    ? BigInt(cashBalanceBaseUnits) >= BigInt(amountBaseUnits)
    : false;
  const hasEnoughBidCash = bidMaxBaseUnits && cashBalanceBaseUnits !== null
    ? BigInt(cashBalanceBaseUnits) >= BigInt(bidMaxBaseUnits)
    : false;
  const hasEnoughSelectedAskCash = selectedOrderBookAsk && cashBalanceBaseUnits !== null
    ? BigInt(cashBalanceBaseUnits) >= BigInt(selectedOrderBookAsk.total_usdc)
    : false;
  const selectedSideData = selectedSide === 'UP' ? upSide : downSide;
  const nowTs = useHydrationSafeNowTs(marketSnapshotNowTs(market, priceSeries, selectedStartAt));
  const outcome = buildClosedRoundOutcome({ market, priceSeries, selectedStartAt, viewingLive, nowTs });
  const curveLeader = curve?.sides.length
    ? [...curve.sides].sort((a, b) => Number(BigInt(b.market_cap) - BigInt(a.market_cap)))[0]
    : null;
  const marketId = curve?.market_id ?? market?.market_id ?? null;
  const roundId = curve?.round_id ?? market?.price_header?.round_id ?? null;
  const tradingReady = Boolean(curve && marketId && roundId && !outcome.closed);
  const canBuy = tradingReady
    && viewingLive
    && market?.price_header?.price_display_state === 'live';
  const ticketsQuery = useQuery({
    queryKey: ['market-tickets', marketId, roundId],
    queryFn: () => api.getMarketTickets(marketId ?? '', roundId),
    enabled: Boolean(marketId && roundId && walletAddress)
  });
  const bidsQuery = useQuery({
    queryKey: ['round-bids', roundId, marketId],
    queryFn: () => api.getBids(roundId ?? '', marketId ?? ''),
    enabled: Boolean(roundId && marketId && !outcome.closed),
    refetchInterval: 4000
  });
  const orderBookQuery = useQuery({
    queryKey: ['round-orderbook', roundId, marketId],
    queryFn: () => api.getOrderBook(roundId ?? '', marketId ?? ''),
    enabled: Boolean(roundId && marketId && !outcome.closed),
    refetchInterval: 4000
  });
  const ownedLots = useMemo(() => {
    if (!walletAddress) return [];
    return (ticketsQuery.data ?? []).filter((ticket) => (
      ticket.current_owner === walletAddress
      && !ticket.claimed
      && (ticket.status === 'active' || ticket.status === 'listed')
    ));
  }, [ticketsQuery.data, walletAddress]);
  const claimableTickets = useMemo(() => {
    if (!walletAddress) return [];
    return (ticketsQuery.data ?? []).filter((ticket) => (
      ticket.current_owner === walletAddress
      && canClaimTicket(ticket)
    ));
  }, [ticketsQuery.data, walletAddress]);
  const bestBidBySide = useMemo(() => {
    const best: Partial<Record<TradeSide, CashBid>> = {};
    for (const bid of bidsQuery.data?.bids ?? []) {
      if (bid.side !== 'UP' && bid.side !== 'DOWN') continue;
      if (!best[bid.side] || BigInt(bid.price_per_ticket) > BigInt(best[bid.side]?.price_per_ticket ?? '0')) {
        best[bid.side] = bid as CashBid;
      }
    }
    return best;
  }, [bidsQuery.data]);
  const selectedBookSide = orderBookQuery.data?.sides.find((side) => side.side === selectedSide) ?? null;
  const selectedBestAsk = selectedBookSide?.asks[0] ?? null;
  const marketBuyUsesAsk = Boolean(
    selectedBestAsk
      && selectedSideData
      && amountBaseUnits
      && BigInt(selectedBestAsk.price_per_ticket) <= BigInt(selectedSideData.fresh_mint_price)
      && BigInt(selectedBestAsk.total_usdc) <= BigInt(amountBaseUnits)
  );
  const marketBuyRoute = marketBuyUsesAsk ? 'Listed ask' : 'Fresh curve';

  useEffect(() => {
    if (!selectedOrderBookAsk) return;
    setActiveTradeTab('buy');
    setActiveOrderType('limit');
    setSelectedSide(selectedOrderBookAsk.side);
    setBidSide(selectedOrderBookAsk.side);
    setOrderTypeMenuOpen(false);
  }, [selectedOrderBookAsk]);

  const marketBuyMutation = useMutation({
    mutationFn: async () => {
      if (!curve) throw new Error('Curve is not loaded yet.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!amountBaseUnits) throw new Error('Enter a valid BUSDC amount.');
      if (!canBuy) throw new Error('This round is closed for fresh entries.');
      if (!hasEnoughCash) throw new Error('BUSDC balance is too low.');
      const walletSession = await getWalletSession(walletAddress);

      const result = await api.executeMarketBuy({
        roundId: curve.round_id,
        marketId: curve.market_id,
        buyerWallet: walletAddress,
        side: selectedSide,
        usdcIn: amountBaseUnits,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken,
        onRoundRetry: () => setStatusMessage('Preparing devnet round...')
      });
      return result;
    },
    onSuccess: (result) => {
      setLastSignature(result.signature);
      setStatusMessage(`Bought ${formatTokenAmount(result.received_tickets)} token via ${result.execution_type === 'listed_ask' ? 'listed ask' : 'fresh curve'}`);
      setAmount('1');
      if (curve?.market_id) {
        void queryClient.invalidateQueries({ queryKey: ['market-curve', curve.market_id] });
        void queryClient.invalidateQueries({ queryKey: ['market', curve.market_id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['round-orderbook'] });
      if (walletAddress) {
        void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(walletAddress) });
      }
    },
    onError: (error) => {
      setStatusMessage(tradeErrorMessage(error));
    }
  });
  const listMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!curve) throw new Error('Curve is not loaded yet.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!marketId || !roundId) throw new Error('Round is not ready.');
      const pricePerTicket = parseTokenAmountToBaseUnits(listingPrice);
      if (!pricePerTicket) throw new Error('Enter a valid listing price.');
      const walletSession = await getWalletSession(walletAddress);
      return api.listTicket({
        ticketId: ticket.ticket_id,
        sellerWallet: walletAddress,
        pricePerTicket,
        marketId,
        roundId,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
    },
    onSuccess: (result) => {
      setLastSignature(result.signature);
      setStatusMessage(`Listed ticket #${result.ticket_id} at ${formatUsdPrice(result.price_per_ticket)}`);
      invalidateTradeQueries();
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const instantSellMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!curve) throw new Error('Curve is not loaded yet.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!marketId || !roundId) throw new Error('Round is not ready.');
      const walletSession = await getWalletSession(walletAddress);
      return api.instantSell({
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
      setStatusMessage(`Sold for ${formatTokenAmount(result.seller_receives)} BUSDC after fees`);
      invalidateTradeQueries();
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const cancelListingMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!curve) throw new Error('Curve is not loaded yet.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!marketId || !roundId) throw new Error('Round is not ready.');
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
      invalidateTradeQueries();
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const createBidMutation = useMutation({
    mutationFn: async () => {
      if (!curve) throw new Error('Curve is not loaded yet.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!marketId || !roundId) throw new Error('Round is not ready.');
      const pricePerTicket = parseTokenAmountToBaseUnits(bidPrice);
      const maxUsdc = parseTokenAmountToBaseUnits(bidMax);
      if (!pricePerTicket || !maxUsdc) throw new Error('Enter a valid bid.');
      const walletSession = await getWalletSession(walletAddress);
      return api.createBid({
        roundId,
        marketId,
        buyerWallet: walletAddress,
        side: bidSide,
        pricePerTicket,
        maxUsdc,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
    },
    onSuccess: (result) => {
      setStatusMessage(`Bid placed at ${formatUsdPrice(result.price_per_ticket)} ${result.side}`);
      invalidateTradeQueries();
      if (walletAddress) {
        void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(walletAddress) });
      }
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });
  const buySelectedAskMutation = useMutation({
    mutationFn: async () => {
      const ask = selectedOrderBookAsk;
      if (!ask) throw new Error('Select an ask from the order book.');
      if (!walletAddress) throw new Error('Solana wallet unavailable.');
      if (!marketId || !roundId) throw new Error('Round is not ready.');
      if (!tradingReady) throw new Error('This round is closed for trading.');
      if (!hasEnoughSelectedAskCash) throw new Error('BUSDC balance is too low.');
      const walletSession = await getWalletSession(walletAddress);
      const result = await api.buyListing({
        ticketId: ask.lot_id,
        buyerWallet: walletAddress,
        maxPricePerTicket: ask.price_per_ticket,
        marketId,
        roundId,
        accessToken: walletSession.accessToken,
        walletSessionToken: walletSession.walletSessionToken
      });
      return { ask, result };
    },
    onSuccess: ({ ask, result }) => {
      setLastSignature(result.signature);
      setStatusMessage(`Bought ${formatTokenAmount(ask.ticket_amount)} ${ask.side} token from selected ask`);
      onClearSelectedOrderBookAsk?.();
      invalidateTradeQueries();
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
      invalidateTradeQueries(result.ticket_id);
    },
    onError: (error) => setStatusMessage(tradeErrorMessage(error))
  });

  async function handleBuyClick() {
    setLastSignature(null);
    setStatusMessage(null);
    if (!walletAddress) {
      if (walletConnectPending) {
        setStatusMessage('Solana wallet syncing. Try again in a moment.');
        return;
      }
      await loginSolana();
      return;
    }
    marketBuyMutation.mutate();
  }

  async function handleSelectedAskBuyClick() {
    setLastSignature(null);
    setStatusMessage(null);
    if (!walletAddress) {
      if (walletConnectPending) {
        setStatusMessage('Solana wallet syncing. Try again in a moment.');
        return;
      }
      await loginSolana();
      return;
    }
    buySelectedAskMutation.mutate();
  }

  function invalidateTradeQueries(ticketId?: string) {
    if (ticketId) {
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    }
    if (marketId) {
      void queryClient.invalidateQueries({ queryKey: ['market-tickets', marketId, roundId] });
      void queryClient.invalidateQueries({ queryKey: ['market-tickets', marketId] });
      void queryClient.invalidateQueries({ queryKey: ['market-curve', marketId] });
      void queryClient.invalidateQueries({ queryKey: ['market', marketId] });
    }
    if (roundId && marketId) {
      void queryClient.invalidateQueries({ queryKey: ['round-bids', roundId, marketId] });
      void queryClient.invalidateQueries({ queryKey: ['round-orderbook', roundId, marketId] });
    }
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
    <aside className="space-y-3" aria-label="Market action panel">
      <section className="rounded-2xl border border-terminal-line bg-terminal-panel p-3" aria-label="Market read">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-black leading-tight text-terminal-text">
              {curveLeader ? `Market leans ${curveLeader.side}` : `Crowd leans ${simpleRead.dominantOutcomeLabel}`}
            </p>
            <p className="mt-1 truncate text-xs font-bold text-terminal-muted">
              {curveLeader ? `${formatUsdPrice(curveLeader.best_entry_price)} best entry · ${formatUsdPrice(curveLeader.fresh_mint_price)} fresh mint` : `${simpleRead.dominantOutcomeName} · ${simpleRead.strengthLabel}`}
            </p>
          </div>
          <Badge className="px-2 py-0.5" tone={confidenceTone}>
            {simpleRead.confidenceLabel}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-terminal-line bg-terminal-bg px-2.5 py-2">
            <p className="text-xs font-bold text-terminal-muted">UP token</p>
            <p className="mt-0.5 truncate text-base font-black text-market-positive">{formatUsdPrice(upSide?.best_entry_price)}</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-terminal-muted">{entrySourceLabel(upSide?.best_entry_source)} · vMC {formatUsdPrice(upSide?.market_cap)}</p>
          </div>
          <div className="rounded-xl border border-terminal-line bg-terminal-bg px-2.5 py-2">
            <p className="text-xs font-bold text-terminal-muted">DOWN token</p>
            <p className="mt-0.5 truncate text-base font-black text-market-negative">{formatUsdPrice(downSide?.best_entry_price)}</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-terminal-muted">{entrySourceLabel(downSide?.best_entry_source)} · vMC {formatUsdPrice(downSide?.market_cap)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {mock ? <LiveConnectionBadge status="mock" label="Mock" /> : null}
            <LiveConnectionBadge status={realtimeState} label={realtimeState === 'refetching' ? 'Refetching' : realtimeState === 'offline' ? 'Offline' : realtimeState === 'connecting' ? 'Connecting' : 'Live'} />
          </div>
          {!viewingLive ? (
            <Button className="ml-auto h-8 px-3 text-xs" variant="secondary" href={marketHref}>
              Go to live market
            </Button>
          ) : null}
        </div>
      </section>

      {outcome.closed ? null : (
        <p className="text-center text-xs font-semibold text-terminal-muted">By trading, you agree to the <span className="underline underline-offset-4">Terms of Use</span>.</p>
      )}

      {outcome.closed ? (
        <>
          <OutcomeCard outcome={outcome} />
          <section className="rounded-2xl border border-terminal-line bg-terminal-panel p-4" aria-label="Round claims">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-terminal-text">Claims</p>
                <p className="mt-1 text-xs font-semibold text-terminal-muted">
                  Settlement is checked for this round when your wallet is connected.
                </p>
              </div>
              <Badge className="shrink-0" tone={claimableTickets.length > 0 ? 'positive' : ticketsQuery.isLoading ? 'warning' : 'neutral'}>
                {claimableTickets.length > 0 ? `${claimableTickets.length} ready` : ticketsQuery.isLoading ? 'Checking' : 'Settled'}
              </Badge>
            </div>

            {!walletAddress ? (
              <div className="mt-4 rounded-xl border border-terminal-line bg-terminal-bg p-3">
                <p className="text-xs font-semibold text-terminal-muted">Connect wallet to check claims.</p>
                <Button
                  className="mt-3 h-9 w-full text-xs"
                  disabled={walletConnectPending}
                  onClick={() => {
                    if (walletConnectPending) {
                      setStatusMessage('Solana wallet syncing. Try again in a moment.');
                      return;
                    }
                    void loginSolana();
                  }}
                  variant="secondary"
                >
                  <Wallet size={15} /> {walletConnectPending ? 'Wallet syncing' : 'Connect Solana wallet'}
                </Button>
              </div>
            ) : ticketsQuery.isLoading ? (
              <p className="mt-4 text-xs font-semibold text-terminal-muted">Checking claimable positions...</p>
            ) : claimableTickets.length === 0 ? (
              <p className="mt-4 text-xs font-semibold text-terminal-muted">No unclaimed payout or refund found for this wallet.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {claimableTickets.map((ticket) => {
                  const claimType = ticket.status === 'refundable' ? 'Refund' : 'Payout';
                  const pendingThisTicket = claimTicketMutation.isPending
                    && claimTicketMutation.variables?.ticket_id === ticket.ticket_id;
                  return (
                    <div key={ticket.ticket_id} className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            className="inline-flex max-w-full items-center gap-1 truncate text-xs font-black text-terminal-text underline-offset-4 hover:underline"
                            href={`/tickets/${ticket.ticket_id}`}
                          >
                            <span className="truncate">#{ticket.ticket_id}</span>
                            <ExternalLink size={12} />
                          </a>
                          <p className="mt-1 text-xs font-semibold text-terminal-muted">
                            {claimType} {formatUsdPrice(ticket.settlement_value_usdc ?? '0')}
                          </p>
                        </div>
                        <Badge tone={ticket.status === 'refundable' ? 'warning' : 'positive'}>
                          {ticket.status === 'refundable' ? 'Refundable' : 'Won'}
                        </Badge>
                      </div>
                      <Button
                        className="mt-3 h-9 w-full text-xs"
                        disabled={pendingThisTicket}
                        onClick={() => claimTicketMutation.mutate(ticket)}
                        variant="default"
                      >
                        {pendingThisTicket ? <Loader2 className="animate-spin" size={15} /> : <Wallet size={15} />}
                        Claim
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {statusMessage ? <p className="mt-3 text-xs font-semibold text-terminal-muted">{statusMessage}</p> : null}
          </section>
        </>
      ) : (
        <section className="relative rounded-2xl border border-terminal-line bg-terminal-panel">
          <div className="flex h-14 items-center justify-between gap-3 border-b border-terminal-line px-4">
            <div className="flex h-full items-center gap-7">
              {([
                ['buy', 'Buy'],
                ['sell', 'Sell'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  className={cn(
                    'flex h-full items-center border-b-4 border-transparent px-0 text-xl font-black transition-colors',
                    activeTradeTab === tab ? 'border-terminal-text text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'
                  )}
                  type="button"
                  onClick={() => {
                    setActiveTradeTab(tab);
                    setOrderTypeMenuOpen(false);
                    if (tab !== 'buy') {
                      onClearSelectedOrderBookAsk?.();
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <button
                aria-expanded={orderTypeMenuOpen}
                aria-haspopup="menu"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-lg font-black text-terminal-text transition hover:bg-terminal-panel-strong"
                data-testid="order-type-trigger"
                type="button"
                onClick={() => setOrderTypeMenuOpen((open) => !open)}
              >
                {orderTypeLabel(activeOrderType)}
                <ChevronDown className={cn('transition-transform', orderTypeMenuOpen && 'rotate-180')} size={18} />
              </button>
              {orderTypeMenuOpen ? (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-30 w-44 rounded-lg border border-terminal-line bg-terminal-bg py-2 shadow-2xl"
                  data-testid="order-type-menu"
                  role="menu"
                >
                  {(['market', 'limit'] as const).map((type) => (
                    <button
                      key={type}
                      className={cn(
                        'block w-full px-5 py-3 text-left text-base font-black transition hover:bg-terminal-panel-strong',
                        activeOrderType === type ? 'text-terminal-text' : 'text-terminal-muted'
                      )}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setActiveOrderType(type);
                        setOrderTypeMenuOpen(false);
                        if (type !== 'limit') {
                          onClearSelectedOrderBookAsk?.();
                        }
                      }}
                    >
                      {orderTypeLabel(type)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-3 p-3">

          {activeTradeTab === 'buy' && activeOrderType === 'market' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button className={tradeSideButtonClass(selectedSide === 'UP', 'UP')} type="button" onClick={() => setSelectedSide('UP')}>
                  Up {formatUsdPrice(upSide?.best_entry_price)}
                </button>
                <button className={tradeSideButtonClass(selectedSide === 'DOWN', 'DOWN')} type="button" onClick={() => setSelectedSide('DOWN')}>
                  Down {formatUsdPrice(downSide?.best_entry_price)}
                </button>
              </div>
              <div className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-bold text-terminal-muted">Best entry</p>
                    <p className="text-lg font-black text-terminal-text">{formatUsdPrice(selectedSideData?.best_entry_price)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-terminal-muted">Route</p>
                    <p className="text-sm font-black text-terminal-text">{marketBuyRoute}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-terminal-muted">Fresh mint</p>
                    <p className="text-sm font-black text-terminal-text">{formatUsdPrice(selectedSideData?.fresh_mint_price)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-terminal-muted">Best ask</p>
                    <p className="text-sm font-black text-terminal-text">{selectedBestAsk ? formatUsdPrice(selectedBestAsk.price_per_ticket) : 'None'}</p>
                  </div>
                </div>
                <label className="mt-3 block">
                  <span className="text-xs font-bold text-terminal-muted">Max spend</span>
                  <input
                    className="mt-1 h-10 w-full rounded-lg border border-terminal-line bg-terminal-panel-strong px-3 font-mono text-sm font-bold text-terminal-text outline-none focus:border-market-positive"
                    inputMode="decimal"
                    suppressHydrationWarning
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <p className="mt-2 text-xs font-semibold text-terminal-muted">
                  {amountBaseUnits ? `${formatTokenAmount(amountBaseUnits)} BUSDC` : 'Enter a valid BUSDC amount'}
                </p>
                {walletAddress ? (
                  <p className="mt-1 text-xs font-semibold text-terminal-muted">
                    BUSDC balance {cashBalanceBaseUnits !== null ? formatTokenAmount(cashBalanceBaseUnits) : 'loading'} BUSDC
                  </p>
                ) : null}
              </div>
              <Button
                className="mt-2 h-10 w-full px-3 text-xs"
                disabled={marketBuyMutation.isPending || !amountBaseUnits || walletConnectPending || Boolean(walletAddress && (!canBuy || !curve || !hasEnoughCash))}
                onClick={handleBuyClick}
                variant={selectedSide === 'DOWN' ? 'danger' : 'default'}
              >
                {marketBuyMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <Wallet size={15} />}
                {walletAddress ? `Market buy ${selectedSide}` : walletConnectPending ? 'Wallet syncing' : 'Connect Solana wallet'}
              </Button>
            </>
          ) : null}

          {activeTradeTab === 'buy' && activeOrderType === 'limit' ? (
            <div className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
              {selectedOrderBookAsk ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-terminal-muted">Selected ask</p>
                      <p className="mt-1 text-base font-black text-terminal-text">{selectedOrderBookAsk.side} listed position</p>
                    </div>
                    <button
                      className="rounded-md px-2 py-1 text-xs font-bold text-terminal-muted transition hover:bg-terminal-panel-strong hover:text-terminal-text"
                      type="button"
                      onClick={() => onClearSelectedOrderBookAsk?.()}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-terminal-line bg-terminal-panel-strong p-2">
                      <p className="text-[11px] font-bold text-terminal-muted">Limit price</p>
                      <p className="mt-0.5 font-mono text-sm font-black text-market-warning">{formatUsdPrice(selectedOrderBookAsk.price_per_ticket)}</p>
                    </div>
                    <div className="rounded-lg border border-terminal-line bg-terminal-panel-strong p-2 text-right">
                      <p className="text-[11px] font-bold text-terminal-muted">Total BUSDC</p>
                      <p className="mt-0.5 font-mono text-sm font-black text-terminal-text">{formatUsdPrice(selectedOrderBookAsk.total_usdc)}</p>
                    </div>
                    <div className="rounded-lg border border-terminal-line bg-terminal-panel-strong p-2">
                      <p className="text-[11px] font-bold text-terminal-muted">Size</p>
                      <p className="mt-0.5 font-mono text-sm font-black text-terminal-text">{formatTokenAmount(selectedOrderBookAsk.ticket_amount)} token</p>
                    </div>
                    <div className="rounded-lg border border-terminal-line bg-terminal-panel-strong p-2 text-right">
                      <p className="text-[11px] font-bold text-terminal-muted">Lot</p>
                      <p className="mt-0.5 font-mono text-sm font-black text-terminal-text">#{selectedOrderBookAsk.lot_id}</p>
                    </div>
                  </div>
                  {walletAddress ? (
                    <p className="mt-2 text-xs font-semibold text-terminal-muted">
                      BUSDC balance {cashBalanceBaseUnits !== null ? formatTokenAmount(cashBalanceBaseUnits) : 'loading'} BUSDC
                    </p>
                  ) : null}
                  <Button
                    className="mt-3 h-9 w-full text-xs"
                    disabled={buySelectedAskMutation.isPending || walletConnectPending || Boolean(walletAddress && (!tradingReady || !hasEnoughSelectedAskCash))}
                    onClick={handleSelectedAskBuyClick}
                    variant={selectedOrderBookAsk.side === 'DOWN' ? 'danger' : 'default'}
                  >
                    {buySelectedAskMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <Wallet size={15} />}
                    {walletAddress ? `Buy selected ask ${selectedOrderBookAsk.side}` : walletConnectPending ? 'Wallet syncing' : 'Connect Solana wallet'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs font-black uppercase tracking-wide text-terminal-muted">Place limit bid</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <button className={tradeSideButtonClass(bidSide === 'UP', 'UP')} type="button" onClick={() => setBidSide('UP')}>
                      Up bid
                    </button>
                    <button className={tradeSideButtonClass(bidSide === 'DOWN', 'DOWN')} type="button" onClick={() => setBidSide('DOWN')}>
                      Down bid
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs font-bold text-terminal-muted">Limit price</span>
                      <input className="mt-1 h-9 w-full rounded-lg border border-terminal-line bg-terminal-panel-strong px-2 font-mono text-xs font-bold text-terminal-text outline-none" inputMode="decimal" suppressHydrationWarning value={bidPrice} onChange={(event) => setBidPrice(event.target.value)} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-terminal-muted">Max BUSDC</span>
                      <input className="mt-1 h-9 w-full rounded-lg border border-terminal-line bg-terminal-panel-strong px-2 font-mono text-xs font-bold text-terminal-text outline-none" inputMode="decimal" suppressHydrationWarning value={bidMax} onChange={(event) => setBidMax(event.target.value)} />
                    </label>
                  </div>
                  <Button
                    className="mt-2 h-9 w-full text-xs"
                    disabled={createBidMutation.isPending || walletConnectPending || Boolean(walletAddress && (!tradingReady || !hasEnoughBidCash))}
                    onClick={() => {
                      if (walletAddress) {
                        createBidMutation.mutate();
                        return;
                      }
                      if (walletConnectPending) {
                        setStatusMessage('Solana wallet syncing. Try again in a moment.');
                        return;
                      }
                      void loginSolana();
                    }}
                    variant="secondary"
                  >
                    {walletAddress ? 'Place limit bid' : walletConnectPending ? 'Wallet syncing' : 'Connect Solana wallet'}
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {activeTradeTab === 'sell' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-terminal-line bg-terminal-bg p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase tracking-wide text-terminal-muted">Your lots</p>
                  <p className="text-xs font-semibold text-terminal-muted">{ownedLots.length} active</p>
                </div>
                {!walletAddress ? (
                  <Button
                    className="h-9 w-full text-xs"
                    disabled={walletConnectPending}
                    onClick={() => {
                      if (walletConnectPending) {
                        setStatusMessage('Solana wallet syncing. Try again in a moment.');
                        return;
                      }
                      void loginSolana();
                    }}
                    variant="secondary"
                  >
                    <Wallet size={15} /> {walletConnectPending ? 'Wallet syncing' : 'Connect Solana wallet'}
                  </Button>
                ) : ownedLots.length === 0 ? (
                  <p className="text-xs font-semibold text-terminal-muted">No deposited-cash positions in this round yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ownedLots.slice(0, 4).map((ticket) => {
                      const side = sideFromTicket(ticket);
                      const bestBid = bestBidBySide[side];
                      return (
                        <div key={ticket.ticket_id} className="rounded-lg border border-terminal-line bg-terminal-panel-strong p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="flex items-center gap-1 text-[11px] font-black text-terminal-text">
                                {ticket.token_name ? (
                                  <>
                                    <span className="truncate">{ticket.token_name.replace(/-(up|down)$/i, '')}</span>
                                    <span className="shrink-0 whitespace-nowrap">{side}</span>
                                  </>
                                ) : (
                                  <span>#{ticket.ticket_id} {side}</span>
                                )}
                              </p>
                              <p className="text-[11px] font-semibold text-terminal-muted">{formatTokenAmount(ticket.stake_amount)} token</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] font-bold text-terminal-muted">{activeOrderType === 'market' ? 'Best bid' : 'Listed at'}</p>
                              <p className="text-xs font-black text-terminal-text">{activeOrderType === 'market' ? (bestBid ? formatUsdPrice(bestBid.price_per_ticket) : 'None') : (ticket.listed_price ? formatUsdPrice(ticket.listed_price) : 'Not listed')}</p>
                            </div>
                          </div>
                          {activeOrderType === 'market' ? (
                            <>
                              <Button
                                className="mt-2 h-8 w-full text-xs"
                                disabled={!tradingReady || !bestBid || instantSellMutation.isPending}
                                onClick={() => instantSellMutation.mutate(ticket)}
                                variant="default"
                              >
                                Sell now
                              </Button>
                              {!bestBid ? <p className="mt-1 text-[11px] font-semibold text-terminal-muted">No instant buyer. Switch to Limit to list your {side} token.</p> : null}
                            </>
                          ) : (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <Button
                                className="h-8 text-xs"
                                disabled={!tradingReady || listMutation.isPending}
                                onClick={() => listMutation.mutate(ticket)}
                                variant="secondary"
                              >
                                <Tag size={13} /> {ticket.listed_price ? 'Update list' : 'List'}
                              </Button>
                              <Button
                                className="h-8 text-xs"
                                disabled={!tradingReady || !ticket.listed_price || cancelListingMutation.isPending}
                                onClick={() => cancelListingMutation.mutate(ticket)}
                                variant="ghost"
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {activeOrderType === 'limit' ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-bold text-terminal-muted">Ask price per token</span>
                    <input
                      className="mt-1 h-9 w-full rounded-lg border border-terminal-line bg-terminal-panel-strong px-3 font-mono text-sm font-bold text-terminal-text outline-none focus:border-market-positive"
                      inputMode="decimal"
                      suppressHydrationWarning
                      value={listingPrice}
                      onChange={(event) => setListingPrice(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          {statusMessage ? <p className="text-xs font-semibold text-terminal-muted">{statusMessage}</p> : null}
          {lastSignature ? (
            <a className="inline-flex items-center gap-1 text-xs font-bold text-market-positive underline underline-offset-4" href={`https://explorer.solana.com/tx/${lastSignature}?cluster=devnet`} rel="noreferrer" target="_blank">
              View transaction <ExternalLink size={12} />
            </a>
          ) : null}
        </div>
        </section>
      )}
    </aside>
  );
}

function OutcomeCard({ outcome }: { outcome: ClosedRoundOutcome }) {
  return (
    <section className="rounded-2xl border border-terminal-line bg-terminal-panel px-5 py-9 text-center" aria-label="Round outcome">
      <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#1598ff] text-terminal-bg">
        <Check size={56} strokeWidth={2.6} />
      </div>
      <h3 className="mt-9 text-2xl font-medium text-[#1598ff]">{outcome.title}</h3>
      <p className="mx-auto mt-8 max-w-[520px] text-balance text-xl font-semibold leading-snug text-terminal-muted">
        {outcome.subtitle}
      </p>
    </section>
  );
}

function entrySourceLabel(source: string | null | undefined) {
  return source === 'listed_token' ? 'Listed token' : 'Fresh curve';
}

function orderTypeLabel(type: 'market' | 'limit') {
  return type === 'market' ? 'Market' : 'Limit';
}

function tradeSideButtonClass(active: boolean, side: TradeSide) {
  return cn(
    'h-20 rounded-2xl border px-4 text-center text-lg font-black transition disabled:opacity-45',
    active && side === 'UP' && 'border-market-positive bg-market-positive text-white shadow-[inset_0_-10px_0_rgba(0,0,0,0.08)]',
    active && side === 'DOWN' && 'border-market-negative bg-market-negative text-white shadow-[inset_0_-10px_0_rgba(0,0,0,0.08)]',
    !active && 'border-terminal-line bg-terminal-panel-strong text-terminal-muted hover:border-terminal-line-strong hover:text-terminal-text'
  );
}

function sideFromTicket(ticket: Ticket): TradeSide {
  return ticket.outcome_id === 1 ? 'DOWN' : 'UP';
}

function canClaimTicket(ticket: Ticket) {
  return !ticket.claimed && (ticket.status === 'won' || ticket.status === 'refundable');
}

function marketSnapshotNowTs(
  market: Market | null | undefined,
  priceSeries: MarketPriceSeries | null | undefined,
  selectedStartAt: number | undefined
) {
  return priceSeries?.start_at ?? selectedStartAt ?? market?.price_header?.start_at ?? 0;
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function useHydrationSafeNowTs(fallbackNowTs: number) {
  const [nowTs, setNowTs] = useState(fallbackNowTs);

  useEffect(() => {
    const syncNow = () => setNowTs(currentUnixSeconds());
    syncNow();
    const timer = window.setInterval(syncNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return nowTs;
}

function replaceCachedTicket(current: Ticket[] | undefined, ticket: Ticket) {
  if (!current) return current;
  return current.map((cachedTicket) => cachedTicket.ticket_id === ticket.ticket_id ? ticket : cachedTicket);
}

type ClosedRoundOutcome = {
  closed: boolean;
  title: string;
  subtitle: string;
};

export function buildClosedRoundOutcome({
  market,
  priceSeries,
  selectedStartAt,
  viewingLive,
  nowTs = Math.floor(Date.now() / 1000)
}: {
  market?: Market | null;
  priceSeries?: MarketPriceSeries | null;
  selectedStartAt?: number;
  viewingLive: boolean;
  nowTs?: number;
}): ClosedRoundOutcome {
  const header = market?.price_header ?? null;
  const headerMatchesSelectedRound = selectedStartAt === undefined || header?.start_at === selectedStartAt;
  const durationSeconds = priceSeries?.duration_seconds ?? header?.duration_seconds ?? 300;
  const startAt = priceSeries?.start_at ?? selectedStartAt ?? header?.start_at ?? 0;
  const endAt = priceSeries?.end_at ?? (startAt > 0 ? startAt + durationSeconds : 0);
  const closed = viewingLive
    ? header?.price_display_state === 'closed' || (endAt > 0 && nowTs >= endAt)
    : true;
  const openPrice = priceSeries?.open_price ?? (headerMatchesSelectedRound ? header?.open_price : null);
  const closePrice = priceSeries?.close_price
    ?? priceSeries?.current_price
    ?? (headerMatchesSelectedRound ? header?.close_price ?? header?.current_price : null);

  return {
    closed,
    title: closed ? outcomeTitle(resolveOutcome(openPrice, closePrice)) : '',
    subtitle: `${assetRoundLabel(header?.asset)} - ${formatEtRoundWindow(startAt, endAt)}`
  };
}

export function resolveOutcome(openPrice: string | null | undefined, closePrice: string | null | undefined) {
  if (!openPrice || !closePrice) return 'pending';
  const open = BigInt(openPrice);
  const close = BigInt(closePrice);
  if (close > open) return 'up';
  if (close < open) return 'down';
  return 'void';
}

function outcomeTitle(outcome: ReturnType<typeof resolveOutcome>) {
  if (outcome === 'up') return 'Outcome: Up';
  if (outcome === 'down') return 'Outcome: Down';
  if (outcome === 'void') return 'Outcome: Void';
  return 'Outcome pending';
}

function assetRoundLabel(asset: string | null | undefined) {
  const names: Record<string, string> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    XRP: 'XRP',
    DOGE: 'Dogecoin'
  };
  return `${names[asset ?? ''] ?? asset ?? 'Market'} Up or Down`;
}

export function formatEtRoundWindow(startAt: number, endAt: number) {
  if (!startAt || !endAt) return 'ET';
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric'
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const startDate = new Date(startAt * 1000);
  const endDate = new Date(endAt * 1000);
  const startDay = dateFormatter.format(startDate);
  const endDay = dateFormatter.format(endDate);
  const startTime = timeFormatter.format(startDate).replace(/\s/g, '');
  const endTime = timeFormatter.format(endDate).replace(/\s/g, '');

  if (startDay === endDay) return `${startDay}, ${startTime}-${endTime} ET`;
  return `${startDay}, ${startTime}-${endDay}, ${endTime} ET`;
}

export function tradeErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'cash_buy_liquidity_pending') {
      return 'Vault BUSDC reserve is too low. Add app/admin devnet BUSDC reserve before buying from the fresh curve.';
    }
    return error.message || `Trade intent failed: ${error.code}`;
  }
  if (error instanceof Error) return error.message;
  return 'Trade transaction failed.';
}
