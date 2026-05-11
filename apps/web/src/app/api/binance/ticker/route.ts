import { NextResponse } from 'next/server';

const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
const SUPPORTED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

type BinanceTickerPayload = {
  symbol?: unknown;
  price?: unknown;
};

function normalizeSymbols(rawSymbols: string | null) {
  return Array.from(
    new Set(
      (rawSymbols ?? '')
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => SUPPORTED_SYMBOLS.has(symbol))
    )
  );
}

function normalizeTickerPayload(payload: unknown) {
  const tickers = Array.isArray(payload) ? payload : [payload];
  return tickers.flatMap((item) => {
    const ticker = item as BinanceTickerPayload;
    if (typeof ticker.symbol !== 'string' || typeof ticker.price !== 'string') {
      return [];
    }
    if (!SUPPORTED_SYMBOLS.has(ticker.symbol)) {
      return [];
    }
    return [{ symbol: ticker.symbol, price: ticker.price }];
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = normalizeSymbols(searchParams.get('symbols'));

  if (symbols.length === 0) {
    return NextResponse.json({ prices: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL('/api/v3/ticker/price', BINANCE_SPOT_BASE_URL);
  url.searchParams.set('symbols', JSON.stringify(symbols));

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'binance_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { prices: normalizeTickerPayload(await response.json()) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
