import { describe, expect, it } from 'vitest';
import { mockMarkets } from '@/lib/api/mock';
import {
  buildBinanceStreamPath,
  flushLatestUpdates,
  nextBufferedFlushDelay,
  parseBinanceStreamMessage,
  queueLatestUpdate
} from './useBinanceTickerStream';

describe('useBinanceTickerStream message parsing', () => {
  it('builds aggTrade-only streams for live markets', () => {
    const btc = {
      ...mockMarkets[0],
      price_header: {
        ...mockMarkets[0].price_header!,
        symbol: 'BTCUSDT',
        price_display_state: 'live' as const
      }
    };
    const eth = {
      ...mockMarkets[1],
      price_header: {
        ...mockMarkets[1].price_header!,
        symbol: 'ETHUSDT',
        price_display_state: 'live' as const
      }
    };

    expect(buildBinanceStreamPath([eth, btc])).toBe('btcusdt@aggTrade/ethusdt@aggTrade');
  });

  it('keeps only the latest queued update per symbol between throttled flushes', () => {
    const queue = new Map();
    queueLatestUpdate(queue, liveUpdate('BTCUSDT', '80800000000', 100));
    queueLatestUpdate(queue, liveUpdate('ETHUSDT', '3100000000', 101));
    queueLatestUpdate(queue, liveUpdate('BTCUSDT', '80810000000', 102));

    expect(nextBufferedFlushDelay(1_000, 900)).toBe(25);
    expect(nextBufferedFlushDelay(1_000, 800)).toBe(0);
    expect(flushLatestUpdates(queue)).toMatchObject([
      { symbol: 'BTCUSDT', currentPrice: '80810000000', ts: 102 },
      { symbol: 'ETHUSDT', currentPrice: '3100000000', ts: 101 }
    ]);
    expect(queue.size).toBe(0);
  });

  it('parses raw Binance trade messages with fractional timestamps', () => {
    const update = parseBinanceStreamMessage(JSON.stringify({
      stream: 'btcusdt@trade',
      data: {
        e: 'trade',
        E: 1_778_414_501_124,
        s: 'BTCUSDT',
        p: '80955.50000000',
        T: 1_778_414_501_123
      }
    }), '80900');

    expect(update).toMatchObject({
      symbol: 'BTCUSDT',
      currentPrice: '80955500000',
      price: '80955500000',
      ts: 1_778_414_501.123,
      direction: 'up'
    });
  });

  it('parses Binance aggTrade messages into fixed-scale live updates', () => {
    const update = parseBinanceStreamMessage(JSON.stringify({
      stream: 'btcusdt@aggTrade',
      data: {
        e: 'aggTrade',
        E: 1_778_414_501_001,
        s: 'BTCUSDT',
        p: '80955.50000000',
        T: 1_778_414_501_001
      }
    }), '80900');

    expect(update).toMatchObject({
      symbol: 'BTCUSDT',
      currentPrice: '80955500000',
      price: '80955500000',
      ts: 1_778_414_501.001,
      direction: 'up'
    });
  });

  it('keeps ticker messages as websocket fallback', () => {
    const update = parseBinanceStreamMessage(JSON.stringify({
      stream: 'solusdt@ticker',
      data: {
        e: '24hrTicker',
        E: 1_778_414_501_000,
        s: 'SOLUSDT',
        p: '-1.23100000',
        c: '155.12345678'
      }
    }), '156000000');

    expect(update).toMatchObject({
      symbol: 'SOLUSDT',
      currentPrice: '155123456',
      direction: 'down'
    });
  });
});

function liveUpdate(symbol: string, currentPrice: string, ts: number) {
  return {
    symbol,
    currentPrice,
    price: currentPrice,
    ts,
    direction: 'flat' as const,
    fetchedAt: new Date(0).toISOString()
  };
}
