'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign } from 'lucide-react';
import { api, marketWebSocketUrl } from '@/lib/api/client';
import { isMockFallbackEnabled } from '@/lib/api/env';
import { createLivePriceStore } from '@/lib/api/livePriceStore';
import { applyLiveTickerPriceToSeries, type LiveTickerUpdate } from '@/lib/api/livePrices';
import type { Market, MarketCurve, MarketPriceSeries } from '@/lib/api/types';
import { mockCurves, mockMarketPriceSeries, mockMarkets, mockRoundHistories } from '@/lib/api/mock';
import { evaluateMarketDelta } from '@/lib/api/realtime';
import { useBinanceTickerStream } from '@/lib/hooks/useBinanceTickerStream';
import { buildMarketDetailRouteState } from '@/lib/markets/detailRouteState';
import { derivePriceLead, type PriceLeadTone } from '@/lib/markets/priceLead';
import { curveForSelectedRound, priceSeriesForSelectedRound, roundIdForStartAt } from '@/lib/markets/roundDataGuards';
import { buildMarketRoundSlug, liveMarketRoundHref, parseMarketRouteParam } from '@/lib/markets/routes';
import { deriveSimpleMarketRead } from '@/lib/utils/signals';
import Button from '@/lib/components/ui/Button';
import Skeleton from '@/lib/components/ui/Skeleton';
import Sheet from '@/lib/components/ui/Sheet';
import AssetPriceChartPanel from '@/lib/components/market/AssetPriceChartPanel';
import MarketActionPanel from '@/lib/components/market/MarketActionPanel';
import MarketActivityPanel from '@/lib/components/market/MarketActivityPanel';
import MarketOrderBook from '@/lib/components/market/MarketOrderBook';
import type { SelectedOrderBookAsk } from '@/lib/components/market/MarketOrderBook';
import MarketPulseStrip from '@/lib/components/market/MarketPulseStrip';
import RoundTimeRail from '@/lib/components/market/RoundTimeRail';

export default function MarketDetailPage() {
  const params = useParams<{ marketId: string }>();
  const route = useMemo(() => parseMarketRouteParam(params.marketId), [params.marketId]);
  const marketId = route.marketId;
  const queryClient = useQueryClient();
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'live' | 'refetching' | 'offline'>('connecting');
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [selectedOrderBookAsk, setSelectedOrderBookAsk] = useState<SelectedOrderBookAsk | null>(null);
  const [livePriceLeadTone, setLivePriceLeadTone] = useState<PriceLeadTone>('neutral');
  const livePriceStoreRef = useRef(createLivePriceStore());
  const livePriceLeadRef = useRef<{
    symbol: string | null;
    startAt: number;
    endAt: number;
    durationSeconds: number;
    openPrice: string | null;
  }>({
    symbol: null,
    startAt: 0,
    endAt: 0,
    durationSeconds: 300,
    openPrice: null
  });
  const marketSequenceRef = useRef(0);
  const mockMarket = mockMarkets.find((candidate) => candidate.market_id === marketId) ?? mockMarkets[0];
  const mockCurveData = mockCurves[marketId] ?? mockCurves[mockMarket.market_id] ?? mockCurves['1'];
  const mockRoundData = mockRoundHistories[marketId] ?? mockRoundHistories[mockMarket.market_id] ?? mockRoundHistories['1'];

  const marketQuery = useQuery({
    queryKey: ['market', marketId],
    queryFn: () => api.getMarket(marketId),
    initialData: isMockFallbackEnabled ? mockMarket : undefined,
    staleTime: 0,
    refetchInterval: realtimeState === 'offline' ? 5_000 : false,
    refetchIntervalInBackground: true
  });
  const marketsQuery = useQuery({
    queryKey: ['markets'],
    queryFn: () => api.getMarkets(),
    initialData: isMockFallbackEnabled ? mockMarkets : undefined,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true
  });
  const market = marketQuery.data ?? (isMockFallbackEnabled ? mockMarket : null);
  const switcherMarkets = useMemo(() => {
    const markets = marketsQuery.data ?? (isMockFallbackEnabled ? mockMarkets : []);

    if (!market) {
      return markets;
    }

    return markets.some((candidate) => candidate.market_id === market.market_id)
      ? markets
      : [market, ...markets];
  }, [market, marketsQuery.data]);
  const switcherCurveMarkets = useMemo(
    () => switcherMarkets.filter(isSwitcherMarket),
    [switcherMarkets]
  );
  const switcherCurveQueries = useQueries({
    queries: switcherCurveMarkets.map((candidate) => ({
      queryKey: ['market-switcher-curve', candidate.market_id],
      queryFn: () => api.getMarketCurve(candidate.market_id),
      initialData: isMockFallbackEnabled ? mockCurves[candidate.market_id] : undefined,
      staleTime: 5_000,
      refetchInterval: 5_000,
      refetchIntervalInBackground: true
    }))
  });
  const switcherCurves = useMemo(() => {
    const curves: Record<string, MarketCurve> = {};

    for (const [index, query] of switcherCurveQueries.entries()) {
      const candidate = switcherCurveMarkets[index];

      if (candidate && query.data) {
        curves[candidate.market_id] = query.data;
      }
    }

    return curves;
  }, [switcherCurveMarkets, switcherCurveQueries]);
  const selectedDurationSeconds = route.durationSeconds ?? market?.price_header?.duration_seconds ?? mockMarket.price_header?.duration_seconds ?? 300;
  const selectedStartAt = route.startAt ?? market?.price_header?.start_at ?? mockMarket.price_header?.start_at;
  const nowMs = useHydrationSafeNowMs(marketSnapshotNowMs(route, market, selectedStartAt));
  const detailRouteState = useMemo(
    () => buildMarketDetailRouteState({ route, market, selectedStartAt, nowMs }),
    [market, nowMs, route, selectedStartAt]
  );
  const usingOptimisticLiveMarket = detailRouteState.usingOptimisticLiveMarket;
  const marketForChart = detailRouteState.marketForChart;
  const marketForPanels = detailRouteState.marketForPanels;
  const viewingLive = detailRouteState.requestedViewingLive;
  const renderViewingLive = detailRouteState.renderViewingLive;
  const routeRoundId = roundIdForStartAt(selectedStartAt, selectedDurationSeconds);
  const mockCurveInitialData = curveForSelectedRound(mockCurveData, selectedStartAt, selectedDurationSeconds) ?? undefined;
  const curveQuery = useQuery({
    queryKey: ['market-curve', marketId, selectedStartAt],
    queryFn: () => api.getMarketCurve(marketId, selectedStartAt),
    enabled: selectedStartAt !== undefined,
    initialData: isMockFallbackEnabled ? mockCurveInitialData : undefined,
    staleTime: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true
  });
  const roundsQuery = useQuery({
    queryKey: ['market-rounds', marketId],
    queryFn: () => api.getMarketRounds(marketId),
    initialData: isMockFallbackEnabled ? mockRoundData : undefined,
    staleTime: 0,
    refetchInterval: 30_000
  });
  const rawCurve = curveQuery.data ?? (isMockFallbackEnabled ? mockCurveInitialData ?? null : null);
  const curve = curveForSelectedRound(rawCurve, selectedStartAt, selectedDurationSeconds);
  const rounds = roundsQuery.data ?? (isMockFallbackEnabled ? mockRoundData : null);
  const orderBookRoundId = curve?.round_id ?? routeRoundId ?? marketForPanels?.price_header?.round_id ?? null;
  const orderBookQuery = useQuery({
    queryKey: ['round-orderbook', orderBookRoundId, marketId],
    queryFn: () => api.getOrderBook(orderBookRoundId ?? '', marketId),
    enabled: Boolean(renderViewingLive && orderBookRoundId),
    staleTime: 0,
    refetchInterval: renderViewingLive ? 4_000 : false,
    refetchIntervalInBackground: true
  });
  const orderBook = renderViewingLive
    ? orderBookQuery.data?.round_id === orderBookRoundId ? orderBookQuery.data : null
    : orderBookRoundId
      ? {
          market_id: marketId,
          round_id: orderBookRoundId,
          updated_at: new Date(0).toISOString(),
          state: 'round_closed' as const,
          sides: [
            { side: 'UP' as const, bids: [], asks: [], best_bid_price: null, best_ask_price: null },
            { side: 'DOWN' as const, bids: [], asks: [], best_bid_price: null, best_ask_price: null }
          ]
      }
      : null;
  const handleSelectOrderBookAsk = useCallback((ask: SelectedOrderBookAsk) => {
    setSelectedOrderBookAsk(ask);
    setActionPanelOpen(true);
  }, []);
  const shouldSeedMockPriceSeries = route.startAt === undefined && selectedStartAt === mockMarket.price_header?.start_at;
  const mockPriceSeriesData = shouldSeedMockPriceSeries && mockMarket.price_header
    ? mockMarketPriceSeries(mockMarket.price_header.symbol, mockMarket.price_header.start_at, mockMarket.price_header.duration_seconds)
    : undefined;
  const priceSeriesRefetchInterval = viewingLive ? (realtimeState === 'offline' ? 5_000 : false) : false;
  const priceSeriesQuery = useQuery({
    queryKey: ['market-price-series', marketId, marketForChart?.price_header?.symbol, selectedStartAt],
    queryFn: () => api.getMarketPriceSeries({
      symbol: marketForChart?.price_header?.symbol ?? mockMarket.price_header?.symbol ?? '',
      startTs: selectedStartAt ?? 0,
      durationSeconds: selectedDurationSeconds
    }),
    enabled: Boolean((marketForChart?.price_header ?? mockMarket.price_header) && selectedStartAt !== undefined),
    initialData: isMockFallbackEnabled ? mockPriceSeriesData : undefined,
    staleTime: 0,
    refetchInterval: priceSeriesRefetchInterval,
    refetchIntervalInBackground: true
  });
  const rawPriceSeries = priceSeriesQuery.data ?? (isMockFallbackEnabled ? mockPriceSeriesData : null);
  const priceSeries = priceSeriesForSelectedRound(rawPriceSeries, selectedStartAt);
  const liveMarketHref = marketForChart ? liveMarketRoundHref(marketForChart, nowMs) : market ? liveMarketRoundHref(market, nowMs) : `/markets/${marketId}`;
  const handleGoLiveMarketClick = useCallback(() => {
    queryClient.removeQueries({ queryKey: ['market', marketId], exact: true });
    queryClient.removeQueries({ queryKey: ['market-curve', marketId] });
    queryClient.removeQueries({ queryKey: ['market-price-series', marketId] });
    queryClient.removeQueries({ queryKey: ['round-orderbook'] });
    void queryClient.invalidateQueries({ queryKey: ['markets'] });
  }, [marketId, queryClient]);
  const updateLivePrice = useCallback(
    (update: LiveTickerUpdate) => {
      livePriceStoreRef.current.push(update);
      const leadInput = livePriceLeadRef.current;
      if (
        update.symbol !== leadInput.symbol
        || update.ts < leadInput.startAt
        || update.ts > leadInput.endAt
      ) {
        return;
      }
      queryClient.setQueryData<MarketPriceSeries | undefined>(
        ['market-price-series', marketId, update.symbol, leadInput.startAt],
        (series) => applyLiveTickerPriceToSeries(series, update, leadInput.startAt, {
          startAt: leadInput.startAt,
          endAt: leadInput.endAt,
          durationSeconds: leadInput.durationSeconds,
          openPrice: leadInput.openPrice
        })
      );
      const nextTone = derivePriceLead(leadInput.openPrice, update.currentPrice).tone;
      setLivePriceLeadTone((current) => current === nextTone ? current : nextTone);
    },
    [marketId, queryClient]
  );
  useBinanceTickerStream(renderViewingLive && marketForChart ? [marketForChart] : [], updateLivePrice, setRealtimeState);
  const simpleRead = useMemo(() => deriveSimpleMarketRead({ market: marketForChart }), [marketForChart]);

  useEffect(() => {
    const header = marketForChart?.price_header ?? null;
    const nextInput = {
      symbol: header?.symbol ?? null,
      startAt: header?.start_at ?? 0,
      endAt: header?.end_at ?? 0,
      durationSeconds: header?.duration_seconds ?? selectedDurationSeconds,
      openPrice: header?.open_price ?? null
    };
    livePriceLeadRef.current = nextInput;
    const displayPrice = header?.current_price ?? header?.close_price ?? null;
    const nextTone = derivePriceLead(nextInput.openPrice, displayPrice).tone;
    setLivePriceLeadTone((current) => current === nextTone ? current : nextTone);
  }, [
    marketForChart?.price_header?.close_price,
    marketForChart?.price_header?.current_price,
    marketForChart?.price_header?.duration_seconds,
    marketForChart?.price_header?.end_at,
    marketForChart?.price_header?.open_price,
    marketForChart?.price_header?.start_at,
    marketForChart?.price_header?.symbol,
    selectedDurationSeconds
  ]);

  useEffect(() => {
    if (!selectedOrderBookAsk) {
      return;
    }
    const askStillListed = orderBook?.state === 'live'
      && orderBook.sides.some((side) => side.side === selectedOrderBookAsk.side && side.asks.some((ask) => ask.lot_id === selectedOrderBookAsk.lot_id));

    if (!askStillListed) {
      setSelectedOrderBookAsk(null);
    }
  }, [orderBook, selectedOrderBookAsk]);

  useEffect(() => {
    marketSequenceRef.current = Math.max(marketSequenceRef.current, marketQuery.data?.market_sequence ?? 0);
  }, [marketQuery.data?.market_sequence]);

  const refetchMarketBundle = useCallback(() => {
    setRealtimeState('refetching');
    void queryClient.invalidateQueries({ queryKey: ['market', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['markets'] });
    void queryClient.invalidateQueries({ queryKey: ['market-switcher-curve'] });
    void queryClient.invalidateQueries({ queryKey: ['market-curve', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['round-orderbook'] });
    void queryClient.invalidateQueries({ queryKey: ['market-rounds', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market-price-series', marketId] });
    window.setTimeout(() => setRealtimeState('live'), 500);
  }, [marketId, queryClient]);

  useEffect(() => {
    if (!renderViewingLive || !marketForPanels?.price_header?.end_at) {
      return;
    }

    const delayMs = Math.max(marketForPanels.price_header.end_at * 1000 - Date.now(), 0) + 100;
    const timer = window.setTimeout(refetchMarketBundle, delayMs);
    return () => window.clearTimeout(timer);
  }, [marketForPanels?.price_header?.end_at, refetchMarketBundle, renderViewingLive]);

  useEffect(() => {
    if (!usingOptimisticLiveMarket) {
      return;
    }

    refetchMarketBundle();
    const timer = window.setInterval(refetchMarketBundle, 1_000);
    return () => window.clearInterval(timer);
  }, [refetchMarketBundle, usingOptimisticLiveMarket]);

  useEffect(() => {
    if (isMockFallbackEnabled) {
      setRealtimeState('live');
      return;
    }
    let lastSequence = marketSequenceRef.current;
    const socket = new WebSocket(marketWebSocketUrl(marketId));
    socket.onopen = () => setRealtimeState('live');
    socket.onclose = () => setRealtimeState('offline');
    socket.onerror = () => setRealtimeState('offline');
    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        refetchMarketBundle();
        return;
      }
      lastSequence = Math.max(lastSequence, marketSequenceRef.current);
      const decision = evaluateMarketDelta({ message, marketId, lastSequence });
      if (decision.action === 'ignore') return;
      if (decision.action === 'refetch') {
        refetchMarketBundle();
        return;
      }
      lastSequence = decision.lastSequence;
      refetchMarketBundle();
    };
    return () => socket.close();
  }, [marketId, refetchMarketBundle]);

  return (
    <main className="mx-auto max-w-[1920px] px-4 py-3 sm:px-6 sm:py-4">
      <div className="xl:hidden">
        <MarketPulseStrip read={simpleRead} realtimeState={realtimeState} mock={isMockFallbackEnabled} />
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-2 xl:hidden">
        <Button className="xl:hidden" size="sm" onClick={() => setActionPanelOpen(true)}><BadgeDollarSign size={14} /> Trade intents</Button>
      </div>
      <section className="mt-5 grid gap-4 xl:grid-cols-[360px_minmax(480px,1fr)_360px]">
        <div className="min-w-0 xl:order-2">
          <div>
            {!marketForChart || (!renderViewingLive && priceSeriesQuery.isLoading && !priceSeries) ? (
              <div data-testid="live-route-loading">
                <Skeleton className="min-h-[400px]" />
              </div>
            ) : (
              <AssetPriceChartPanel
                market={marketForChart}
                series={priceSeries}
                selectedStartAt={selectedStartAt}
                liveHref={liveMarketHref}
                viewingLive={renderViewingLive}
                livePriceStore={livePriceStoreRef.current}
                switcherMarkets={switcherMarkets}
                switcherCurves={switcherCurves}
                onGoLiveMarketClick={handleGoLiveMarketClick}
              />
            )}
          </div>
          <div className="mt-3">
            <RoundTimeRail
              history={rounds}
              selectedStartAt={selectedStartAt}
              liveStartAt={marketForChart?.price_header?.start_at}
              liveTone={livePriceLeadTone}
              roundHref={(round) => {
                const asset = route.asset ?? marketForChart?.price_header?.asset ?? market?.price_header?.asset;
                const durationSeconds = route.durationSeconds ?? marketForChart?.price_header?.duration_seconds ?? market?.price_header?.duration_seconds;
                return asset && durationSeconds
                  ? `/markets/${buildMarketRoundSlug(asset, durationSeconds, round.start_at)}`
                  : `/markets/${marketId}`;
              }}
            />
          </div>
          <div className="mt-3">
            <MarketActivityPanel curve={curve} marketId={marketId} roundId={routeRoundId} viewingLive={renderViewingLive} />
          </div>
        </div>
        <div className="min-w-0 xl:order-1 xl:sticky xl:top-24 xl:self-start">
          {marketForChart ? (
            <MarketOrderBook
              orderBook={orderBook}
              loading={orderBookQuery.isLoading || orderBookQuery.isFetching}
              compact
              selectedAsk={selectedOrderBookAsk}
              onSelectAsk={handleSelectOrderBookAsk}
            />
          ) : null}
        </div>
        <div className="hidden min-w-0 xl:order-3 xl:sticky xl:top-24 xl:block xl:self-start">
          {marketForChart ? (
            <MarketActionPanel
              simpleRead={simpleRead}
              curve={curve}
              market={marketForChart}
              priceSeries={priceSeries}
              selectedStartAt={selectedStartAt}
              realtimeState={realtimeState}
              marketHref={liveMarketHref}
              viewingLive={renderViewingLive}
              mock={isMockFallbackEnabled}
              selectedOrderBookAsk={selectedOrderBookAsk}
              onClearSelectedOrderBookAsk={() => setSelectedOrderBookAsk(null)}
            />
          ) : null}
        </div>
      </section>
      <div className="xl:hidden">
        <Sheet open={actionPanelOpen} side="bottom" onClose={() => setActionPanelOpen(false)}>
          {marketForChart ? (
            <MarketActionPanel
              simpleRead={simpleRead}
              curve={curve}
              market={marketForChart}
              priceSeries={priceSeries}
              selectedStartAt={selectedStartAt}
              realtimeState={realtimeState}
              marketHref={liveMarketHref}
              viewingLive={renderViewingLive}
              mock={isMockFallbackEnabled}
              selectedOrderBookAsk={selectedOrderBookAsk}
              onClearSelectedOrderBookAsk={() => setSelectedOrderBookAsk(null)}
            />
          ) : null}
        </Sheet>
      </div>
    </main>
  );
}

function isSwitcherMarket(market: Market) {
  const header = market.price_header;
  return Boolean(
    header
      && (header.asset === 'BTC' || header.asset === 'ETH' || header.asset === 'SOL')
      && (header.duration_seconds === 60 || header.duration_seconds === 300)
  );
}

function marketSnapshotNowMs(
  route: ReturnType<typeof parseMarketRouteParam>,
  market: Market | null | undefined,
  selectedStartAt: number | undefined
) {
  const snapshotStartAt = market?.price_header?.start_at ?? selectedStartAt ?? route.startAt ?? 0;
  return snapshotStartAt * 1000;
}

function useHydrationSafeNowMs(fallbackNowMs: number) {
  const [nowMs, setNowMs] = useState(fallbackNowMs);

  useEffect(() => {
    const syncNow = () => setNowMs(Date.now());
    syncNow();
    const timer = window.setInterval(syncNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return nowMs;
}
