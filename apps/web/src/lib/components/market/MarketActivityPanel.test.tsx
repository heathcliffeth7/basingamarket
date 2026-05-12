import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { mockTickets, mockWalletAddress } from '@/lib/api/mock';
import type { BidBook, CashBid, Ticket } from '@/lib/api/types';
import MarketActivityPanel, { buildActiveOrderRows, buildOwnedPositionRows, positionPnl } from './MarketActivityPanel';

const apiMock = vi.hoisted(() => ({
  getBids: vi.fn(),
  getMarketTickets: vi.fn(),
  cancelBid: vi.fn(),
  cancelListing: vi.fn(),
  claimTicket: vi.fn()
}));

const authMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  loginSolana: vi.fn(),
  walletAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as string | null,
  solanaWalletAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as string | null,
  solanaWallet: null,
  solanaWalletsReady: true,
  solanaWalletResolving: false,
  hasSolanaWallet: true
}));

const MockApiClientError = vi.hoisted(() => class MockApiClientError extends Error {});

vi.mock('@/lib/api/client', () => ({
  ApiClientError: MockApiClientError,
  api: apiMock
}));

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authMock
}));

const WALLET = mockWalletAddress;
const MARKET_ID = '1';
const ROUND_ID = '5666667';

describe('MarketActivityPanel', () => {
  const mountedRoots: Root[] = [];

  beforeEach(() => {
    authMock.getAccessToken.mockResolvedValue('privy-access-token');
    authMock.loginSolana.mockResolvedValue(undefined);
    authMock.walletAddress = WALLET;
    authMock.solanaWalletAddress = WALLET;
    authMock.solanaWallet = null;
    authMock.solanaWalletsReady = true;
    authMock.solanaWalletResolving = false;
    authMock.hasSolanaWallet = true;
    apiMock.getBids.mockResolvedValue(defaultBidBook());
    apiMock.getMarketTickets.mockResolvedValue(defaultTickets());
    apiMock.cancelBid.mockResolvedValue({
      bid_id: 'bid-owned',
      market_id: MARKET_ID,
      round_id: ROUND_ID,
      side: 'UP',
      buyer_wallet: WALLET,
      price_per_ticket: '700000',
      max_usdc: '2000000',
      remaining_usdc: '0',
      status: 'cancelled'
    });
    apiMock.cancelListing.mockResolvedValue({
      status: 'cancelled',
      ticket_id: 'listed-owned',
      signature: 'devnet-signature',
      explorer_url: 'https://explorer.solana.com/tx/devnet-signature?cluster=devnet'
    });
    apiMock.claimTicket.mockResolvedValue({
      status: 'claimed',
      ticket_id: 'won-position',
      amount: '1250000',
      cash_balance: '1250000',
      ticket: ownedTicket({ ticket_id: 'won-position', status: 'claimed', claimed: true })
    });
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.length = 0;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('shows a wallet connect state under the chart when no wallet is connected', () => {
    authMock.walletAddress = null;
    authMock.solanaWalletAddress = null;
    authMock.hasSolanaWallet = false;
    const queryClient = createTestQueryClient();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MarketActivityPanel marketId={MARKET_ID} roundId={ROUND_ID} />
      </QueryClientProvider>
    );

    expect(html).toContain('My activity');
    expect(html).toContain('Connect your Solana wallet');
    expect(html).toContain('Connect wallet');
  });

  it('keeps activity out of connect state while the sticky Solana wallet is resolving', () => {
    authMock.solanaWalletAddress = WALLET;
    authMock.solanaWalletResolving = true;
    const queryClient = createTestQueryClient();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MarketActivityPanel marketId={MARKET_ID} roundId={ROUND_ID} />
      </QueryClientProvider>
    );

    expect(html).toContain('My activity');
    expect(html).not.toContain('Connect your Solana wallet');
    expect(html).not.toContain('Connect wallet');
  });

  it('filters active orders by selected round market wallet and active remaining balance', () => {
    const rows = buildActiveOrderRows({
      round_id: ROUND_ID,
      bids: [
        ownedBid(),
        ownedBid({ bid_id: 'other-market', market_id: '2' }),
        ownedBid({ bid_id: 'other-round', round_id: '5666668' }),
        ownedBid({ bid_id: 'other-wallet', buyer_wallet: 'So11111111111111111111111111111111111111112' }),
        ownedBid({ bid_id: 'empty', remaining_usdc: '0' }),
        ownedBid({ bid_id: 'cancelled', status: 'cancelled' })
      ]
    }, { marketId: MARKET_ID, roundId: ROUND_ID, walletAddress: WALLET });

    expect(rows.map((bid) => bid.bid_id)).toEqual(['bid-owned']);
  });

  it('ignores stale bid books from another round', () => {
    const rows = buildActiveOrderRows(defaultBidBook(), {
      marketId: MARKET_ID,
      roundId: '5666668',
      walletAddress: WALLET
    });

    expect(rows).toHaveLength(0);
  });

  it('filters owned positions by selected market wallet and open position status', () => {
    const rows = buildOwnedPositionRows([
      ownedTicket(),
      ownedTicket({ ticket_id: 'listed-owned', listed_price: '850000', status: 'listed' }),
      ownedTicket({ ticket_id: 'other-market', market_id: '2' }),
      ownedTicket({ ticket_id: 'other-wallet', current_owner: 'So11111111111111111111111111111111111111112' }),
      ownedTicket({ ticket_id: 'claimed', claimed: true }),
      ownedTicket({ ticket_id: 'won-position', status: 'won', realized_pnl_usdc: '250000' })
    ], { marketId: MARKET_ID, roundId: ROUND_ID, walletAddress: WALLET });

    expect(rows.map((ticket) => ticket.ticket_id)).toEqual(['owned-active', 'listed-owned', 'won-position']);
  });

  it('computes unrealized pnl from best bid before falling back to curve price', () => {
    const bidPnl = positionPnl(ownedTicket({
      token_amount: '2000000',
      cost_basis_usdc: '1000000'
    }), 'UP', {
      round_id: ROUND_ID,
      bids: [ownedBid({ price_per_ticket: '800000' })]
    }, null);
    const curvePnl = positionPnl(ownedTicket({
      token_amount: '2000000',
      cost_basis_usdc: '1000000'
    }), 'DOWN', {
      round_id: ROUND_ID,
      bids: []
    }, {
      market_id: MARKET_ID,
      round_id: ROUND_ID,
      duration_seconds: 300,
      updated_at: '2026-05-10T00:00:00Z',
      sides: [
        curveSide('UP', '700000'),
        curveSide('DOWN', '600000')
      ],
      points: []
    });

    expect(bidPnl?.label).toBe('Unrealized');
    expect(bidPnl?.amount).toBe(600000n);
    expect(curvePnl?.amount).toBe(200000n);
  });

  it('uses backend realized pnl for resolved positions', () => {
    const pnl = positionPnl(ownedTicket({
      status: 'lost',
      realized_pnl_usdc: '-1000000'
    }), 'UP', null, null);

    expect(pnl?.label).toBe('Realized');
    expect(pnl?.amount).toBe(-1000000n);
  });

  it('falls back to full negative cost for legacy lost positions without backend pnl', () => {
    const pnl = positionPnl(ownedTicket({
      status: 'lost',
      cost_basis_usdc: '1250000',
      settlement_value_usdc: null,
      realized_pnl_usdc: null
    }), 'DOWN', null, null);

    expect(pnl?.label).toBe('Realized');
    expect(pnl?.amount).toBe(-1250000n);
  });

  it('renders active orders and owned positions while hiding other wallets activity', async () => {
    const { container } = mountPanel();
    await waitFor(() => expect(container.textContent).toContain('UP limit order'));

    expect(container.textContent).toContain('Active orders');
    expect(container.textContent).toContain('$0.70 limit');
    expect(container.textContent).toContain('btc-updown-5m-1700000100');
    expect(container.textContent).toContain('UP');
    expect(container.textContent).not.toContain('#owned-active');
    expect(container.textContent).toContain('Unrealized PnL +$');
    expect(container.textContent).toContain('btc-updown-5m-1700000100');
    expect(container.textContent).toContain('DOWN');
    expect(container.textContent).not.toContain('#listed-owned');
    expect(container.textContent).not.toContain('other-wallet');
  });

  it('filters out owned positions from other rounds on historical routes', async () => {
    apiMock.getBids.mockResolvedValue({ round_id: ROUND_ID, bids: [] });

    const { container } = mountPanel(createTestQueryClient(), false, '5666668');
    await waitFor(() => expect(container.textContent).toContain('No active orders or owned positions'));

    expect(container.textContent).not.toContain('#owned-active');
    expect(apiMock.getMarketTickets).toHaveBeenCalled();
  });

  it('cancels an active limit order and invalidates activity caches', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { container } = mountPanel(queryClient);
    await waitFor(() => expect(container.textContent).toContain('Cancel order'));

    await act(async () => {
      findButton(container, 'Cancel order').click();
    });
    await waitFor(() => expect(apiMock.cancelBid).toHaveBeenCalled());

    expect(apiMock.cancelBid).toHaveBeenCalledWith({
      roundId: ROUND_ID,
      bidId: 'bid-owned',
      buyerWallet: WALLET,
      accessToken: 'privy-access-token'
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['round-bids', ROUND_ID, MARKET_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['round-orderbook', ROUND_ID, MARKET_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market-tickets', MARKET_ID, ROUND_ID] });
  });

  it('cancels a listed owned position and keeps unlisted positions read-only', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { container } = mountPanel(queryClient);
    await waitFor(() => expect(container.textContent).toContain('Cancel listing'));

    expect(findButton(container, 'Cancel listing')).toBeTruthy();
    expect(container.textContent).toContain('active');

    await act(async () => {
      findButton(container, 'Cancel listing').click();
    });
    await waitFor(() => expect(apiMock.cancelListing).toHaveBeenCalled());

    expect(apiMock.cancelListing).toHaveBeenCalledWith({
      ticketId: 'listed-owned',
      sellerWallet: WALLET,
      marketId: MARKET_ID,
      roundId: ROUND_ID,
      accessToken: 'privy-access-token'
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market-curve', MARKET_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market', MARKET_ID] });
  });

  it('claims won and refundable positions while hiding lost and claimed actions', async () => {
    apiMock.getBids.mockResolvedValue({ round_id: ROUND_ID, bids: [] });
    let tickets = [
      ownedTicket({ ticket_id: 'won-position', status: 'won', settlement_value_usdc: '1250000', realized_pnl_usdc: '250000' }),
      ownedTicket({ ticket_id: 'refund-position', status: 'refundable', settlement_value_usdc: '1000000', realized_pnl_usdc: '0' }),
      ownedTicket({ ticket_id: 'lost-position', status: 'lost', settlement_value_usdc: '0', realized_pnl_usdc: '-1000000' }),
      ownedTicket({ ticket_id: 'claimed-position', status: 'claimed', claimed: true })
    ];
    apiMock.getMarketTickets.mockImplementation(() => Promise.resolve(tickets));
    apiMock.claimTicket.mockImplementation(async () => {
      const claimedTicket = ownedTicket({ ticket_id: 'won-position', status: 'claimed', claimed: true });
      tickets = tickets.map((ticket) => ticket.ticket_id === claimedTicket.ticket_id ? claimedTicket : ticket);
      return {
        status: 'claimed',
        ticket_id: claimedTicket.ticket_id,
        amount: '1250000',
        cash_balance: '1250000',
        ticket: claimedTicket
      };
    });
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { container } = mountPanel(queryClient);
    await waitFor(() => expect(container.textContent).toContain('Realized PnL +$0.25'));

    expect(Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.includes('Claim'))).toHaveLength(2);
    expect(container.textContent).toContain('Realized PnL +$0.25');
    expect(container.textContent).toContain('Realized PnL $0.00');
    expect(container.textContent).toContain('Realized PnL -$1.00');
    expect(container.textContent).toContain('3 items');

    await act(async () => {
      findButton(container, 'Claim').click();
    });
    await waitFor(() => expect(apiMock.claimTicket).toHaveBeenCalled());

    expect(apiMock.claimTicket).toHaveBeenCalledWith({
      ticketId: 'won-position',
      claimerWallet: WALLET,
      accessToken: 'privy-access-token'
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market-tickets', MARKET_ID, ROUND_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', 'won-position'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: cashBalanceQueryKey(WALLET) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile-positions', WALLET] });
    await waitFor(() => {
      expect(Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.includes('Claim'))).toHaveLength(1);
    });
  });

  function mountPanel(queryClient = createTestQueryClient(), viewingLive = true, roundId = ROUND_ID) {
    return mount(
      <QueryClientProvider client={queryClient}>
        <MarketActivityPanel marketId={MARKET_ID} roundId={roundId} viewingLive={viewingLive} />
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

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;

  for (let index = 0; index < 30; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  throw lastError;
}

function findButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function defaultBidBook(): BidBook {
  return {
    round_id: ROUND_ID,
    bids: [
      ownedBid(),
      ownedBid({ bid_id: 'bid-other-wallet', buyer_wallet: 'So11111111111111111111111111111111111111112' })
    ]
  };
}

function defaultTickets(): Ticket[] {
  return [
    ownedTicket(),
    ownedTicket({
      ticket_id: 'listed-owned',
      outcome_id: 1,
      token_name: 'btc-updown-5m-1700000100-down',
      listed_price: '850000',
      status: 'listed'
    }),
    ownedTicket({
      ticket_id: 'other-wallet',
      current_owner: 'So11111111111111111111111111111111111111112'
    })
  ];
}

function ownedBid(overrides: Partial<CashBid> = {}): CashBid {
  return {
    bid_id: 'bid-owned',
    market_id: MARKET_ID,
    round_id: ROUND_ID,
    side: 'UP',
    buyer_wallet: WALLET,
    price_per_ticket: '700000',
    max_usdc: '2000000',
    remaining_usdc: '1000000',
    status: 'active',
    ...overrides
  };
}

function ownedTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ...mockTickets[0],
    ticket_id: 'owned-active',
    market_id: MARKET_ID,
    round_id: ROUND_ID,
    outcome_id: 0,
    current_owner: WALLET,
    listed_price: null,
    status: 'active',
    claimed: false,
    ...overrides
  };
}

function curveSide(side: 'UP' | 'DOWN', price: string) {
  return {
    side,
    price,
    best_entry_price: price,
    best_entry_source: 'fresh_curve' as const,
    fresh_mint_price: price,
    listed_best_ask_price: null,
    last_trade_price: null,
    token_supply: '0',
    market_cap: '0',
    liquidity: '0',
    volume: '0',
    virtual_usdc: '0',
    virtual_ticket: '0'
  };
}
