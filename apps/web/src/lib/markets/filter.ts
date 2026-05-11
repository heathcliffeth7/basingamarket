import type { Market } from '../api/types';

export type FilterMode = 'movers' | 'open' | 'closing' | 'resolved' | 'demo';
export type MarketCategory = 'crypto' | null;

const cryptoAssets = new Set(['BTC', 'ETH', 'SOL']);
const phaseOneDurations = new Set([60, 300]);

export function normalizeMarketCategory(value: string | null | undefined): MarketCategory {
  return value?.trim().toLowerCase() === 'crypto' ? 'crypto' : null;
}

export function isPhaseOneCryptoMarket(market: Market) {
  const headerAsset = market.price_header?.asset?.toUpperCase();
  const durationSeconds = market.price_header?.duration_seconds;
  if (
    headerAsset &&
    cryptoAssets.has(headerAsset) &&
    durationSeconds !== undefined &&
    phaseOneDurations.has(durationSeconds)
  ) {
    return true;
  }

  const question = market.question_hash.toUpperCase();
  return [...cryptoAssets].some((asset) =>
    [...phaseOneDurations].some((duration) =>
      question.includes(`${asset} ${duration / 60}M CRYPTO ROUND`)
    )
  );
}

export function filterMarketsForView({
  markets,
  filter,
  search,
  category,
  mockFallbackEnabled,
  nowMs = Date.now()
}: {
  markets: Market[];
  filter: FilterMode;
  search: string;
  category: MarketCategory;
  mockFallbackEnabled: boolean;
  nowMs?: number;
}) {
  const normalizedSearch = search.trim().toLowerCase();

  return markets
    .filter((market) => category !== 'crypto' || isPhaseOneCryptoMarket(market))
    .filter((market) => {
      if (filter === 'demo') return mockFallbackEnabled;
      if (filter === 'resolved') return market.status === 'resolved';
      if (filter === 'closing') return market.status === 'open' && market.trade_until * 1000 - nowMs < 86400000 * 3;
      if (filter === 'open') return market.status === 'open';
      return true;
    })
    .filter((market) => {
      if (!normalizedSearch) return true;
      const searchable = [
        market.question_hash,
        market.status,
        market.price_header?.asset,
        market.price_header?.symbol,
        ...market.outcomes.map((outcome) => outcome.label)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(normalizedSearch);
    });
}
