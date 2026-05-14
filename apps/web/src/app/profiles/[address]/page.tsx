'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Loader2, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { useAuth, useProtectedAuthTokens } from '@/lib/auth/privy';
import Button from '@/lib/components/ui/Button';
import Badge from '@/lib/components/ui/Badge';
import Skeleton from '@/lib/components/ui/Skeleton';
import type { ProfileActivityItem, Ticket as MarketTicket } from '@/lib/api/types';
import { formatUsdPrice } from '@/lib/utils/amount';

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const queryClient = useQueryClient();
  const { solanaWalletAddress } = useAuth();
  const { getAuthTokens } = useProtectedAuthTokens();
  const [copied, setCopied] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'positions' | 'activity'>('activity');
  const profileQuery = useQuery({ queryKey: ['profile', address], queryFn: () => api.getProfile(address) });
  const positionQuery = useQuery({
    queryKey: ['profile-positions', address],
    queryFn: () => api.getProfileTickets(address)
  });
  const activityQuery = useQuery({
    queryKey: ['profile-activity', address],
    queryFn: () => api.getProfileActivity(address)
  });
  const ownedTickets = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.current_owner === address), [address, positionQuery.data]);
  const originalCalls = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.original_caller === address), [address, positionQuery.data]);
  const listedTickets = ownedTickets.filter((ticket) => Boolean(ticket.listed_price));
  const settledTickets = ownedTickets.filter((ticket) => ticket.status === 'won' || ticket.status === 'claimed' || ticket.status === 'refundable');
  const bestEarlyCall = [...originalCalls].sort((a, b) => b.confidence - a.confidence)[0];
  const color = identiconColor(address);
  const canClaimAsOwner = solanaWalletAddress === address;
  const displayName = profileQuery.data?.display_name ?? 'Unnamed wallet';
  const walletAddress = profileQuery.data?.wallet_address ?? address;
  const claimTicketMutation = useMutation({
    mutationFn: async (ticket: MarketTicket) => {
      if (!solanaWalletAddress) throw new Error('Solana wallet unavailable.');
      const authTokens = await getAuthTokens();
      return api.claimTicket({
        ticketId: ticket.ticket_id,
        claimerWallet: solanaWalletAddress,
        accessToken: authTokens.accessToken,
        identityToken: authTokens.identityToken
      });
    },
    onSuccess: (result) => {
      setClaimMessage(`Claimed ${formatUsdPrice(result.amount)} from #${result.ticket_id}`);
      syncClaimedTicketCache(result.ticket);
      void queryClient.invalidateQueries({ queryKey: ['ticket', result.ticket_id] });
      void queryClient.invalidateQueries({ queryKey: ['profile-positions', address] });
      void queryClient.invalidateQueries({ queryKey: ['profile-activity', address] });
      void queryClient.invalidateQueries({ queryKey: ['market-tickets', result.ticket.market_id, result.ticket.round_id] });
      void queryClient.invalidateQueries({ queryKey: ['market-tickets', result.ticket.market_id] });
      void queryClient.invalidateQueries({ queryKey: ['market', result.ticket.market_id] });
      void queryClient.invalidateQueries({ queryKey: ['market-curve', result.ticket.market_id] });
      if (solanaWalletAddress) {
        void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(solanaWalletAddress) });
      }
    },
    onError: (error) => {
      setClaimMessage(error instanceof Error ? error.message : 'Claim failed.');
    }
  });

  function syncClaimedTicketCache(ticket: MarketTicket) {
    queryClient.setQueryData<MarketTicket>(['ticket', ticket.ticket_id], ticket);
    queryClient.setQueryData<MarketTicket[]>(['profile-positions', address], (current) => replaceCachedTicket(current, ticket));
    queryClient.setQueryData<MarketTicket[]>(['market-tickets', ticket.market_id, ticket.round_id], (current) => replaceCachedTicket(current, ticket));
    queryClient.setQueryData<MarketTicket[]>(['market-tickets', ticket.market_id], (current) => replaceCachedTicket(current, ticket));
  }

  const sortedPositions = useMemo(() => {
    return [...ownedTickets].sort((a, b) => {
      const aId = Number(a.ticket_id) || 0;
      const bId = Number(b.ticket_id) || 0;
      return bId - aId;
    });
  }, [ownedTickets]);
  const visiblePositionTickets = sortedPositions.filter((ticket) => ticket.status === 'active' || ticket.status === 'listed' || canClaimTicket(ticket));
  const activityItems = activityQuery.data?.items ?? [];
  const visibleCount = activeTab === 'positions' ? visiblePositionTickets.length : activityItems.length;
  const activeLoading = activeTab === 'positions' ? positionQuery.isLoading : activityQuery.isLoading;

  async function copyAddress() {
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  }

  return (
    <main className="mx-auto max-w-[1360px] px-4 py-5 sm:px-6">
      <div className="mb-3">
        <Button href="/markets" variant="ghost"><ArrowLeft size={15} /> Markets</Button>
      </div>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="terminal-panel min-h-[248px] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border font-mono text-xl font-bold sm:h-[72px] sm:w-[72px]" style={{ borderColor: color, background: `radial-gradient(circle at 35% 35%, ${color}66, ${color}18 58%, rgba(148,163,184,0.22))`, color }}>
              {address.slice(2, 4).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-black leading-tight text-terminal-text sm:text-3xl">{displayName}</h1>
                  <p className="mt-1 text-xs font-semibold text-terminal-muted sm:text-sm">
                    {profileQuery.isLoading ? 'Loading profile...' : profileQuery.isError ? 'Profile metadata unavailable' : 'Forecast identity'}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-terminal-muted">{walletAddress}</p>
                </div>
                <Button size="icon" variant="secondary" onClick={copyAddress} aria-label="Copy address"><Copy size={15} /></Button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <InlineStat label="Positions Value" value="$0.00" />
                <InlineStat label="Owned Tickets" value={positionQuery.isLoading ? '...' : String(ownedTickets.length)} />
                <InlineStat label="Predictions" value={positionQuery.isLoading ? '...' : String(originalCalls.length)} />
                <InlineStat label="Claimable" value={positionQuery.isLoading ? '...' : String(settledTickets.filter(canClaimTicket).length)} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button href="/markets" className="h-10"><TrendingUp size={14} /> Explore markets</Button>
                <Button variant="secondary" className="h-10" onClick={copyAddress}><Copy size={14} /> {copied ? 'Copied' : 'Copy wallet'}</Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge tone={copied ? 'positive' : 'neutral'}>{copied ? 'copied' : 'normalized wallet'}</Badge>
                <Badge tone={positionQuery.isError ? 'warning' : 'neutral'}>{positionQuery.isError ? 'projection pending' : 'projection read'}</Badge>
                <Badge tone="neutral">settled {positionQuery.isLoading ? '...' : settledTickets.length}</Badge>
                <Badge tone="neutral">listed {positionQuery.isLoading ? '...' : listedTickets.length}</Badge>
                <Badge tone="neutral">best call {bestEarlyCall ? `#${bestEarlyCall.ticket_id}` : 'pending'}</Badge>
              </div>
            </div>
          </div>
        </div>

        <ProfitLossCard
          loading={activityQuery.isLoading}
          totalPnl={activityQuery.data?.summary.total_pnl_usdc}
        />
      </section>

      <section className="mt-5">
        <div className="mb-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex gap-4 text-xl font-black">
            <button
              type="button"
              className={activeTab === 'positions' ? 'text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}
              onClick={() => setActiveTab('positions')}
            >
              Positions
            </button>
            <button
              type="button"
              className={activeTab === 'activity' ? 'text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}
              onClick={() => setActiveTab('activity')}
            >
              Activity
            </button>
          </div>
          <Badge tone={activeLoading ? 'warning' : activityQuery.isError && activeTab === 'activity' ? 'warning' : 'neutral'}>
            {activeLoading ? 'loading' : `${visibleCount} ${activeTab === 'positions' ? 'position' : 'activity item'}${visibleCount === 1 ? '' : 's'}`}
          </Badge>
        </div>

        <div className="overflow-hidden rounded-xl border border-terminal-line bg-terminal-panel">
          <div className="grid grid-cols-[5.25rem_minmax(0,1fr)_6.75rem] gap-3 border-b border-terminal-line px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-terminal-muted sm:grid-cols-[7rem_minmax(0,1fr)_8.5rem] sm:px-4">
            <span>Type</span>
            <span>Market</span>
            <span className="text-right">Amount</span>
          </div>
          {claimMessage ? <p className="border-b border-terminal-line px-3 py-2.5 text-xs font-semibold text-terminal-muted sm:px-4">{claimMessage}</p> : null}
          {activeLoading ? (
            <div className="p-3 sm:p-4"><Skeleton className="h-32" /></div>
          ) : visibleCount === 0 ? (
            <p className="px-3 py-7 text-sm text-terminal-muted sm:px-4">
              {activeTab === 'positions' ? 'No open or claimable positions found.' : 'No trading activity found.'}
            </p>
          ) : activeTab === 'activity' ? (
            <div className="divide-y divide-terminal-line/70">
              {activityItems.map((item) => (
                <ProfileActivityEventRow key={item.id} item={item} address={address} />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-terminal-line/70">
              {visiblePositionTickets.map((ticket) => (
                <ProfilePositionRow
                  key={ticket.ticket_id}
                  ticket={ticket}
                  address={address}
                  canClaimAsOwner={canClaimAsOwner}
                  claimPending={claimTicketMutation.isPending && claimTicketMutation.variables?.ticket_id === ticket.ticket_id}
                  onClaim={() => claimTicketMutation.mutate(ticket)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function identiconColor(addr: string) {
  const seed = Array.from(addr.slice(0, 12)).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = seed % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-lg font-black text-terminal-text sm:text-xl">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-bold text-terminal-muted sm:text-xs">{label}</p>
    </div>
  );
}

function ProfitLossCard({ loading, totalPnl }: { loading: boolean; totalPnl?: string }) {
  const ranges = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'] as const;
  const pnl = safeBigInt(totalPnl) ?? 0n;
  const pnlTone = pnl > 0n ? 'text-market-positive' : pnl < 0n ? 'text-market-negative' : 'text-terminal-text';

  return (
    <div className="terminal-panel min-h-[248px] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-black text-terminal-muted">
            <span className="h-2 w-2 rounded-full bg-terminal-muted" />
            Profit/Loss
          </p>
          <p className={`mt-4 font-mono text-4xl font-black leading-none ${loading ? 'text-terminal-muted' : pnlTone}`}>
            {loading ? '...' : formatSignedUsdPrice(pnl)}
          </p>
          <p className="mt-2 text-xs font-bold text-terminal-muted">Realized total</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-[11px] font-black text-terminal-muted">
          {ranges.map((range) => (
            <button
              key={range}
              type="button"
              className={`h-8 rounded-lg px-2.5 ${range === '1D' ? 'bg-market-positive/18 text-market-positive' : 'hover:bg-terminal-panel-strong hover:text-terminal-text'}`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className={`mt-10 h-10 overflow-hidden rounded-sm bg-gradient-to-b ${pnl < 0n ? 'from-market-negative/24' : 'from-market-positive/24'} to-transparent`} aria-hidden="true" />
    </div>
  );
}

function ProfilePositionRow({
  ticket,
  address,
  canClaimAsOwner,
  claimPending,
  onClaim
}: {
  ticket: MarketTicket;
  address: string;
  canClaimAsOwner: boolean;
  claimPending: boolean;
  onClaim: () => void;
}) {
  const side = sideFromTicket(ticket);
  const marketName = marketIdLabel(ticket);
  const pnl = computeTicketPnl(ticket);
  const cost = ticket.cost_basis_usdc ?? ticket.stake_amount;
  const claimable = canClaimTicket(ticket);
  const action = positionActionLabel(ticket);

  return (
    <div className="grid grid-cols-[5.25rem_minmax(0,1fr)_6.75rem] gap-3 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_8.5rem] sm:px-4">
      <div className="flex items-center">
        <span className="text-sm font-black text-terminal-text">{action}</span>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg font-mono text-lg font-black ${side === 'UP' ? 'bg-market-positive text-terminal-bg' : 'bg-market-negative text-white'}`}>
            {side === 'UP' ? 'U' : 'D'}
          </div>
          <div className="min-w-0">
            <a href={`/tickets/${ticket.ticket_id}`} className="block truncate text-sm font-black text-terminal-text hover:underline">
              {marketName}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-terminal-muted">
              <Badge
                tone={side === 'UP' ? 'positive' : 'negative'}
                className="text-[10px] px-1.5 py-0"
              >
                {side}
              </Badge>
              <Badge
                tone={ticket.status === 'won' || ticket.status === 'claimed' ? 'positive' : ticket.status === 'refundable' || ticket.status === 'listed' ? 'warning' : ticket.status === 'lost' ? 'negative' : 'neutral'}
                className="text-[10px] px-1.5 py-0"
              >
                {ticket.status}
              </Badge>
              <span>{formatTicketShares(ticket.token_amount)} shares</span>
              {ticket.original_caller === address && ticket.current_owner !== address ? <span>Original call</span> : null}
              {ticket.listed_price ? <span>Listed {formatUsdPrice(ticket.listed_price)}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm font-black text-terminal-text sm:text-base">{formatUsdPrice(cost)}</p>
        <p className={`mt-0.5 text-[11px] font-black ${pnl.tone === 'positive' ? 'text-market-positive' : pnl.tone === 'negative' ? 'text-market-negative' : 'text-terminal-muted'}`}>
          {pnl.display}
        </p>
        {canClaimAsOwner && claimable ? (
          <Button
            className="mt-1.5 h-7 px-2.5 text-xs"
            disabled={claimPending}
            onClick={onClaim}
            variant="default"
          >
            {claimPending ? <Loader2 className="animate-spin" size={13} /> : <Wallet size={13} />}
            Claim
          </Button>
        ) : claimable ? (
          <Badge className="mt-2 text-[10px]" tone="warning">Claimable</Badge>
        ) : null}
      </div>
    </div>
  );
}

function ProfileActivityEventRow({ item, address }: { item: ProfileActivityItem; address: string }) {
  const pnl = computeActivityPnl(item.pnl_usdc);
  const marketName = marketIdLabel(item);
  const typeLabel = activityTypeLabel(item.type);

  return (
    <div className="grid grid-cols-[5.25rem_minmax(0,1fr)_6.75rem] gap-3 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_8.5rem] sm:px-4">
      <div className="flex items-center">
        <span className={`text-sm font-black ${item.type === 'buy' ? 'text-market-positive' : item.type === 'sell' ? 'text-market-negative' : 'text-terminal-text'}`}>
          {typeLabel}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg font-mono text-lg font-black ${item.side === 'UP' ? 'bg-market-positive text-terminal-bg' : 'bg-market-negative text-white'}`}>
            {item.side === 'UP' ? 'U' : 'D'}
          </div>
          <div className="min-w-0">
            <a href={`/tickets/${item.ticket_id}`} className="block truncate text-sm font-black text-terminal-text hover:underline">
              {marketName}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-terminal-muted">
              <Badge
                tone={item.side === 'UP' ? 'positive' : 'negative'}
                className="text-[10px] px-1.5 py-0"
              >
                {item.side}
              </Badge>
              <Badge
                tone={item.ticket.status === 'won' || item.ticket.status === 'claimed' ? 'positive' : item.ticket.status === 'refundable' || item.ticket.status === 'listed' ? 'warning' : item.ticket.status === 'lost' ? 'negative' : 'neutral'}
                className="text-[10px] px-1.5 py-0"
              >
                {item.ticket.status}
              </Badge>
              <span>{formatTicketShares(item.shares)} shares</span>
              {item.counterparty ? <span>{item.type === 'buy' ? 'from' : 'to'} {shortWallet(item.counterparty, address)}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm font-black text-terminal-text sm:text-base">{formatUsdPrice(item.amount_usdc)}</p>
        <p className={`mt-0.5 text-[11px] font-black ${pnl.tone === 'positive' ? 'text-market-positive' : pnl.tone === 'negative' ? 'text-market-negative' : 'text-terminal-muted'}`}>
          {pnl.display}
        </p>
      </div>
    </div>
  );
}

function sideFromTicket(ticket: { outcome_id: number }): 'UP' | 'DOWN' {
  return ticket.outcome_id === 1 ? 'DOWN' : 'UP';
}

function canClaimTicket(ticket: MarketTicket) {
  return !ticket.claimed && (ticket.status === 'won' || ticket.status === 'refundable');
}

function replaceCachedTicket(current: MarketTicket[] | undefined, ticket: MarketTicket) {
  if (!current) return current;
  return current.map((cachedTicket) => cachedTicket.ticket_id === ticket.ticket_id ? ticket : cachedTicket);
}

function marketIdLabel(ticket: Pick<MarketTicket, 'market_id' | 'round_id' | 'token_name'>): string {
  if (ticket.token_name) return ticket.token_name.replace(/-(up|down)$/i, '');
  return `market-${ticket.market_id}-round-${ticket.round_id}`;
}

function positionActionLabel(ticket: MarketTicket) {
  if (canClaimTicket(ticket)) return 'Claim';
  if (ticket.listed_price || ticket.status === 'listed') return 'Listed';
  if (ticket.status === 'active') return 'Open';
  return 'Settled';
}

function activityTypeLabel(type: ProfileActivityItem['type']) {
  if (type === 'buy') return 'Buy';
  if (type === 'sell') return 'Sell';
  return 'Redeem';
}

function shortWallet(value: string, profileAddress: string) {
  if (value === profileAddress) return 'self';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatTicketShares(value: string | null | undefined) {
  const amount = Number(value ?? 0) / 1_000_000;
  if (!Number.isFinite(amount)) return '0.0';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: amount > 0 && amount < 1 ? 1 : 0,
    maximumFractionDigits: 1
  });
}

function computeTicketPnl(ticket: {
  status: string;
  claimed?: boolean;
  realized_pnl_usdc?: string | null;
  cost_basis_usdc?: string;
  stake_amount: string;
  settlement_value_usdc?: string | null;
}): { display: string; tone: 'positive' | 'negative' | 'neutral' } {
  const backendPnl = safeBigInt(ticket.realized_pnl_usdc);
  if (backendPnl !== null) {
    return {
      display: formatSignedUsdPrice(backendPnl),
      tone: backendPnl > 0n ? 'positive' : backendPnl < 0n ? 'negative' : 'neutral'
    };
  }

  if (ticket.claimed || ticket.status === 'claimed' || ticket.status === 'won' || ticket.status === 'refundable') {
    const settlement = safeBigInt(ticket.settlement_value_usdc);
    const cost = safeBigInt(ticket.cost_basis_usdc) ?? safeBigInt(ticket.stake_amount) ?? 0n;
    if (settlement !== null) {
      const diff = settlement - cost;
      return {
        display: formatSignedUsdPrice(diff),
        tone: diff > 0n ? 'positive' : diff < 0n ? 'negative' : 'neutral'
      };
    }
    if (ticket.claimed || ticket.status === 'claimed') return { display: 'Claimed', tone: 'positive' };
    return { display: 'Claimable', tone: ticket.status === 'refundable' ? 'neutral' : 'positive' };
  }

  if (ticket.status === 'active' || ticket.status === 'listed') {
    return { display: 'Pending', tone: 'neutral' };
  }

  if (ticket.status === 'lost') {
    const cost = safeBigInt(ticket.cost_basis_usdc) ?? safeBigInt(ticket.stake_amount) ?? 0n;
    return {
      display: `-${formatUsdPrice(cost)}`,
      tone: 'negative'
    };
  }

  return { display: '—', tone: 'neutral' };
}

function computeActivityPnl(value: string | null | undefined): { display: string; tone: 'positive' | 'negative' | 'neutral' } {
  const pnl = safeBigInt(value);
  if (pnl === null) return { display: 'Pending', tone: 'neutral' };
  return {
    display: formatSignedUsdPrice(pnl),
    tone: pnl > 0n ? 'positive' : pnl < 0n ? 'negative' : 'neutral'
  };
}

function safeBigInt(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    return null;
  }
}

function formatSignedUsdPrice(value: bigint) {
  const sign = value > 0n ? '+' : value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${formatUsdPrice(absolute)}`;
}
