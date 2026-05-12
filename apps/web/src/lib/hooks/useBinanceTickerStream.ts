'use client';

import { useEffect, useMemo, useRef } from 'react';
import { decimalPriceToScaledString, type LiveTickerUpdate } from '@/lib/api/livePrices';
import type { Market } from '@/lib/api/types';

const BINANCE_STREAM_BASE_URL = 'wss://stream.binance.com:9443/stream?streams=';
export const BINANCE_STREAM_FLUSH_INTERVAL_MS = 125;

type BinanceStreamPayload = {
  stream?: unknown;
  data?: {
    e?: unknown;
    E?: unknown;
    s?: unknown;
    p?: unknown;
    c?: unknown;
    T?: unknown;
  };
};

export function parseBinanceStreamMessage(
  rawMessage: string,
  previousPrice?: string
): LiveTickerUpdate | null {
  try {
    const message = JSON.parse(rawMessage) as BinanceStreamPayload;
    const symbol = message.data?.s;
    const eventType = message.data?.e;
    const rawPrice = eventType === 'trade' || eventType === 'aggTrade' ? message.data?.p : message.data?.c;
    const rawTs = typeof message.data?.T === 'number' ? message.data.T : message.data?.E;

    if (typeof symbol !== 'string' || typeof rawPrice !== 'string') {
      return null;
    }

    const currentPrice = decimalPriceToScaledString(rawPrice);
    return {
      symbol,
      currentPrice,
      price: currentPrice,
      ts: typeof rawTs === 'number' ? rawTs / 1000 : Date.now() / 1000,
      direction: priceDirection(previousPrice, currentPrice),
      fetchedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function useBinanceTickerStream(
  markets: Market[] | null | undefined,
  onUpdate: (update: LiveTickerUpdate) => void,
  onStatusChange?: (status: 'connecting' | 'live' | 'offline') => void
) {
  const lastPricesRef = useRef(new Map<string, string>());
  const lastTimestampsRef = useRef(new Map<string, number>());
  const queuedUpdatesRef = useRef(new Map<string, LiveTickerUpdate>());
  const flushTimerRef = useRef<number | null>(null);
  const lastFlushRef = useRef(0);
  const streamPath = useMemo(() => buildBinanceStreamPath(markets), [markets]);

  useEffect(() => {
    if (!streamPath) {
      return;
    }

    onStatusChange?.('connecting');
    function flushQueuedUpdates() {
      flushTimerRef.current = null;
      lastFlushRef.current = performance.now();
      const updates = flushLatestUpdates(queuedUpdatesRef.current);
      for (const update of updates) {
        onUpdate(update);
      }
    }

    function scheduleFlush() {
      const waitMs = nextBufferedFlushDelay(performance.now(), lastFlushRef.current);
      if (waitMs === 0) {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushQueuedUpdates();
        return;
      }

      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flushQueuedUpdates, waitMs);
      }
    }

    const socket = new WebSocket(`${BINANCE_STREAM_BASE_URL}${streamPath}`);
    socket.onopen = () => onStatusChange?.('live');
    socket.onclose = () => onStatusChange?.('offline');
    socket.onerror = () => onStatusChange?.('offline');
    socket.onmessage = (event) => {
      const raw = String(event.data);
      const symbol = readSymbol(raw);
      const update = parseBinanceStreamMessage(raw, symbol ? lastPricesRef.current.get(symbol) : undefined);
      if (update) {
        const previousTimestamp = lastTimestampsRef.current.get(update.symbol) ?? 0;
        if (update.ts < previousTimestamp) {
          return;
        }
        lastTimestampsRef.current.set(update.symbol, update.ts);
        lastPricesRef.current.set(update.symbol, update.currentPrice);
        queueLatestUpdate(queuedUpdatesRef.current, update);
        scheduleFlush();
      }
    };

    return () => {
      socket.close();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      queuedUpdatesRef.current.clear();
    };
  }, [onStatusChange, onUpdate, streamPath]);
}

export function buildBinanceStreamPath(markets: Market[] | null | undefined) {
  const symbols = Array.from(
    new Set(
      (markets ?? []).flatMap((market) => {
        const header = market.price_header;
        return header?.price_display_state === 'live' && header.symbol ? [header.symbol.toLowerCase()] : [];
      })
    )
  ).sort();

  return symbols.map((symbol) => `${symbol}@aggTrade`).join('/');
}

export function nextBufferedFlushDelay(
  nowMs: number,
  lastFlushMs: number,
  intervalMs = BINANCE_STREAM_FLUSH_INTERVAL_MS
) {
  return Math.max(intervalMs - (nowMs - lastFlushMs), 0);
}

export function queueLatestUpdate(queue: Map<string, LiveTickerUpdate>, update: LiveTickerUpdate) {
  queue.set(update.symbol, update);
}

export function flushLatestUpdates(queue: Map<string, LiveTickerUpdate>) {
  const updates = [...queue.values()];
  queue.clear();
  return updates;
}

function readSymbol(rawMessage: string) {
  try {
    const message = JSON.parse(rawMessage) as BinanceStreamPayload;
    return typeof message.data?.s === 'string' ? message.data.s : null;
  } catch {
    return null;
  }
}

function priceDirection(previousPrice: string | undefined, nextPrice: string): LiveTickerUpdate['direction'] {
  if (!previousPrice) {
    return 'flat';
  }
  const previous = BigInt(previousPrice);
  const next = BigInt(nextPrice);
  if (next > previous) return 'up';
  if (next < previous) return 'down';
  return 'flat';
}
