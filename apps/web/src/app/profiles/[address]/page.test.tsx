import { act, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import type { ProfileActivityItem, Ticket } from '@/lib/api/types';
import ProfilePage from './page';

const routeState = vi.hoisted(() => ({
  address: 'EDo26t5QFmn7yEXQzKftxX5raiFaPwNx2YzkTuRQUVxV'
}));

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  solanaWalletAddress: 'EDo26t5QFmn7yEXQzKftxX5raiFaPwNx2YzkTuRQUVxV' as string | null
}));

const apiMock = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getProfileTickets: vi.fn(),
  getProfileActivity: vi.fn(),
  getMarkets: vi.fn(),
  getMarketTickets: vi.fn(),
  claimTicket: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ address: routeState.address })
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  )
}));

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authState
}));

vi.mock('@/lib/api/client', () => ({
  api: apiMock
}));

const owner = 'EDo26t5QFmn7yEXQzKftxX5raiFaPwNx2YzkTuRQUVxV';
const otherWallet = '8otherWallet111111111111111111111111111111';

describe('ProfilePage claim activity', () => {
  const mountedRoots: Root[] = [];

  beforeEach(() => {
    routeState.address = owner;
    authState.solanaWalletAddress = owner;
    authState.getAccessToken.mockResolvedValue('privy-access-token');
    apiMock.getProfile.mockImplementation((address: string) => Promise.resolve({
      wallet_address: address,
      display_name: 'Signal Runner',
      avatar_url: null
    }));
    apiMock.getProfileTickets.mockResolvedValue([]);
    apiMock.getProfileActivity.mockResolvedValue(profileActivity([]));
    apiMock.getMarkets.mockReset();
    apiMock.getMarketTickets.mockReset();
    apiMock.claimTicket.mockReset();
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.length = 0;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders the profile shell immediately while profile data is still loading', () => {
    apiMock.getProfile.mockReturnValue(new Promise(() => {}));
    apiMock.getProfileTickets.mockReturnValue(new Promise(() => {}));
    apiMock.getProfileActivity.mockReturnValue(new Promise(() => {}));

    const { container } = mountProfile(mountedRoots);

    expect(container.textContent).toContain('Unnamed wallet');
    expect(container.textContent).toContain(owner);
    expect(container.textContent).toContain('Loading profile...');
    expect(container.textContent).toContain('Profit/Loss');
    expect(container.textContent).toContain('Activity');
    expect(container.textContent).not.toContain('share card');
  });

  it('loads profile tickets from one endpoint and lets the connected owner claim refundable tickets', async () => {
    const refundableTicket = profileTicket({
      current_owner: owner,
      original_caller: owner,
      status: 'refundable',
      settlement_value_usdc: '995000',
      realized_pnl_usdc: '-5000'
    });
    let profileTickets = [refundableTicket];
    apiMock.getProfileTickets.mockImplementation(() => Promise.resolve(profileTickets));
    apiMock.getProfileActivity.mockResolvedValue(profileActivity([]));
    apiMock.claimTicket.mockImplementation(async () => {
      const claimedTicket: Ticket = { ...refundableTicket, status: 'claimed', claimed: true };
      profileTickets = [claimedTicket];
      return {
        status: 'claimed',
        ticket_id: refundableTicket.ticket_id,
        amount: refundableTicket.settlement_value_usdc,
        cash_balance: '25099500000',
        ticket: claimedTicket
      };
    });

    const { container, queryClient } = mountProfile(mountedRoots);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await clickTab(container, 'Positions');

    await vi.waitFor(() => {
      expect(container.textContent).toContain('refundable');
      expect(container.textContent).toContain('-$0.00');
      expect(container.textContent).toContain('btc-updown-5m-1778542200');
    });
    expect(container.textContent).not.toContain('Pending');
    expect(container.textContent).not.toContain('BTC · 5m');
    expect(api.getProfileTickets).toHaveBeenCalledWith(owner);
    expect(api.getMarkets).not.toHaveBeenCalled();
    expect(api.getMarketTickets).not.toHaveBeenCalled();

    const claimButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Claim');
    expect(claimButton).toBeTruthy();

    await act(async () => {
      claimButton?.click();
    });

    await vi.waitFor(() => {
      expect(api.claimTicket).toHaveBeenCalledWith({
        ticketId: refundableTicket.ticket_id,
        claimerWallet: owner,
        accessToken: 'privy-access-token'
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile-positions', owner] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile-activity', owner] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', refundableTicket.ticket_id] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['market-tickets', '1', '5928474'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: cashBalanceQueryKey(owner) });
    await vi.waitFor(() => {
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
    });
  });

  it('shows another wallet claimable ticket as read-only activity', async () => {
    routeState.address = otherWallet;
    authState.solanaWalletAddress = owner;
    const refundableTicket = profileTicket({
      current_owner: otherWallet,
      original_caller: otherWallet,
      status: 'refundable',
      settlement_value_usdc: null,
      realized_pnl_usdc: null
    });
    apiMock.getProfileTickets.mockResolvedValue([refundableTicket]);

    const { container } = mountProfile(mountedRoots);
    await clickTab(container, 'Positions');

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Claimable');
    });
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
    expect(api.claimTicket).not.toHaveBeenCalled();
  });

  it('renders claimed owned activity as read-only, even if the status is still refundable', async () => {
    const claimedTicket = profileTicket({
      current_owner: owner,
      original_caller: owner,
      status: 'refundable',
      claimed: true,
      settlement_value_usdc: null,
      realized_pnl_usdc: null
    });
    apiMock.getProfileTickets.mockResolvedValue([claimedTicket]);

    const { container } = mountProfile(mountedRoots);
    await clickTab(container, 'Positions');

    await vi.waitFor(() => {
      expect(container.textContent).toContain('No open or claimable positions found.');
    });
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
    expect(api.claimTicket).not.toHaveBeenCalled();
  });

  it('renders real buy and sell activity with settled pnl before redeem', async () => {
    const settledTicket = profileTicket({
      status: 'won',
      settlement_value_usdc: '1500000',
      realized_pnl_usdc: '500000'
    });
    const soldTicket = profileTicket({
      ticket_id: '5278686580678953555',
      current_owner: otherWallet,
      original_caller: owner,
      status: 'active'
    });
    apiMock.getProfileTickets.mockResolvedValue([settledTicket, soldTicket]);
    apiMock.getProfileActivity.mockResolvedValue(profileActivity([
      profileActivityItem({
        id: 'resale-sell-signature',
        type: 'sell',
        ticket: soldTicket,
        amount_usdc: '1250000',
        pnl_usdc: '250000',
        counterparty: otherWallet
      }),
      profileActivityItem({
        id: 'cash-buy-signature',
        type: 'buy',
        ticket: settledTicket,
        amount_usdc: '1000000',
        pnl_usdc: '500000'
      })
    ], '750000'));

    const { container } = mountProfile(mountedRoots);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Buy');
      expect(container.textContent).toContain('Sell');
      expect(container.textContent).toContain('+$0.75');
      expect(container.textContent).toContain('+$0.50');
      expect(container.textContent).toContain('+$0.25');
    });
    expect(container.textContent).not.toContain('Redeem');
  });
});

function mountProfile(mountedRoots: Root[]) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ProfilePage />
      </QueryClientProvider>
    );
  });
  return { container, queryClient };
}

async function clickTab(container: HTMLElement, label: string) {
  await vi.waitFor(() => {
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === label)).toBe(true);
  });
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.trim() === label);
  await act(async () => {
    tab?.click();
  });
}

function profileTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: '5278686580678953554',
    market_id: '1',
    round_id: '5928474',
    outcome_id: 0,
    token_name: 'btc-updown-5m-1778542200-up',
    original_caller: owner,
    current_owner: owner,
    stake_amount: '1000000',
    token_amount: '1000000',
    reward_shares: '1000000',
    entry_odds: '995000',
    cost_basis_usdc: '1000000',
    avg_entry_price: '995000',
    settlement_value_usdc: null,
    realized_pnl_usdc: null,
    listed_price: null,
    status: 'active',
    claimed: false,
    confidence: 70,
    mood: 1,
    ...overrides
  };
}

function profileActivity(items: ProfileActivityItem[], totalPnl = '0') {
  return {
    summary: {
      total_pnl_usdc: totalPnl
    },
    items
  };
}

function profileActivityItem({
  ticket,
  ...overrides
}: Partial<ProfileActivityItem> & { ticket: Ticket }): ProfileActivityItem {
  return {
    id: `activity-${ticket.ticket_id}`,
    type: 'buy',
    ticket_id: ticket.ticket_id,
    market_id: ticket.market_id,
    round_id: ticket.round_id,
    outcome_id: ticket.outcome_id,
    token_name: ticket.token_name ?? '',
    side: ticket.outcome_id === 1 ? 'DOWN' : 'UP',
    amount_usdc: ticket.cost_basis_usdc ?? ticket.stake_amount,
    shares: ticket.token_amount ?? ticket.reward_shares,
    pnl_usdc: ticket.realized_pnl_usdc,
    counterparty: null,
    created_at: '2026-05-12T00:00:00Z',
    ticket,
    ...overrides
  };
}
