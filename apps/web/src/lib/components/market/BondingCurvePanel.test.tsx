import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { mockCurves, mockMarkets } from '@/lib/api/mock';
import BondingCurvePanel from './BondingCurvePanel';

describe('BondingCurvePanel', () => {
  const mountedRoots: Root[] = [];

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.length = 0;
    document.body.innerHTML = '';
  });

  it('renders UP and DOWN curve lines with metric fields', () => {
    const html = renderToStaticMarkup(<BondingCurvePanel curve={mockCurves['1']} market={mockMarkets[0]} />);

    expect(html).toContain('UP / DOWN token price');
    expect(html).toContain('Virtual MC');
    expect(html).toContain('Liquidity');
    expect(html).toContain('Volume');
    expect(html).toContain('UP');
    expect(html).toContain('DOWN');
    expect(html).toContain('data-curve-line="UP"');
    expect(html).toContain('data-curve-line="DOWN"');
  });

  it('renders market header prices inside the curve panel', () => {
    const liveHtml = renderToStaticMarkup(<BondingCurvePanel curve={mockCurves['1']} market={mockMarkets[0]} />);
    const closedMarket: typeof mockMarkets[number] = {
      ...mockMarkets[1],
      price_header: mockMarkets[1].price_header
        ? {
            ...mockMarkets[1].price_header,
            close_price: '2031250000',
            current_price: null,
            price_display_state: 'closed' as const
          }
        : null
    };
    const closedHtml = renderToStaticMarkup(<BondingCurvePanel curve={mockCurves['2']} market={closedMarket} />);

    expect(liveHtml).toContain('src="/visuals/crypto/btc.svg"');
    expect(liveHtml).toContain('BTC 5m');
    expect(liveHtml).toContain('BTCUSDT');
    expect(liveHtml).toContain('Open');
    expect(liveHtml).toContain('Now');

    expect(closedHtml).toContain('src="/visuals/crypto/eth.svg"');
    expect(closedHtml).toContain('ETH 5m');
    expect(closedHtml).toContain('ETHUSDT');
    expect(closedHtml).toContain('Close');
    expect(closedHtml).not.toContain('Now');
  });

  it('filters the chart down to only UP or DOWN', () => {
    const { container } = mount(<BondingCurvePanel curve={mockCurves['1']} market={mockMarkets[0]} />);

    expect(container.querySelector('[data-curve-line="UP"]')).not.toBeNull();
    expect(container.querySelector('[data-curve-line="DOWN"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="curve-filter-up"]')?.click();
    });
    expect(container.querySelector('[data-curve-line="UP"]')).not.toBeNull();
    expect(container.querySelector('[data-curve-line="DOWN"]')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="curve-filter-down"]')?.click();
    });
    expect(container.querySelector('[data-curve-line="UP"]')).toBeNull();
    expect(container.querySelector('[data-curve-line="DOWN"]')).not.toBeNull();
  });

  function mount(element: ReactElement) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() => root.render(element));
    return { container, root };
  }
});
