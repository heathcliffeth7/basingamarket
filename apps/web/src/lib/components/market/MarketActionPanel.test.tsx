import { renderToStaticMarkup } from 'react-dom/server';
import { act, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { mockCurves, mockMarkets, mockTickets } from '@/lib/api/mock';
import type { MarketCurve, Ticket } from '@/lib/api/types';
import { formatUsdPrice } from '@/lib/utils/amount';
import { deriveSimpleMarketRead } from '@/lib/utils/signals';
import MarketActionPanel, { buildClosedRoundOutcome, formatEtRoundWindow, resolveOutcome, tradeErrorMessage } from './MarketActionPanel';
import type { SelectedOrderBookAsk } from './MarketOrderBook';

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  loginSolana: vi.fn(),
  walletAddress: '11111111111111111111111111111111' as string | null,
  solanaWalletAddress: '11111111111111111111111111111111' as string | null,
  solanaWallet: null,
  solanaWalletsReady: true,
  solanaWalletResolving: false,
  hasSolanaWallet: true
}));
const walletSessionMock = vi.hoisted(() => ({
  getWalletSession: vi.fn(async () => ({
    accessToken: 'privy-access-token',
    walletSessionToken: 'wallet-session-token'
  }))
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

vi.mock('@/lib/auth/walletSession', () => ({
  useWalletSession: () => walletSessionMock
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
    vi.restoreAllMocks();
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
    authState.walletAddress = null;
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

  it('shows selected ask limit buy UI when an orderbook ask is selected', () => {
    const { container } = mountPanel(true, undefined, selectedAsk);

    expect(container.textContent).toContain('Selected ask');
    expect(container.textContent).toContain('UP listed position');
    expect(container.textContent).toContain('Buy selected ask UP');
    expect(container.textContent).not.toContain('Place limit bid');
  });

  it('buys the selected ask through the listing endpoint', async () => {
    const buyListingSpy = vi.spyOn(api, 'buyListing').mockResolvedValue({
      status: 'bought_listing',
      ticket_id: selectedAsk.lot_id,
      buyer_lot_id: null,
      signature: 'selected-ask-signature',
      explorer_url: 'https://explorer.solana.com/tx/selected-ask-signature?cluster=devnet',
      gross_usdc: selectedAsk.total_usdc,
      seller_receives: '15000000000',
      resale_fee: '500000000',
      early_flip_fee: '0',
      seller_cash_balance: '15000000000',
      buyer_cash_balance: '9050000000'
    });
    const clearSelectedAsk = vi.fn();
    const { container } = mountPanel(true, undefined, selectedAsk, clearSelectedAsk);

    const buyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Buy selected ask UP'));
    expect(buyButton?.disabled).toBe(false);

    await act(async () => {
      buyButton?.click();
    });

    await vi.waitFor(() => {
      expect(buyListingSpy).toHaveBeenCalledWith({
        ticketId: selectedAsk.lot_id,
        buyerWallet: authState.solanaWalletAddress,
        maxPricePerTicket: selectedAsk.price_per_ticket,
        marketId: mockCurves[liveMarket().market_id].market_id,
        roundId: mockCurves[liveMarket().market_id].round_id,
        accessToken: 'privy-access-token',
        walletSessionToken: 'wallet-session-token'
      });
    });
    expect(clearSelectedAsk).toHaveBeenCalled();
  });

  it('returns to the normal limit bid form after clearing a selected ask', () => {
    const market = liveMarket();
    const queryClient = new QueryClient();
    queryClient.setQueryData(cashBalanceQueryKey(authState.solanaWalletAddress!), {
      wallet_address: authState.solanaWalletAddress,
      currency: 'BUSDC',
      decimals: 6,
      cash_balance: '25000000000',
      status: 'ready'
    });

    function SelectedAskHarness() {
      const [ask, setAsk] = useState<SelectedOrderBookAsk | null>(selectedAsk);
      return (
        <QueryClientProvider client={queryClient}>
          <MarketActionPanel
            simpleRead={deriveSimpleMarketRead({ market })}
            curve={mockCurves[market.market_id]}
            market={market}
            selectedStartAt={market.price_header?.start_at}
            realtimeState="live"
            marketHref="/markets/btc-updown-5m-1778416800"
            viewingLive
            selectedOrderBookAsk={ask}
            onClearSelectedOrderBookAsk={() => setAsk(null)}
          />
        </QueryClientProvider>
      );
    }

    const { container } = mount(<SelectedAskHarness />);
    expect(container.textContent).toContain('Selected ask');

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Clear')
        ?.click();
    });

    expect(container.textContent).toContain('Place limit bid');
    expect(container.textContent).not.toContain('Selected ask');
  });

  it('lists a sell limit order with a comma decimal ask price', async () => {
    const market = liveMarket();
    const curve = mockCurves[market.market_id];
    const ownedTicket: Ticket = {
      ...mockTickets[2],
      market_id: market.market_id,
      current_owner: authState.solanaWalletAddress!,
      listed_price: null
    };
    const listTicketSpy = vi.spyOn(api, 'listTicket').mockResolvedValue({
      status: 'listed',
      ticket_id: ownedTicket.ticket_id,
      signature: 'list-ticket-signature',
      explorer_url: 'https://explorer.solana.com/tx/list-ticket-signature?cluster=devnet',
      price_per_ticket: '1200000'
    });
    const { container } = mountPanel(true, undefined, null, undefined, [ownedTicket]);

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === 'Sell')
        ?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="order-type-trigger"]')?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Limit')
        ?.click();
    });

    const listingPriceInput = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find((input) => input.value === '0.75');
    expect(listingPriceInput).toBeTruthy();
    act(() => {
      setInputValue(listingPriceInput!, '1,2');
    });

    const listButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'List');
    expect(listButton?.disabled).toBe(false);

    await act(async () => {
      listButton?.click();
    });

    await vi.waitFor(() => {
      expect(listTicketSpy).toHaveBeenCalledWith({
        ticketId: ownedTicket.ticket_id,
        sellerWallet: authState.solanaWalletAddress,
        pricePerTicket: '1200000',
        marketId: curve.market_id,
        roundId: curve.round_id,
        accessToken: 'privy-access-token',
        walletSessionToken: 'wallet-session-token'
      });
    });
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

  it('shows claim controls under a closed outcome for refundable owned tickets', async () => {
    const market = liveMarket();
    const curve = mockCurves[market.market_id];
    const ticket: Ticket = {
      ...mockTickets[0],
      ticket_id: 'refund-ticket-1',
      market_id: market.market_id,
      round_id: curve.round_id,
      current_owner: authState.solanaWalletAddress!,
      original_caller: authState.solanaWalletAddress!,
      status: 'refundable',
      settlement_value_usdc: '995000',
      realized_pnl_usdc: '-5000',
      claimed: false
    };
    let projectedTicket = ticket;
    vi.spyOn(api, 'getMarketTickets').mockImplementation(() => Promise.resolve([projectedTicket]));
    const claimTicketSpy = vi.spyOn(api, 'claimTicket').mockImplementation(async () => {
      const claimedTicket: Ticket = { ...ticket, status: 'claimed', claimed: true };
      projectedTicket = claimedTicket;
      return {
        status: 'claimed',
        ticket_id: ticket.ticket_id,
        amount: ticket.settlement_value_usdc!,
        cash_balance: '25099500000',
        ticket: claimedTicket
      };
    });
    const { container, queryClient } = mountPanel(false, undefined, null, undefined, [ticket]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    expect(container.textContent).toContain('Claims');
    expect(container.textContent).toContain('Refund $0.99');

    const claimButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Claim');
    expect(claimButton).toBeTruthy();

    await act(async () => {
      claimButton?.click();
    });

    await vi.waitFor(() => {
      expect(claimTicketSpy).toHaveBeenCalledWith({
        ticketId: ticket.ticket_id,
        claimerWallet: authState.solanaWalletAddress,
        accessToken: 'privy-access-token',
        walletSessionToken: 'wallet-session-token'
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market-tickets', market.market_id, curve.round_id] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', ticket.ticket_id] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market', market.market_id] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: cashBalanceQueryKey(authState.solanaWalletAddress!) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile-positions', authState.solanaWalletAddress] });
    await vi.waitFor(() => {
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.textContent?.trim() === 'Claim')).toHaveLength(0);
    });
    expect(container.textContent).toContain('No unclaimed payout or refund found for this wallet');
  });

  it('hides closed outcome claim controls for already claimed tickets', () => {
    const market = liveMarket();
    const curve = mockCurves[market.market_id];
    const claimedTicket: Ticket = {
      ...mockTickets[0],
      ticket_id: 'already-claimed-ticket',
      market_id: market.market_id,
      round_id: curve.round_id,
      current_owner: authState.solanaWalletAddress!,
      original_caller: authState.solanaWalletAddress!,
      status: 'claimed',
      claimed: true
    };
    vi.spyOn(api, 'getMarketTickets').mockResolvedValue([claimedTicket]);
    const { container } = mountPanel(false, undefined, null, undefined, [claimedTicket]);

    expect(container.textContent).toContain('No unclaimed payout or refund found for this wallet');
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
  });

  it('asks for a wallet before checking closed-round claims', () => {
    authState.solanaWalletAddress = null;
    authState.hasSolanaWallet = false;
    const claimTicketSpy = vi.spyOn(api, 'claimTicket');
    const { container } = mountPanel(false);

    expect(container.textContent).toContain('Connect wallet to check claims');
    expect(claimTicketSpy).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
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

  function mountPanel(
    viewingLive: boolean,
    curveOverride?: MarketCurve | null,
    ask: SelectedOrderBookAsk | null = null,
    onClearSelectedAsk?: () => void,
    tickets?: Ticket[]
  ) {
    const market = liveMarket();
    const priceSeries = viewingLive ? null : closedPriceSeries();
    const curve = curveOverride === undefined ? mockCurves[market.market_id] : curveOverride;
    const queryClient = new QueryClient();
    if (authState.solanaWalletAddress) {
      queryClient.setQueryData(cashBalanceQueryKey(authState.solanaWalletAddress), {
        wallet_address: authState.solanaWalletAddress,
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '25000000000',
        status: 'ready'
      });
    }
    if (tickets) {
      queryClient.setQueryData(['market-tickets', market.market_id, curve?.round_id ?? market.price_header?.round_id], tickets);
    }
    const mounted = mount(
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
          selectedOrderBookAsk={ask}
          onClearSelectedOrderBookAsk={onClearSelectedAsk}
        />
      </QueryClientProvider>
    );
    return { ...mounted, queryClient };
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

  function setInputValue(input: HTMLInputElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
