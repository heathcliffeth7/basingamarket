import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockCurves, mockMarkets } from '@/lib/api/mock';
import type { Market, MarketCurve, MarketPriceSeries } from '@/lib/api/types';
import { formatEtRoundWindow } from '@/lib/markets/time';
import AssetPriceChartPanel from './AssetPriceChartPanel';

const liveStartAt = Math.floor(Date.now() / 300_000) * 300;

function marketWithRound(status: 'live' | 'closed'): Market {
  const base = mockMarkets[0];
  return {
    ...base,
    status: status === 'live' ? 'open' : 'resolved',
    price_header: {
      ...base.price_header!,
      start_at: liveStartAt,
      end_at: liveStartAt + 300,
      round_id: String(Math.floor(liveStartAt / 300)),
      open_price: '80797280000',
      current_price: status === 'live' ? '80815450000' : null,
      close_price: status === 'closed' ? '80797280000' : null,
      price_display_state: status
    }
  };
}

function series(status: 'live' | 'closed'): MarketPriceSeries {
  return {
    symbol: 'BTCUSDT',
    start_at: liveStartAt,
    end_at: liveStartAt + 300,
    duration_seconds: 300,
    status,
    open_price: '80797280000',
    current_price: status === 'live' ? '80815450000' : null,
    close_price: status === 'closed' ? '80797280000' : null,
    points: [
      { ts: liveStartAt, price: '80797280000' },
      { ts: liveStartAt + 120, price: '80825450000' },
      { ts: liveStartAt + 300, price: status === 'live' ? '80815450000' : '80797280000' }
    ]
  };
}

function curveWithPrices(marketId: string, upPrice: string, downPrice: string): MarketCurve {
  const curve = mockCurves[marketId];
  return {
    ...curve,
    sides: curve.sides.map((side) => ({
      ...side,
      price: side.side === 'UP' ? upPrice : downPrice,
      best_entry_price: side.side === 'UP' ? upPrice : downPrice
    }))
  };
}

function optimisticLiveMarket(): Market {
  const base = marketWithRound('live');
  return {
    ...base,
    price_header: {
      ...base.price_header!,
      open_price: null,
      current_price: null,
      close_price: null
    }
  };
}

describe('AssetPriceChartPanel', () => {
  const mountedRoots: Root[] = [];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.length = 0;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders live price header and one asset price line', () => {
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={marketWithRound('live')}
        series={series('live')}
        selectedStartAt={liveStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive
      />
    );

    expect(html).toContain('BTC Up or Down 5m');
    expect(html).toContain('Price To Beat');
    expect(html).toContain('Current Price');
    expect(html).toContain('data-testid="animated-price-readout"');
    expect(html).toContain('data-price-lead="up"');
    expect(html).toContain('data-price-direction="up"');
    expect(html).toContain('number-flow-react');
    expect(html).toContain('data-testid="asset-price-chart"');
    expect(html).toContain('data-testid="market-switcher-trigger"');
    expect(html).toContain('aria-label="Round countdown"');
    expect(html).toContain('BTC · 5 Min');
    expect(html).not.toContain('aria-label="Market actions"');
    expect(html).not.toContain('lucide-code');
    expect(html).not.toContain('lucide-link');
    expect(html).not.toContain('lucide-bookmark');
    expect(html).not.toContain('UP / DOWN token price');
    expect(html).not.toContain('Go to live market');
  });

  it('keeps the current price tone yellow inside the neutral price band', () => {
    const neutralMarket = {
      ...marketWithRound('live'),
      price_header: {
        ...marketWithRound('live').price_header!,
        current_price: '80799280000'
      }
    };
    const neutralSeries = {
      ...series('live'),
      current_price: '80799280000',
      points: [
        { ts: liveStartAt, price: '80797280000' },
        { ts: liveStartAt + 120, price: '80799280000' }
      ]
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={neutralMarket}
        series={neutralSeries}
        selectedStartAt={liveStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive
      />
    );

    expect(html).toContain('data-price-lead="neutral"');
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('text-market-warning');
    expect(html).toContain('bg-market-warning');
  });

  it('colors historical chart and go-live dot red when DOWN leads', () => {
    const selectedHistoricalStartAt = liveStartAt - 300;
    const downSeries: MarketPriceSeries = {
      ...series('closed'),
      start_at: selectedHistoricalStartAt,
      end_at: selectedHistoricalStartAt + 300,
      close_price: '80795270000',
      points: [
        { ts: selectedHistoricalStartAt, price: '80797280000' },
        { ts: selectedHistoricalStartAt + 120, price: '80796270000' },
        { ts: selectedHistoricalStartAt + 300, price: '80795270000' }
      ]
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={marketWithRound('closed')}
        series={downSeries}
        selectedStartAt={selectedHistoricalStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive={false}
      />
    );

    expect(html).toContain('data-price-lead="down"');
    expect(html).toContain('data-tone="down"');
    expect(html).toContain('data-testid="asset-price-chart"');
    expect(html).toContain('bg-market-negative');
  });

  it('hydrates a live countdown without a recoverable mismatch when the client clock moves ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime((liveStartAt + 42) * 1000);

    const element = (
      <AssetPriceChartPanel
        market={marketWithRound('live')}
        series={series('live')}
        selectedStartAt={liveStartAt}
        liveHref={`/markets/btc-updown-5m-${liveStartAt}`}
        viewingLive
      />
    );
    const serverHtml = renderToString(element);
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();

    vi.setSystemTime((liveStartAt + 48) * 1000);

    await act(async () => {
      const root = hydrateRoot(container, element, { onRecoverableError });
      mountedRoots.push(root);
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it('expires a live round locally after mount at 00:00 and links to the new live round', () => {
    vi.useFakeTimers();
    vi.setSystemTime((liveStartAt + 301) * 1000);

    const { container } = mount(
      <AssetPriceChartPanel
        market={marketWithRound('live')}
        series={series('live')}
        selectedStartAt={liveStartAt}
        liveHref={`/markets/btc-updown-5m-${liveStartAt}`}
        viewingLive
      />
    );

    expect(container.textContent).toContain('Final price');
    expect(container.textContent).toContain('Go to live market');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="go-live-market"]')?.getAttribute('href')).toBe(`/markets/btc-updown-5m-${liveStartAt + 300}`);
    expect(container.querySelector('[data-testid="asset-price-chart"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Round countdown"]')).toBeNull();
    expect(container.querySelector('[data-testid="go-live-market-dot-ping"]')).not.toBeNull();
  });

  it('calls the go-live cleanup callback from the CTA', () => {
    vi.useFakeTimers();
    vi.setSystemTime((liveStartAt + 301) * 1000);
    const onGoLiveMarketClick = vi.fn();
    const expectedHref = `/markets/btc-updown-5m-${liveStartAt + 300}`;
    const { container } = mount(
      <AssetPriceChartPanel
        market={marketWithRound('live')}
        series={series('live')}
        selectedStartAt={liveStartAt}
        liveHref={`/markets/btc-updown-5m-${liveStartAt}`}
        viewingLive
        onGoLiveMarketClick={onGoLiveMarketClick}
      />
    );
    const cta = container.querySelector<HTMLAnchorElement>('[data-testid="go-live-market"]');
    cta?.addEventListener('click', (event) => event.preventDefault());

    expect(cta?.getAttribute('href')).toBe(expectedHref);

    act(() => {
      cta?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onGoLiveMarketClick).toHaveBeenCalledTimes(1);
    expect(onGoLiveMarketClick).toHaveBeenCalledWith(expectedHref);
  });

  it('renders final price and the live-market CTA for historical rounds', () => {
    const selectedHistoricalStartAt = liveStartAt - 300;
    const historicalSeries: MarketPriceSeries = {
      ...series('closed'),
      start_at: selectedHistoricalStartAt,
      end_at: selectedHistoricalStartAt + 300,
      points: [
        { ts: selectedHistoricalStartAt, price: '80797280000' },
        { ts: selectedHistoricalStartAt + 120, price: '80825450000' },
        { ts: selectedHistoricalStartAt + 300, price: '80797280000' }
      ]
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={marketWithRound('closed')}
        series={historicalSeries}
        selectedStartAt={selectedHistoricalStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive={false}
      />
    );

    expect(html).toContain('Final price');
    expect(html).toContain('number-flow-react');
    expect(html).toContain('Go to live market');
    expect(html).toContain('data-testid="go-live-market"');
    expect(html).toContain('data-testid="go-live-market-dot-ping"');
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('data-testid="asset-price-chart"');
  });

  it('prioritizes websocket market current price over stale REST series on live rounds', () => {
    const staleSeries = {
      ...series('live'),
      current_price: '80800000000',
      points: [
        { ts: liveStartAt, price: '80797280000' },
        { ts: liveStartAt + 120, price: '80800000000' }
      ]
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={marketWithRound('live')}
        series={staleSeries}
        selectedStartAt={liveStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive
      />
    );

    expect(html).toContain('$80,815.45');
    expect(html).toContain('$18.17');
  });

  it('keeps the price fallback for unavailable live values', () => {
    const unavailableMarket = {
      ...marketWithRound('live'),
      price_header: {
        ...marketWithRound('live').price_header!,
        current_price: null
      }
    };
    const unavailableSeries = {
      ...series('live'),
      current_price: null,
      points: []
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={unavailableMarket}
        series={unavailableSeries}
        selectedStartAt={liveStartAt}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive
      />
    );

    expect(html).toContain('Current Price');
    expect(html).toContain('<span>-</span>');
  });

  it('renders an optimistic live shell without stale prices', () => {
    const staleStartAt = liveStartAt - 300;
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={optimisticLiveMarket()}
        series={null}
        selectedStartAt={liveStartAt}
        liveHref={`/markets/btc-updown-5m-${liveStartAt}`}
        viewingLive
      />
    );

    expect(html).toContain('BTC Up or Down 5m');
    expect(html).toContain(formatEtRoundWindow(liveStartAt, liveStartAt + 300));
    expect(html).toContain('Current Price');
    expect(html).toContain('<span>-</span>');
    expect(html).toContain('data-testid="asset-price-chart"');
    expect(html).not.toContain(formatEtRoundWindow(staleStartAt, staleStartAt + 300));
    expect(html).not.toContain('$80,797.28');
  });

  it('does not fall back to stale mock header prices when series is unavailable', () => {
    const staleMarket = {
      ...marketWithRound('live'),
      price_header: {
        ...marketWithRound('live').price_header!,
        open_price: '35567280000',
        current_price: null,
        close_price: null
      }
    };
    const unavailableSeries: MarketPriceSeries = {
      symbol: 'BTCUSDT',
      start_at: 1_778_413_500,
      end_at: 1_778_413_800,
      duration_seconds: 300,
      status: 'unavailable',
      open_price: null,
      current_price: null,
      close_price: null,
      points: []
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={staleMarket}
        series={unavailableSeries}
        selectedStartAt={1_778_413_500}
        liveHref="/markets/btc-updown-5m-1778414400"
        viewingLive={false}
      />
    );

    expect(html).toContain('Final price');
    expect(html).toContain('<span>-</span>');
    expect(html).not.toContain('$35,567.28');
  });

  it('uses selectedStartAt instead of stale series and header windows', () => {
    const staleStartAt = 1_778_413_500;
    const selectedHistoricalStartAt = staleStartAt + 300;
    const staleMarket: Market = {
      ...marketWithRound('closed'),
      price_header: {
        ...marketWithRound('closed').price_header!,
        start_at: staleStartAt,
        end_at: staleStartAt + 300,
        round_id: String(Math.floor(staleStartAt / 300)),
        open_price: '35567280000',
        current_price: null,
        close_price: '35567280000',
        price_display_state: 'closed'
      }
    };
    const staleSeries: MarketPriceSeries = {
      symbol: 'BTCUSDT',
      start_at: staleStartAt,
      end_at: staleStartAt + 300,
      duration_seconds: 300,
      status: 'closed',
      open_price: '35567280000',
      current_price: null,
      close_price: '35567280000',
      points: [{ ts: staleStartAt, price: '35567280000' }]
    };
    const html = renderToStaticMarkup(
      <AssetPriceChartPanel
        market={staleMarket}
        series={staleSeries}
        selectedStartAt={selectedHistoricalStartAt}
        liveHref="/markets/btc-updown-5m-1778414400"
        viewingLive={false}
      />
    );

    expect(html).toContain(formatEtRoundWindow(selectedHistoricalStartAt, selectedHistoricalStartAt + 300));
    expect(html).not.toContain(formatEtRoundWindow(staleStartAt, staleStartAt + 300));
    expect(html).not.toContain('$35,567.28');
  });

  it('opens a 1 minute and 5 minute live market switcher', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_778_413_777_000);

    const { container } = mount(
      <AssetPriceChartPanel
        market={marketWithRound('closed')}
        series={series('closed')}
        selectedStartAt={liveStartAt - 300}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive={false}
        switcherMarkets={mockMarkets}
        switcherCurves={{
          ...mockCurves,
          '1': curveWithPrices('1', '760000', '240000')
        }}
      />
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="market-switcher-trigger"]')?.click();
    });

    expect(container.querySelector('[data-testid="market-switcher-menu"]')).not.toBeNull();
    expect(container.textContent).toContain('1 Min');
    expect(container.textContent).toContain('5 Min');
    expect(container.textContent).not.toContain('15 Min');
    expect(container.textContent).not.toContain('1 Day');
    expect(container.textContent).toContain('Bitcoin Up or Down - 5 Min');
    expect(container.textContent).toContain('Ethereum Up or Down - 5 Min');
    expect(container.textContent).toContain('Solana Up or Down - 5 Min');
    expect(container.textContent).not.toContain('%');
    expect(container.querySelector('[data-testid="market-switcher-leader-BTC-300"]')?.textContent).toContain('UP');
    expect(container.querySelector('[data-testid="market-switcher-leader-BTC-300"]')?.textContent).toContain('$0.76');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="market-switcher-duration-60"]')?.click();
    });

    expect(container.textContent).toContain('Bitcoin Up or Down - 1 Min');
    expect(container.textContent).toContain('Ethereum Up or Down - 1 Min');
    expect(container.textContent).toContain('Solana Up or Down - 1 Min');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="market-switcher-option-ETH-60"]')?.getAttribute('href')).toBe('/markets/eth-updown-1m-1778413740');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="market-switcher-option-SOL-60"]')?.getAttribute('href')).toBe('/markets/sol-updown-1m-1778413740');
  });

  it('shows the DOWN token price when DOWN is the more expensive side', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_778_413_777_000);

    const { container } = mount(
      <AssetPriceChartPanel
        market={marketWithRound('closed')}
        series={series('closed')}
        selectedStartAt={liveStartAt - 300}
        liveHref="/markets/btc-updown-5m-1778413500"
        viewingLive={false}
        switcherMarkets={mockMarkets}
        switcherCurves={{
          ...mockCurves,
          '12': curveWithPrices('12', '410000', '620000')
        }}
      />
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="market-switcher-trigger"]')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="market-switcher-duration-60"]')?.click();
    });

    const ethLeader = container.querySelector('[data-testid="market-switcher-leader-ETH-60"]');
    expect(container.textContent).not.toContain('%');
    expect(ethLeader?.textContent).toContain('DOWN');
    expect(ethLeader?.textContent).toContain('$0.62');
    expect(ethLeader?.textContent).not.toContain('56%');
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
