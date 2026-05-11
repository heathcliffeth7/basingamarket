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
    expect(html).toContain('Open market');
    expect(html).not.toContain('viewBox="0 0 1200 630"');
    expect(html).not.toContain('Open field');
  });
});
