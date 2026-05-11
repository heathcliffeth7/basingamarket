import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockMarketPriceSeries, mockMarkets } from './mock';
import { applyLiveTickerPriceToMarket, applyLiveTickerPriceToSeries, decimalPriceToScaledString, hydrateLiveMarketPrices } from './livePrices';

describe('live market prices', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('parses Binance decimal strings into 1e6 fixed scale without floats', () => {
    expect(decimalPriceToScaledString('80916.00000000')).toBe('80916000000');
    expect(decimalPriceToScaledString('155.12345678')).toBe('155123456');
    expect(decimalPriceToScaledString('0.00000123')).toBe('1');
  });

  it('hydrates live current prices for every phase-one mock market', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:03:00Z'));
    const fetch = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('/api/binance/ticker')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            prices: [
              { symbol: 'BTCUSDT', price: '80916.00000000' },
              { symbol: 'ETHUSDT', price: '2335.44000000' },
              { symbol: 'SOLUSDT', price: '155.12345678' }
            ]
          })
        });
      }

      const open = url.includes('BTCUSDT')
        ? '80900.00000000'
        : url.includes('ETHUSDT')
          ? '2330.00000000'
          : '155.00000000';

      return Promise.resolve({
        ok: true,
        json: async () => ({
          open
        })
      });
    });
    vi.stubGlobal('fetch', fetch);

    const hydrated = await hydrateLiveMarketPrices(JSON.parse(JSON.stringify(mockMarkets)));

    expect(hydrated[0].price_header?.open_price).toBe('80900000000');
    expect(hydrated[0].price_header?.current_price).toBe('80916000000');
    expect(hydrated[0].price_header?.start_at).toBe(1_778_414_400);
    expect(hydrated[0].price_header?.end_at).toBe(1_778_414_700);
    expect(hydrated[1].price_header?.price_display_state).toBe('live');
    expect(hydrated[1].price_header?.open_price).toBe('2330000000');
    expect(hydrated[1].price_header?.current_price).toBe('2335440000');
    expect(hydrated[1].price_header?.close_price).toBeNull();
    expect(hydrated[1].price_header?.start_at).toBe(1_778_414_400);
    expect(hydrated[1].price_header?.end_at).toBe(1_778_414_700);
    expect(hydrated[2].price_header?.open_price).toBe('155000000');
    expect(hydrated[2].price_header?.current_price).toBe('155123456');
    expect(hydrated[3].price_header?.duration_seconds).toBe(60);
    expect(hydrated[3].price_header?.open_price).toBe('80900000000');
    expect(hydrated[3].price_header?.current_price).toBe('80916000000');
    expect(hydrated[3].price_header?.start_at).toBe(1_778_414_580);
    expect(hydrated[3].price_header?.end_at).toBe(1_778_414_640);
    expect(fetch).toHaveBeenCalledWith(
      '/api/binance/ticker?symbols=BTCUSDT%2CETHUSDT%2CSOLUSDT',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('leaves closed round prices locked', async () => {
    const closedEthMarket = {
      ...mockMarkets[1],
      status: 'resolved',
      winning_outcome: 0,
      price_header: {
        ...mockMarkets[1].price_header!,
        current_price: null,
        close_price: '2038400000',
        price_display_state: 'closed' as const
      }
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not fetch closed markets')));

    const hydrated = await hydrateLiveMarketPrices([closedEthMarket]);

    expect(hydrated[0].price_header?.price_display_state).toBe('closed');
    expect(hydrated[0].price_header?.current_price).toBeNull();
    expect(hydrated[0].price_header?.close_price).toBe('2038400000');
  });

  it('clears stale live current prices when Binance hydration fails', async () => {
    const staleMarkets = JSON.parse(JSON.stringify(mockMarkets));
    staleMarkets[0].price_header.current_price = '35580000000';
    staleMarkets[1].price_header.current_price = '2335440000';
    staleMarkets[2].price_header.current_price = '155100000';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const hydrated = await hydrateLiveMarketPrices(staleMarkets);

    expect(hydrated[0].price_header?.current_price).toBeNull();
    expect(hydrated[1].price_header?.current_price).toBeNull();
    expect(hydrated[1].price_header?.close_price).toBeNull();
    expect(hydrated[2].price_header?.current_price).toBeNull();
  });

  it('does not fabricate live mock price series current values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:03:00Z'));
    const liveSeries = mockMarketPriceSeries('BTCUSDT', Math.floor(Date.now() / 300_000) * 300, 300);

    expect(liveSeries.status).toBe('live');
    expect(liveSeries.open_price).toBeNull();
    expect(liveSeries.current_price).toBeNull();
    expect(liveSeries.close_price).toBeNull();
    expect(liveSeries.points).toEqual([]);
  });

  it('does not fabricate historical mock price series values for explicit slug rounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:03:00Z'));
    const historicalSeries = mockMarketPriceSeries('BTCUSDT', 1_778_413_500, 300);

    expect(historicalSeries.status).toBe('unavailable');
    expect(historicalSeries.open_price).toBeNull();
    expect(historicalSeries.current_price).toBeNull();
    expect(historicalSeries.close_price).toBeNull();
    expect(historicalSeries.points).toEqual([]);
    expect(JSON.stringify(historicalSeries)).not.toContain('35567280000');
  });

  it('applies websocket ticker updates only to live matching markets', () => {
    const closedEthMarket = {
      ...mockMarkets[1],
      status: 'resolved',
      price_header: {
        ...mockMarkets[1].price_header!,
        current_price: null,
        close_price: '2038400000',
        price_display_state: 'closed' as const
      }
    };
    const liveMarket = applyLiveTickerPriceToMarket(mockMarkets[0], {
      symbol: 'BTCUSDT',
      currentPrice: '80955500000',
      price: '80955500000',
      ts: 1_778_414_500,
      direction: 'up',
      fetchedAt: '2026-05-10T12:05:00.000Z'
    });
    const closedMarket = applyLiveTickerPriceToMarket(closedEthMarket, {
      symbol: 'ETHUSDT',
      currentPrice: '2400000000',
      price: '2400000000',
      ts: 1_778_414_500,
      direction: 'up',
      fetchedAt: '2026-05-10T12:05:00.000Z'
    });

    expect(liveMarket.price_header?.current_price).toBe('80955500000');
    expect(closedMarket.price_header?.current_price).toBeNull();
    expect(closedMarket.price_header?.close_price).toBe('2038400000');
  });

  it('applies websocket ticker updates to a live price series only', () => {
    const series = {
      symbol: 'BTCUSDT',
      start_at: 1_778_414_400,
      end_at: 1_778_414_700,
      duration_seconds: 300,
      status: 'live' as const,
      open_price: '80900000000',
      current_price: '80916000000',
      close_price: null,
      points: [
        { ts: 1_778_414_400, price: '80900000000' },
        { ts: 1_778_414_450, price: '80916000000' }
      ]
    };
    const updated = applyLiveTickerPriceToSeries(series, {
      symbol: 'BTCUSDT',
      currentPrice: '80955500000',
      price: '80955500000',
      ts: 1_778_414_460.345,
      direction: 'up',
      fetchedAt: '2026-05-10T12:05:00.000Z'
    }, 1_778_414_400);

    expect(updated?.current_price).toBe('80955500000');
    expect(updated?.points.at(-1)).toEqual({ ts: 1_778_414_460.345, price: '80955500000' });

    const ignored = applyLiveTickerPriceToSeries({ ...series, status: 'closed' }, {
      symbol: 'BTCUSDT',
      currentPrice: '81000000000',
      price: '81000000000',
      ts: 1_778_414_500,
      direction: 'up',
      fetchedAt: '2026-05-10T12:05:00.000Z'
    }, 1_778_414_400);
    expect(ignored?.current_price).toBe('80916000000');
  });
});
