import type { Market } from '@/lib/api/types';

export type CryptoAsset = 'BTC' | 'ETH' | 'SOL';

export type MarketRouteResolution = {
  marketId: string;
  asset?: CryptoAsset;
  durationSeconds?: number;
  startAt?: number;
};

export type MarketRouteFreshness = {
  explicitRoundRoute: boolean;
  currentLiveStartAt: number | null;
  currentLiveRoute: boolean;
  marketHeaderMatchesRoute: boolean;
  freshLiveRoute: boolean;
  staleLiveRoute: boolean;
};

const slugPattern = /^(btc|eth|sol)-updown-(1|5|15)m-(\d+)$/i;

const marketIdsByAssetDuration: Record<CryptoAsset, Record<number, string>> = {
  BTC: { 60: '11', 300: '1', 900: '4' },
  ETH: { 60: '12', 300: '2', 900: '5' },
  SOL: { 60: '13', 300: '3', 900: '6' }
};

export function parseMarketRouteParam(param: string): MarketRouteResolution {
  const normalized = decodeURIComponent(param).trim();
  const slugMatch = normalized.match(slugPattern);

  if (!slugMatch) {
    return { marketId: normalized };
  }

  const asset = slugMatch[1].toUpperCase() as CryptoAsset;
  const durationSeconds = Number(slugMatch[2]) * 60;
  const startAt = Number(slugMatch[3]);

  return {
    marketId: marketIdsByAssetDuration[asset]?.[durationSeconds] ?? normalized,
    asset,
    durationSeconds,
    startAt
  };
}

export function buildMarketRoundSlug(asset: string, durationSeconds: number, startAt: number) {
  return `${asset.toLowerCase()}-updown-${Math.round(durationSeconds / 60)}m-${startAt}`;
}

export function marketRoundHref(market: Market, startAt?: number) {
  const header = market.price_header;

  if (!header || !isSupportedAsset(header.asset)) {
    return `/markets/${market.market_id}`;
  }

  const roundStartAt = startAt ?? header.start_at;
  return `/markets/${buildMarketRoundSlug(header.asset, header.duration_seconds, roundStartAt)}`;
}

export function liveMarketRoundHref(market: Market, nowMs = Date.now()) {
  const header = market.price_header;

  if (!header) {
    return `/markets/${market.market_id}`;
  }

  return marketRoundHref(market, currentRoundStartAt(header.duration_seconds, nowMs));
}

export function resolveMarketRouteFreshness(
  route: MarketRouteResolution,
  market: Market | null | undefined,
  nowMs = Date.now()
): MarketRouteFreshness {
  const explicitRoundRoute = route.startAt !== undefined && route.durationSeconds !== undefined;
  const currentLiveStartAt = explicitRoundRoute ? currentRoundStartAt(route.durationSeconds!, nowMs) : null;
  const currentLiveRoute = explicitRoundRoute && route.startAt === currentLiveStartAt;
  const header = market?.price_header ?? null;
  const marketHeaderMatchesRoute = Boolean(
    header
      && route.startAt !== undefined
      && route.durationSeconds !== undefined
      && header.start_at === route.startAt
      && header.duration_seconds === route.durationSeconds
      && (route.asset === undefined || header.asset === route.asset)
  );
  const freshLiveRoute = currentLiveRoute && marketHeaderMatchesRoute;

  return {
    explicitRoundRoute,
    currentLiveStartAt,
    currentLiveRoute,
    marketHeaderMatchesRoute,
    freshLiveRoute,
    staleLiveRoute: currentLiveRoute && !marketHeaderMatchesRoute
  };
}

export function currentRoundStartAt(durationSeconds: number, nowMs = Date.now()) {
  const nowTs = Math.floor(nowMs / 1000);
  return Math.floor(nowTs / durationSeconds) * durationSeconds;
}

function isSupportedAsset(asset: string): asset is CryptoAsset {
  return asset === 'BTC' || asset === 'ETH' || asset === 'SOL';
}
