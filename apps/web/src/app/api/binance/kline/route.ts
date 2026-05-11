import { NextResponse } from 'next/server';

const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
const SUPPORTED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
const SUPPORTED_INTERVALS = new Set(['1m', '5m', '15m']);

function readPositiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function normalizeKlinePayload(payload: unknown, expectedOpenTimeMs: number) {
  const firstKline = Array.isArray(payload) ? payload[0] : null;
  if (!Array.isArray(firstKline) || firstKline.length < 7) {
    return null;
  }

  const [openTime, open, high, low, close, volume, closeTime] = firstKline;
  if (openTime !== expectedOpenTimeMs || typeof open !== 'string' || typeof close !== 'string') {
    return null;
  }

  return { open_time_ms: openTime, close_time_ms: closeTime, open, high, low, close, volume };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
  const interval = (searchParams.get('interval') ?? '5m').trim();
  const startTs = readPositiveInteger(searchParams.get('startTs'));

  if (!SUPPORTED_SYMBOLS.has(symbol) || !SUPPORTED_INTERVALS.has(interval) || startTs === null) {
    return NextResponse.json({ error: 'invalid_kline_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const startTimeMs = startTs * 1000;
  const url = new URL('/api/v3/klines', BINANCE_SPOT_BASE_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(startTimeMs));
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'binance_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  const kline = normalizeKlinePayload(await response.json(), startTimeMs);
  if (!kline) {
    return NextResponse.json({ error: 'kline_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ symbol, interval, ...kline }, { headers: { 'Cache-Control': 'no-store' } });
}
