import type { Market, MarketPriceSeries } from './types';

type BinanceTicker = {
  symbol: string;
  price: string;
};

type BinanceTickerResponse = {
  prices?: BinanceTicker[];
};

type BinanceKlineResponse = {
  symbol?: string;
  interval?: string;
  open_time_ms?: number;
  close_time_ms?: number;
  open?: string;
  close?: string;
};

const PRICE_DECIMALS = 6;

export type LiveTickerUpdate = {
  symbol: string;
  currentPrice: string;
  price: string;
  ts: number;
  direction: 'up' | 'down' | 'flat';
  fetchedAt: string;
};

export function decimalPriceToScaledString(price: string) {
  const trimmed = price.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error(`Invalid decimal price: ${price}`);
  }

  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(PRICE_DECIMALS, '0').slice(0, PRICE_DECIMALS);
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
}

export async function fetchLiveTickerPrices(symbols: string[]) {
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));

  if (uniqueSymbols.length === 0) {
    return {};
  }

  const response = await fetch(`/api/binance/ticker?symbols=${encodeURIComponent(uniqueSymbols.join(','))}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Binance ticker proxy ${response.status}`);
  }

  const body = (await response.json()) as BinanceTickerResponse;
  const prices: Record<string, string> = {};

  for (const ticker of body.prices ?? []) {
    prices[ticker.symbol] = decimalPriceToScaledString(ticker.price);
  }

  return prices;
}

function currentRoundWindow(durationSeconds: number) {
  const nowTs = Math.floor(Date.now() / 1000);
  const startAt = Math.floor(nowTs / durationSeconds) * durationSeconds;
  return {
    roundId: String(Math.floor(nowTs / durationSeconds)),
    startAt,
    endAt: startAt + durationSeconds
  };
}

async function fetchCurrentRoundOpenPrice(symbol: string, interval: string, startAt: number) {
  const search = new URLSearchParams({ symbol, interval, startTs: String(startAt) });
  const response = await fetch(`/api/binance/kline?${search.toString()}`, { cache: 'no-store' });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as BinanceKlineResponse;
  return typeof body.open === 'string' ? decimalPriceToScaledString(body.open) : null;
}

export async function hydrateLiveMarketPrices(markets: Market[]) {
  const liveMarkets = markets.flatMap((market, index) => {
    const header = market.price_header;
    return header?.price_display_state === 'live' && header.symbol
      ? [{ index, header, window: currentRoundWindow(header.duration_seconds) }]
      : [];
  });
  const liveSymbols = liveMarkets.map((market) => market.header.symbol);

  if (liveSymbols.length === 0) {
    return markets;
  }

  try {
    const prices = await fetchLiveTickerPrices(liveSymbols);
    const fetchedAt = new Date().toISOString();
    const openPrices = new Map<string, string>();

    await Promise.all(
      liveMarkets.map(async ({ header, window }) => {
        const openPrice = await fetchCurrentRoundOpenPrice(header.symbol, header.duration_seconds === 300 ? '5m' : `${header.duration_seconds / 60}m`, window.startAt);
        if (openPrice) {
          openPrices.set(`${header.symbol}:${window.startAt}`, openPrice);
        }
      })
    );
    const liveMarketByIndex = new Map(liveMarkets.map((market) => [market.index, market]));

    return markets.map((market, index) => {
      const header = market.price_header;
      const liveMarket = liveMarketByIndex.get(index);
      if (!header || !liveMarket) {
        return market;
      }

      const currentPrice = prices[header.symbol];
      if (!currentPrice) {
        return withoutStaleLiveCurrentPrice(market);
      }

      const { window } = liveMarket;
      const openPrice = openPrices.get(`${header.symbol}:${window.startAt}`) ?? header.open_price;

      return {
        ...market,
        price_header: {
          ...header,
          round_id: window.roundId,
          start_at: window.startAt,
          end_at: window.endAt,
          open_price: openPrice,
          current_price: currentPrice,
          fetched_at: fetchedAt
        }
      };
    });
  } catch {
    return markets.map(withoutStaleLiveCurrentPrice);
  }
}

function withoutStaleLiveCurrentPrice(market: Market) {
  const header = market.price_header;
  if (!header || header.price_display_state !== 'live') {
    return market;
  }

  return {
    ...market,
    price_header: {
      ...header,
      current_price: null
    }
  };
}

export function applyLiveTickerPriceToMarket(market: Market, update: LiveTickerUpdate) {
  const header = market.price_header;
  if (!header || header.price_display_state !== 'live' || header.symbol !== update.symbol) {
    return market;
  }

  return {
    ...market,
    price_header: {
      ...header,
      current_price: update.currentPrice,
      fetched_at: update.fetchedAt
    }
  };
}

export function applyLiveTickerPriceToSeries(
  series: MarketPriceSeries | undefined,
  update: LiveTickerUpdate,
  liveStartAt: number | undefined
) {
  if (!series || series.symbol !== update.symbol || series.status !== 'live' || series.start_at !== liveStartAt) {
    return series;
  }

  const lastPoint = series.points.at(-1);
  if (lastPoint && update.ts < lastPoint.ts) {
    return series;
  }

  const nextPoint = {
    ts: Math.min(Math.max(update.ts, series.start_at), series.end_at),
    price: update.currentPrice
  };
  const previousPoints = series.points.filter((point) => point.ts < nextPoint.ts);
  const mergedPoints = [...previousPoints, nextPoint].slice(-240);

  return {
    ...series,
    current_price: update.currentPrice,
    points: mergedPoints.length > 0 ? mergedPoints : [nextPoint]
  };
}

export function applyLiveTickerPriceToMarkets(markets: Market[] | undefined, update: LiveTickerUpdate) {
  return markets?.map((market) => applyLiveTickerPriceToMarket(market, update));
}
