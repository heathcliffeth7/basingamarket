import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mockMarkets } from '@/lib/api/mock';
import MarketStatusBar from './MarketStatusBar';

describe('MarketStatusBar', () => {
  it('renders the asset logo to the left of the title', () => {
    const html = renderToStaticMarkup(<MarketStatusBar market={mockMarkets[1]} />);

    expect(html).toContain('src="/visuals/crypto/eth.svg"');
    expect(html).toContain('alt="ETH market"');
    expect(html.indexOf('src="/visuals/crypto/eth.svg"')).toBeLessThan(html.indexOf('ETH 5m Crypto Round'));
  });
});
