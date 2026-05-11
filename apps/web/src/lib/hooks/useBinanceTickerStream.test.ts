import { describe, expect, it } from 'vitest';
import { parseBinanceStreamMessage } from './useBinanceTickerStream';

describe('useBinanceTickerStream message parsing', () => {
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
