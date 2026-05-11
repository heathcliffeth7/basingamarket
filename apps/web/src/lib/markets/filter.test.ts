import { describe, expect, it } from 'vitest';
import { mockMarkets } from '../api/mock';
import type { Market } from '../api/types';
import { filterMarketsForView, normalizeMarketCategory } from './filter';

const sportsMarket: Market = {
  ...mockMarkets[0],
  market_id: '99',
  question_hash: 'Sports weekly sentiment market',
  price_header: null
};

describe('market filters', () => {
  it('normalizes only the crypto category query value', () => {
    expect(normalizeMarketCategory('crypto')).toBe('crypto');
    expect(normalizeMarketCategory('Crypto')).toBe('crypto');
    expect(normalizeMarketCategory('sports')).toBeNull();
  });

  it('filters category=crypto down to BTC ETH and SOL phase one 5m and 1m markets', () => {
    const visible = filterMarketsForView({
      markets: [...mockMarkets, sportsMarket],
      filter: 'movers',
      search: '',
      category: 'crypto',
      mockFallbackEnabled: false
    });

    expect(visible.map((market) => market.question_hash)).toEqual([
      'BTC 5m Crypto Round',
      'ETH 5m Crypto Round',
      'SOL 5m Crypto Round',
      'BTC 1m Crypto Round',
      'ETH 1m Crypto Round',
      'SOL 1m Crypto Round'
    ]);
  });

  it('recognizes seeded crypto markets even before live price headers hydrate', () => {
    const seededMarkets = mockMarkets.map((market) => ({
      ...market,
      price_header: null
    }));
    const visible = filterMarketsForView({
      markets: [...seededMarkets, sportsMarket],
      filter: 'movers',
      search: 'eth',
      category: 'crypto',
      mockFallbackEnabled: false
    });

    expect(visible.map((market) => market.question_hash)).toEqual([
      'ETH 5m Crypto Round',
      'ETH 1m Crypto Round'
    ]);
  });
});
