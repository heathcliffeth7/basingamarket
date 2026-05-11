import { describe, expect, it } from 'vitest';
import { mockMarkets } from '@/lib/api/mock';
import type { Market } from '@/lib/api/types';
import { parseMarketRouteParam, resolveMarketRouteFreshness } from './routes';
import { buildMarketDetailRouteState } from './detailRouteState';

const nowMs = 1_778_413_777_000;
const currentFiveMinuteStartAt = 1_778_413_500;

function btcMarketAt(startAt: number): Market {
  const base = mockMarkets[0];
  return {
    ...base,
    price_header: {
      ...base.price_header!,
      start_at: startAt,
      end_at: startAt + 300,
      round_id: String(Math.floor(startAt / 300)),
      duration_seconds: 300
    }
  };
}

describe('market detail route state', () => {
  it('builds an optimistic live chart market for stale cached headers', () => {
    const route = parseMarketRouteParam(`btc-updown-5m-${currentFiveMinuteStartAt}`);
    const state = buildMarketDetailRouteState({
      route,
      market: btcMarketAt(currentFiveMinuteStartAt - 300),
      selectedStartAt: currentFiveMinuteStartAt,
      nowMs
    });

    expect(resolveMarketRouteFreshness(route, btcMarketAt(currentFiveMinuteStartAt - 300), nowMs).staleLiveRoute).toBe(true);
    expect(state.showLiveRouteLoading).toBe(false);
    expect(state.usingOptimisticLiveMarket).toBe(true);
    expect(state.marketForChart?.price_header?.start_at).toBe(currentFiveMinuteStartAt);
    expect(state.marketForChart?.price_header?.end_at).toBe(currentFiveMinuteStartAt + 300);
    expect(state.marketForChart?.price_header?.round_id).toBe(String(Math.floor(currentFiveMinuteStartAt / 300)));
    expect(state.marketForChart?.price_header?.open_price).toBeNull();
    expect(state.marketForChart?.price_header?.current_price).toBeNull();
    expect(state.marketForChart?.price_header?.close_price).toBeNull();
    expect(state.marketForPanels).toBeNull();
    expect(state.requestedViewingLive).toBe(true);
    expect(state.renderViewingLive).toBe(true);
  });

  it('builds an optimistic live chart market even after the stale market cache is cleared', () => {
    const route = parseMarketRouteParam(`btc-updown-5m-${currentFiveMinuteStartAt}`);
    const state = buildMarketDetailRouteState({
      route,
      market: null,
      selectedStartAt: currentFiveMinuteStartAt,
      nowMs
    });

    expect(state.usingOptimisticLiveMarket).toBe(true);
    expect(state.marketForChart?.market_id).toBe('1');
    expect(state.marketForChart?.price_header).toMatchObject({
      asset: 'BTC',
      symbol: 'BTCUSDT',
      start_at: currentFiveMinuteStartAt,
      end_at: currentFiveMinuteStartAt + 300,
      open_price: null,
      current_price: null,
      close_price: null,
      price_display_state: 'live'
    });
    expect(state.marketForPanels).toBeNull();
    expect(state.renderViewingLive).toBe(true);
  });

  it('allows live rendering once the market header matches the live slug', () => {
    const route = parseMarketRouteParam(`btc-updown-5m-${currentFiveMinuteStartAt}`);
    const market = btcMarketAt(currentFiveMinuteStartAt);
    const state = buildMarketDetailRouteState({
      route,
      market,
      selectedStartAt: currentFiveMinuteStartAt,
      nowMs
    });

    expect(resolveMarketRouteFreshness(route, market, nowMs).freshLiveRoute).toBe(true);
    expect(state.showLiveRouteLoading).toBe(false);
    expect(state.usingOptimisticLiveMarket).toBe(false);
    expect(state.marketForChart).toBe(market);
    expect(state.marketForPanels).toBe(market);
    expect(state.requestedViewingLive).toBe(true);
    expect(state.renderViewingLive).toBe(true);
  });

  it('does not suppress stale data for historical slugs', () => {
    const historicalStartAt = currentFiveMinuteStartAt - 300;
    const route = parseMarketRouteParam(`btc-updown-5m-${historicalStartAt}`);
    const market = btcMarketAt(currentFiveMinuteStartAt);
    const state = buildMarketDetailRouteState({
      route,
      market,
      selectedStartAt: historicalStartAt,
      nowMs
    });

    expect(resolveMarketRouteFreshness(route, market, nowMs).staleLiveRoute).toBe(false);
    expect(state.showLiveRouteLoading).toBe(false);
    expect(state.usingOptimisticLiveMarket).toBe(false);
    expect(state.marketForChart).toBe(market);
    expect(state.marketForPanels).toBe(market);
    expect(state.requestedViewingLive).toBe(false);
    expect(state.renderViewingLive).toBe(false);
  });

  it('keeps numeric market id routes on the existing live behavior', () => {
    const route = parseMarketRouteParam('1');
    const market = btcMarketAt(currentFiveMinuteStartAt);
    const state = buildMarketDetailRouteState({
      route,
      market,
      selectedStartAt: market.price_header?.start_at,
      nowMs
    });

    expect(resolveMarketRouteFreshness(route, market, nowMs).currentLiveRoute).toBe(false);
    expect(state.showLiveRouteLoading).toBe(false);
    expect(state.usingOptimisticLiveMarket).toBe(false);
    expect(state.marketForChart).toBe(market);
    expect(state.marketForPanels).toBe(market);
    expect(state.requestedViewingLive).toBe(true);
    expect(state.renderViewingLive).toBe(true);
  });
});
