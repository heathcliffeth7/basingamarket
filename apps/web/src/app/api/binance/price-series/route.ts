import { NextResponse } from 'next/server';

const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
const SUPPORTED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
const SUPPORTED_DURATIONS = new Set([60, 300, 900]);
const PRICE_DECIMALS = 6;

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

type BinanceAggTrade = {
  T?: unknown;
  p?: unknown;
};

type PricePoint = {
  ts: number;
  price: string;
};

function readPositiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function decimalPriceToScaledString(price: string) {
  const trimmed = price.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error(`Invalid decimal price: ${price}`);
  }

  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(PRICE_DECIMALS, '0').slice(0, PRICE_DECIMALS);
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
}

function intervalForDuration(durationSeconds: number) {
  if (durationSeconds === 60) return '1m';
  return durationSeconds === 300 ? '5m' : '15m';
}

function normalizeKline(payload: unknown, expectedOpenTimeMs: number) {
  const firstKline = Array.isArray(payload) ? payload[0] : null;

  if (!Array.isArray(firstKline) || firstKline.length < 7) {
    return null;
  }

  const kline = firstKline as BinanceKline;
  if (kline[0] !== expectedOpenTimeMs || typeof kline[1] !== 'string' || typeof kline[4] !== 'string') {
    return null;
  }

  return {
    open_time_ms: kline[0],
    close_time_ms: kline[6],
    open: decimalPriceToScaledString(kline[1]),
    close: decimalPriceToScaledString(kline[4])
  };
}

async function fetchKline(symbol: string, durationSeconds: number, startAt: number) {
  const url = new URL('/api/v3/klines', BINANCE_SPOT_BASE_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', intervalForDuration(durationSeconds));
  url.searchParams.set('startTime', String(startAt * 1000));
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    return null;
  }

  return normalizeKline(await response.json(), startAt * 1000);
}

async function fetchTicker(symbol: string) {
  const url = new URL('/api/v3/ticker/price', BINANCE_SPOT_BASE_URL);
  url.searchParams.set('symbol', symbol);

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { price?: unknown };
  return typeof payload.price === 'string' ? decimalPriceToScaledString(payload.price) : null;
}

async function fetchAggTradePoints(symbol: string, startAt: number, endAt: number) {
  const nowMs = Date.now();
  const startTime = startAt * 1000;
  const endTime = Math.min(endAt * 1000 - 1, nowMs);

  if (endTime <= startTime) {
    return [];
  }

  const url = new URL('/api/v3/aggTrades', BINANCE_SPOT_BASE_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', '1000');

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((item) => {
    const trade = item as BinanceAggTrade;
    if (typeof trade.T !== 'number' || typeof trade.p !== 'string') {
      return [];
    }

    try {
      return [{ ts: Math.floor(trade.T / 1000), price: decimalPriceToScaledString(trade.p) }];
    } catch {
      return [];
    }
  });
}

function downsample(points: PricePoint[], maxPoints = 180) {
  if (points.length <= maxPoints) {
    return points;
  }

  return Array.from({ length: maxPoints }, (_, index) => {
    const pointIndex = Math.round((index * (points.length - 1)) / (maxPoints - 1));
    return points[pointIndex];
  });
}

function compactPoints(points: PricePoint[]) {
  const byTimestamp = new Map<number, PricePoint>();
  for (const point of points) {
    byTimestamp.set(point.ts, point);
  }
  return downsample([...byTimestamp.values()].sort((a, b) => a.ts - b.ts));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
  const startAt = readPositiveInteger(searchParams.get('startTs'));
  const durationSeconds = readPositiveInteger(searchParams.get('duration')) ?? 300;

  if (!SUPPORTED_SYMBOLS.has(symbol) || startAt === null || !SUPPORTED_DURATIONS.has(durationSeconds)) {
    return NextResponse.json({ error: 'invalid_price_series_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const endAt = startAt + durationSeconds;
  const nowTs = Math.floor(Date.now() / 1000);
  const closed = nowTs >= endAt;
  const kline = await fetchKline(symbol, durationSeconds, startAt);

  if (!kline) {
    return NextResponse.json({ error: 'price_series_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  const [currentPrice, tradePoints] = await Promise.all([
    closed ? Promise.resolve(null) : fetchTicker(symbol),
    fetchAggTradePoints(symbol, startAt, endAt)
  ]);
  const terminalPoint = closed
    ? { ts: endAt, price: kline.close }
    : currentPrice
      ? { ts: Math.min(nowTs, endAt), price: currentPrice }
      : null;
  const points = compactPoints([
    { ts: startAt, price: kline.open },
    ...tradePoints,
    ...(terminalPoint ? [terminalPoint] : [])
  ]);

  return NextResponse.json(
    {
      symbol,
      start_at: startAt,
      end_at: endAt,
      duration_seconds: durationSeconds,
      status: closed ? 'closed' : 'live',
      open_price: kline.open,
      current_price: closed ? null : currentPrice,
      close_price: closed ? kline.close : null,
      points
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
