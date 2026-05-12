import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import type { Ticket } from '@/lib/api/types';
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
  getMarkets: vi.fn(),
  getMarketTickets: vi.fn(),
  claimTicket: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ address: routeState.address })
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
    apiMock.claimTicket.mockImplementation(async () => {
      const claimedTicket = { ...refundableTicket, status: 'claimed', claimed: true };
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

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Claimed');
    });
    expect(container.textContent).not.toContain('Claimable');
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Claim')).toBe(false);
    expect(api.claimTicket).not.toHaveBeenCalled();
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
