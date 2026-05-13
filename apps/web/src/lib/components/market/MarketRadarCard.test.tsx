import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { mockMarkets } from '@/lib/api/mock';
import MarketRadarCard from './MarketRadarCard';

describe('MarketRadarCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders phase one crypto cards without requesting mini canvas data', () => {
    const canvasSpy = vi.spyOn(api, 'getMarketCanvas');
    const html = mockMarkets.map((market) => renderToStaticMarkup(<MarketRadarCard market={market} />)).join('');

    expect(canvasSpy).not.toHaveBeenCalled();
    expect(html).toContain('BTC 5m Crypto Round');
    expect(html).toContain('ETH 5m Crypto Round');
    expect(html).toContain('SOL 5m Crypto Round');
    expect(html).toContain('BTC 1m Crypto Round');
    expect(html).toContain('ETH 1m Crypto Round');
    expect(html).toContain('SOL 1m Crypto Round');
    expect(html).toContain('BTCUSDT');
    expect(html).toContain('ETHUSDT');
    expect(html).toContain('SOLUSDT');
    expect(html).toContain('UP');
    expect(html).toContain('DOWN');
    expect(html).toContain('Vol.');
    expect(html).not.toContain('viewBox="0 0 1200 630"');
    expect(html).not.toContain('Open field');
  });

  it('renders multi-outcome and non-price-header markets in the compact market card layout', () => {
    const multiOutcomeMarket = {
      ...mockMarkets[0],
      price_header: null,
      question_hash: '2026 NBA Champion',
      outcomes: [
        { outcome_id: 0, label: 'Oklahoma City Thunder', total_stake: '60000000', total_reward_shares: '60000000', current_odds: '600000' },
        { outcome_id: 1, label: 'San Antonio Spurs', total_stake: '20000000', total_reward_shares: '20000000', current_odds: '200000' },
        { outcome_id: 2, label: 'Boston Celtics', total_stake: '12000000', total_reward_shares: '12000000', current_odds: '120000' }
      ]
    };

    const html = renderToStaticMarkup(<MarketRadarCard market={multiOutcomeMarket} />);

    expect(html).toContain('2026 NBA Champion');
    expect(html).toContain('Oklahoma City Thunder');
    expect(html).toContain('San Antonio Spurs');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
    expect(html).toContain('Market');
  });
});
