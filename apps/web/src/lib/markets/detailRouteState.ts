import type { Market } from '@/lib/api/types';
import type { MarketRouteResolution } from './routes';
import { resolveMarketRouteFreshness } from './routes';

export type MarketDetailRouteState = {
  showLiveRouteLoading: boolean;
  usingOptimisticLiveMarket: boolean;
  requestedViewingLive: boolean;
  renderViewingLive: boolean;
  marketForChart: Market | null;
  marketForPanels: Market | null;
};

export function buildMarketDetailRouteState({
  route,
  market,
  selectedStartAt,
  nowMs = Date.now()
}: {
  route: MarketRouteResolution;
  market: Market | null | undefined;
  selectedStartAt: number | undefined;
  nowMs?: number;
}): MarketDetailRouteState {
  const freshness = resolveMarketRouteFreshness(route, market, nowMs);
  const header = market?.price_header ?? null;
  const requestedViewingLive = freshness.currentLiveRoute || Boolean(header && selectedStartAt === header.start_at);
  const optimisticMarket = freshness.staleLiveRoute
    ? buildOptimisticLiveMarket(route, market, nowMs)
    : null;
  const usingOptimisticLiveMarket = Boolean(optimisticMarket);

  return {
    showLiveRouteLoading: false,
    usingOptimisticLiveMarket,
    requestedViewingLive,
    renderViewingLive: requestedViewingLive,
    marketForChart: optimisticMarket ?? market ?? null,
    marketForPanels: usingOptimisticLiveMarket ? null : market ?? null
  };
}

function buildOptimisticLiveMarket(
  route: MarketRouteResolution,
  market: Market | null | undefined,
  nowMs: number
): Market | null {
  if (!route.asset || !route.durationSeconds || route.startAt === undefined) {
    return null;
  }

  const symbol = market?.price_header?.asset === route.asset
    ? market.price_header.symbol
    : `${route.asset}USDT`;
  const assetImageUrl = market?.price_header?.asset === route.asset
    ? market.price_header.asset_image_url
    : `/visuals/crypto/${route.asset.toLowerCase()}.svg`;
  const durationLabel = `${Math.round(route.durationSeconds / 60)}m`;

  return {
    market_id: route.marketId,
    market_sequence: market?.market_sequence ?? 0,
    question_hash: market?.question_hash ?? `${route.asset} ${durationLabel} Crypto Round`,
    price_header: {
      asset: route.asset,
      asset_image_url: assetImageUrl,
      duration_seconds: route.durationSeconds,
      settlement_source: `Binance Spot ${symbol} ${durationLabel}`,
      symbol,
      round_id: String(Math.floor(route.startAt / route.durationSeconds)),
      start_at: route.startAt,
      end_at: route.startAt + route.durationSeconds,
      open_price: null,
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: new Date(nowMs).toISOString()
    },
    status: 'open',
    outcome_count: market?.outcome_count ?? 2,
    open_at: route.startAt,
    trade_until: route.startAt + route.durationSeconds,
    winning_outcome: null,
    outcomes: market?.outcomes ?? []
  };
}
