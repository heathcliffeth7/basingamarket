import { describe, expect, it } from 'vitest';
import { mockMarkets } from '../api/mock';
import { buildMarketRoundSlug, currentRoundStartAt, liveMarketRoundHref, parseMarketRouteParam } from './routes';

describe('market round routes', () => {
  it('parses Polymarket-style crypto round slugs', () => {
    expect(parseMarketRouteParam('btc-updown-5m-1778413500')).toEqual({
      marketId: '1',
      asset: 'BTC',
      durationSeconds: 300,
      startAt: 1_778_413_500
    });
    expect(parseMarketRouteParam('eth-updown-1m-1778413560')).toEqual({
      marketId: '12',
      asset: 'ETH',
      durationSeconds: 60,
      startAt: 1_778_413_560
    });
  });

  it('keeps legacy numeric market ids working', () => {
    expect(parseMarketRouteParam('2')).toEqual({ marketId: '2' });
  });

  it('builds deterministic live round slugs', () => {
    expect(buildMarketRoundSlug('ETH', 300, 1_778_413_500)).toBe('eth-updown-5m-1778413500');
    expect(buildMarketRoundSlug('SOL', 60, 1_778_413_560)).toBe('sol-updown-1m-1778413560');
    expect(currentRoundStartAt(300, 1_778_413_777_000)).toBe(1_778_413_500);
  });

  it('builds live hrefs from the current duration bucket', () => {
    expect(liveMarketRoundHref(mockMarkets[4], 1_778_413_777_000)).toBe('/markets/eth-updown-1m-1778413740');
    expect(liveMarketRoundHref(mockMarkets[1], 1_778_413_777_000)).toBe('/markets/eth-updown-5m-1778413500');
  });
});
