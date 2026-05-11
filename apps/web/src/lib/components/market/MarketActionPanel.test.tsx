import { renderToStaticMarkup } from 'react-dom/server';
import { act, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { mockCurves, mockMarkets } from '@/lib/api/mock';
import type { MarketCurve } from '@/lib/api/types';
import { formatUsdPrice } from '@/lib/utils/amount';
import { deriveSimpleMarketRead } from '@/lib/utils/signals';
import MarketActionPanel, { buildClosedRoundOutcome, formatEtRoundWindow, resolveOutcome, tradeErrorMessage } from './MarketActionPanel';
import type { SelectedOrderBookAsk } from './MarketOrderBook';

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  loginSolana: vi.fn(),
  solanaWalletAddress: '11111111111111111111111111111111' as string | null,
  solanaWallet: null,
  solanaWalletsReady: true,
  solanaWalletResolving: false,
  hasSolanaWallet: true
}));

const selectedAsk: SelectedOrderBookAsk = {
  side: 'UP',
  lot_id: '2',
  price_per_ticket: '145000000',
  ticket_amount: '110000000',
  total_usdc: '15950000000'
};

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authState
}));

function renderPanel(viewingLive: boolean, curveOverride?: MarketCurve | null) {
  const market = liveMarket();
  const priceSeries = viewingLive ? null : closedPriceSeries();
  const curve = curveOverride === undefined ? mockCurves[market.market_id] : curveOverride;
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MarketActionPanel
        simpleRead={deriveSimpleMarketRead({ market })}
        curve={curve}
        market={market}
        priceSeries={priceSeries}
        selectedStartAt={priceSeries?.start_at ?? market.price_header?.start_at}
        realtimeState="live"
        marketHref="/markets/btc-updown-5m-1778416800"
        viewingLive={viewingLive}
      />
    </QueryClientProvider>
  );
}

function liveMarket() {
  return {
    ...mockMarkets[0],
    price_header: {
      ...mockMarkets[0].price_header!,
      start_at: 1_900_000_000,
      end_at: 1_900_000_300,
      current_price: '35577280000',
      close_price: null,
      price_display_state: 'live' as const
    }
  };
}

function closedPriceSeries() {
  return {
    symbol: 'BTCUSDT',
    start_at: 1_746_953_700,
    end_at: 1_746_954_000,
    duration_seconds: 300,
    status: 'closed' as const,
    open_price: '103000000000',
    current_price: null,
    close_price: '102000000000',
    points: []
  };
}

describe('MarketActionPanel', () => {
  const mountedRoots: Root[] = [];

  beforeEach(() => {
    authState.getAccessToken.mockResolvedValue('privy-access-token');
    authState.loginSolana.mockResolvedValue(undefined);
    authState.solanaWalletAddress = '11111111111111111111111111111111';
    authState.solanaWallet = null;
    authState.solanaWalletsReady = true;
    authState.solanaWalletResolving = false;
    authState.hasSolanaWallet = true;
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.length = 0;
    document.body.innerHTML = '';
  });

  it('maps cash buy liquidity errors to a BUSDC reserve message', () => {
    const error = new ApiClientError({
      status: 503,
      code: 'cash_buy_liquidity_pending',
      path: '/rounds/1/market-buy'
    });

    expect(tradeErrorMessage(error)).toContain('Vault BUSDC reserve is too low');
  });

  it('uses market language instead of curve language', () => {
    const html = renderPanel(true);

    expect(html).toContain('Market leans UP');
    expect(html).not.toContain('Curve leans');
  });

  it('shows UP and DOWN token virtual market caps in the market read', () => {
    const html = renderPanel(true);
    const curve = mockCurves[liveMarket().market_id];
    const upSide = curve.sides.find((side) => side.side === 'UP')!;
    const downSide = curve.sides.find((side) => side.side === 'DOWN')!;

    expect(html).toContain(`Fresh curve · vMC ${formatUsdPrice(upSide.market_cap)}`);
    expect(html).toContain(`Fresh curve · vMC ${formatUsdPrice(downSide.market_cap)}`);
  });

  it('shows the live buy action for the current live round', () => {
    const html = renderPanel(true);

    expect(html).toContain('Market buy UP');
    expect(html).toContain('Market');
    expect(html).toContain('Sell');
    expect(html).not.toContain('Split');
    expect(html).not.toContain('Outcome:');
  });

  it('opens the order type dropdown without showing split', () => {
    const { container } = mountPanel(true);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="order-type-trigger"]')?.click();
    });

    const menu = container.querySelector('[data-testid="order-type-menu"]');
    expect(menu?.textContent).toContain('Market');
    expect(menu?.textContent).toContain('Limit');
    expect(menu?.textContent).not.toContain('Split');

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Limit')
        ?.click();
    });

    expect(container.textContent).toContain('Place limit bid');
  });

  it('shows a wallet connect state before the wallet is connected', () => {
    authState.solanaWalletAddress = null;
    authState.hasSolanaWallet = false;

    const html = renderPanel(true);

    expect(html).toContain('Connect Solana wallet');
    expect(html).not.toContain('Outcome:');
  });

  it('does not fall back to wallet connect copy while a sticky Solana wallet is resolving', () => {
    authState.solanaWalletAddress = '11111111111111111111111111111111';
    authState.solanaWalletResolving = true;

    const html = renderPanel(true);

    expect(html).toContain('Market buy UP');
    expect(html).not.toContain('Connect Solana wallet');
  });

  it('renders the live read shell while curve loads and disables connected-wallet trades', () => {
    const { container } = mountPanel(true, null);

    expect(container.textContent).toContain('Crowd leans UP');
    expect(container.textContent).toContain('UP token');
    expect(container.textContent).toContain('DOWN token');
    expect(container.textContent).toContain('Market buy UP');

    const marketBuyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Market buy UP'));
    expect(marketBuyButton?.disabled).toBe(true);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="order-type-trigger"]')?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Limit')
        ?.click();
    });

    const limitButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Place limit bid');
    expect(limitButton?.disabled).toBe(true);
  });

  it('hides the live-market CTA while already viewing live', () => {
    const html = renderPanel(true);

    expect(html).not.toContain('Go to live market');
  });

  it('shows the live-market CTA for historical rounds', () => {
    const html = renderPanel(false);

    expect(html).toContain('Go to live market');
    expect(html).toContain('/markets/btc-updown-5m-1778416800');
  });

  it('renders an outcome card instead of buy controls for historical rounds', () => {
    const html = renderPanel(false);

    expect(html).toContain('Outcome: Down');
    expect(html).toContain('Bitcoin Up or Down - May 11, 4:55AM-5:00AM ET');
    expect(html).not.toContain('Market buy UP');
    expect(html).not.toContain('Connect Solana wallet');
  });

  it('resolves UP DOWN and VOID from canonical open and close prices', () => {
    expect(resolveOutcome('1000000', '1000001')).toBe('up');
    expect(resolveOutcome('1000000', '999999')).toBe('down');
    expect(resolveOutcome('1000000', '1000000')).toBe('void');
    expect(resolveOutcome('1000000', null)).toBe('pending');
  });

  it('formats ET round windows', () => {
    expect(formatEtRoundWindow(1_746_953_700, 1_746_954_000)).toBe('May 11, 4:55AM-5:00AM ET');
  });

  it('builds pending outcome text when closed data is unavailable', () => {
    const outcome = buildClosedRoundOutcome({
      market: { ...liveMarket(), price_header: { ...liveMarket().price_header!, price_display_state: 'closed', close_price: null } },
      priceSeries: null,
      selectedStartAt: 1_746_952_500,
      viewingLive: false,
      nowTs: 1_746_952_900
    });

    expect(outcome.closed).toBe(true);
    expect(outcome.title).toBe('Outcome pending');
  });

  it('does not render legacy ticket/listed controls', () => {
    const html = renderPanel(true);

    expect(html).not.toContain('Related tickets');
    expect(html).not.toContain('Listed');
    expect(html).not.toContain('Ticket #');
  });

  function mountPanel(viewingLive: boolean, curveOverride?: MarketCurve | null) {
    const market = liveMarket();
    const priceSeries = viewingLive ? null : closedPriceSeries();
    const curve = curveOverride === undefined ? mockCurves[market.market_id] : curveOverride;
    const queryClient = new QueryClient();
    return mount(
      <QueryClientProvider client={queryClient}>
        <MarketActionPanel
          simpleRead={deriveSimpleMarketRead({ market })}
          curve={curve}
          market={market}
          priceSeries={priceSeries}
          selectedStartAt={priceSeries?.start_at ?? market.price_header?.start_at}
          realtimeState="live"
          marketHref="/markets/btc-updown-5m-1778416800"
          viewingLive={viewingLive}
        />
      </QueryClientProvider>
    );
  }

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
