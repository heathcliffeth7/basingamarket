'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, Copy, DollarSign, LayoutList, Loader2, Ticket as TicketIcon, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cashBalanceQueryKey } from '@/lib/api/cashBalanceQuery';
import { useAuth } from '@/lib/auth/privy';
import Button from '@/lib/components/ui/Button';
import Badge from '@/lib/components/ui/Badge';
import Skeleton from '@/lib/components/ui/Skeleton';
import ShareCardPreview from '@/lib/components/market/ShareCardPreview';
import type { Ticket as MarketTicket } from '@/lib/api/types';
import { formatUsdPrice } from '@/lib/utils/amount';

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const queryClient = useQueryClient();
  const { getAccessToken, solanaWalletAddress } = useAuth();
  const [copied, setCopied] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const profileQuery = useQuery({ queryKey: ['profile', address], queryFn: () => api.getProfile(address) });
  const positionQuery = useQuery({
    queryKey: ['profile-positions', address],
    queryFn: () => api.getProfileTickets(address)
  });
  const ownedTickets = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.current_owner === address), [address, positionQuery.data]);
  const originalCalls = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.original_caller === address), [address, positionQuery.data]);
  const listedTickets = ownedTickets.filter((ticket) => Boolean(ticket.listed_price));
  const settledTickets = ownedTickets.filter((ticket) => ticket.status === 'won' || ticket.status === 'claimed' || ticket.status === 'refundable');
  const bestEarlyCall = [...originalCalls].sort((a, b) => b.confidence - a.confidence)[0];
  const color = identiconColor(address);
  const canClaimAsOwner = solanaWalletAddress === address;
  const claimTicketMutation = useMutation({
    mutationFn: async (ticket: MarketTicket) => {
      if (!solanaWalletAddress) throw new Error('Solana wallet unavailable.');
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Login session required.');
      return api.claimTicket({
        ticketId: ticket.ticket_id,
        claimerWallet: solanaWalletAddress,
        accessToken
      });
    },
    onSuccess: (result) => {
      setClaimMessage(`Claimed ${formatUsdPrice(result.amount)} from #${result.ticket_id}`);
      syncClaimedTicketCache(result.ticket);
      void queryClient.invalidateQueries({ queryKey: ['ticket', result.ticket_id] });
      void queryClient.invalidateQueries({ queryKey: ['profile-positions', address] });
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

  // Sort user tickets by newest first (highest ticket_id first)
  const sortedActivity = useMemo(() => {
    return [...ownedTickets].sort((a, b) => {
      const aId = Number(a.ticket_id) || 0;
      const bId = Number(b.ticket_id) || 0;
      return bId - aId;
    });
  }, [ownedTickets]);

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Button href="/markets" variant="ghost"><ArrowLeft size={15} /> Markets</Button>
      </div>
      {profileQuery.isLoading ? (
        <Skeleton className="h-96" />
      ) : profileQuery.data ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <div className="terminal-panel p-5">
              <div className="mb-6 flex items-start gap-4 border-b border-terminal-line-strong pb-5">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl border font-mono text-xl font-bold" style={{ borderColor: color, background: `${color}15`, color }}>
                  {address.slice(2, 4).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mono-label text-terminal-muted">forecast identity</p>
                  <h1 className="mt-2 text-2xl font-black text-terminal-text">{profileQuery.data.display_name ?? 'Unnamed wallet'}</h1>
                  <p className="mt-2 break-all font-mono text-sm text-terminal-muted">{profileQuery.data.wallet_address}</p>
                </div>
                <Button size="icon" variant="secondary" onClick={copyAddress} aria-label="Copy address"><Copy size={15} /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat icon={<TrendingUp size={13} />} label="original calls" value={positionQuery.isLoading ? 'loading' : String(originalCalls.length)} />
                <Stat icon={<TicketIcon size={13} />} label="owned tickets" value={positionQuery.isLoading ? 'loading' : String(ownedTickets.length)} />
                <Stat icon={<Activity size={13} />} label="listed positions" value={positionQuery.isLoading ? 'loading' : String(listedTickets.length)} />
              </div>
              <div className="mt-5"><Badge tone={copied ? 'positive' : 'neutral'}>{copied ? 'copied' : 'normalized wallet'}</Badge></div>
            </div>

            {/* Total Activity — position feed */}
            <div className="terminal-panel p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-terminal-text inline-flex items-center gap-2">
                  <DollarSign size={16} /> Total activity
                </h2>
                <Badge tone={positionQuery.isLoading ? 'warning' : 'neutral'}>
                  {positionQuery.isLoading ? 'loading' : `${ownedTickets.length} position${ownedTickets.length === 1 ? '' : 's'}`}
                </Badge>
              </div>
              {claimMessage ? <p className="mb-3 text-xs font-semibold text-terminal-muted">{claimMessage}</p> : null}
              {positionQuery.isLoading ? (
                <Skeleton className="h-32" />
              ) : sortedActivity.length === 0 ? (
                <p className="text-sm text-terminal-muted">No trading activity found.</p>
              ) : (
                <div className="space-y-2">
                  {sortedActivity.map((ticket) => {
                    const side = sideFromTicket(ticket);
                    const marketName = marketIdLabel(ticket);
                    const pnl = computeTicketPnl(ticket);
                    const cost = ticket.cost_basis_usdc ?? ticket.stake_amount;
                    const claimable = canClaimTicket(ticket);
                    const showClaimButton = canClaimAsOwner && claimable;
                    const claimPending = claimTicketMutation.isPending
                      && claimTicketMutation.variables?.ticket_id === ticket.ticket_id;

                    return (
                      <div key={ticket.ticket_id} className="flex items-center justify-between gap-3 rounded-xl border border-terminal-line bg-terminal-bg px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-terminal-text">{marketName}</span>
                            <Badge
                              tone={side === 'UP' ? 'positive' : 'negative'}
                              className="shrink-0 text-[10px] px-1.5 py-0"
                            >
                              {side}
                            </Badge>
                            <Badge
                              tone={ticket.status === 'won' || ticket.status === 'claimed' ? 'positive' : ticket.status === 'refundable' || ticket.status === 'listed' ? 'warning' : ticket.status === 'lost' ? 'negative' : 'neutral'}
                              className="shrink-0 text-[10px] px-1.5 py-0"
                            >
                              {ticket.status}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-terminal-muted">
                            <span>Amount: {formatUsdPrice(cost)}</span>
                            {ticket.listed_price ? (
                              <span>· Listed: {formatUsdPrice(ticket.listed_price)}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <a href={`/tickets/${ticket.ticket_id}`} className="font-mono text-xs font-bold text-market-positive hover:underline">#{ticket.ticket_id}</a>
                          <p className={`mt-0.5 text-xs font-black ${pnl.tone === 'positive' ? 'text-market-positive' : pnl.tone === 'negative' ? 'text-market-negative' : 'text-terminal-muted'}`}>
                            {pnl.display}
                          </p>
                          {showClaimButton ? (
                            <Button
                              className="mt-2 h-8 px-3 text-xs"
                              disabled={claimPending}
                              onClick={() => claimTicketMutation.mutate(ticket)}
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
                  })}
                </div>
              )}
            </div>

            <div className="terminal-panel p-5">
              <h2 className="mb-3 text-base font-semibold text-terminal-text">Forecast badges</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3"><p className="mono-label text-terminal-muted">settled tickets</p><p className="mt-1 font-mono text-terminal-text">{positionQuery.isLoading ? 'loading' : settledTickets.length}</p></div>
                <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3"><p className="mono-label text-terminal-muted">best early call</p><p className="mt-1 truncate font-mono text-terminal-text">{bestEarlyCall ? `#${bestEarlyCall.ticket_id} · ${bestEarlyCall.confidence}` : 'projection pending'}</p></div>
              </div>
            </div>

            <div className="terminal-panel p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-terminal-text inline-flex items-center gap-2">
                  <LayoutList size={16} /> Position history preview
                </h2>
                <Badge tone={positionQuery.isError ? 'warning' : 'neutral'}>{positionQuery.isError ? 'projection pending' : 'projection read'}</Badge>
              </div>
              {positionQuery.isLoading ? <Skeleton className="h-32" /> : (positionQuery.data ?? []).length === 0 ? <p className="text-sm text-terminal-muted">No owned or original-call tickets found in the current market projection.</p> : (
                <div className="space-y-2">
                  {(positionQuery.data ?? []).slice(0, 6).map((ticket) => (
                    <a key={ticket.ticket_id} href={`/tickets/${ticket.ticket_id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-market-neutral/35 bg-terminal-bg px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-terminal-muted shrink-0">{ticket.original_caller === address ? 'Original call' : 'Held ticket'}</span>
                        <span className="truncate text-xs text-terminal-text">{marketIdLabel(ticket)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone={ticket.status === 'won' || ticket.status === 'claimed' ? 'positive' : ticket.status === 'refundable' || ticket.status === 'listed' ? 'warning' : ticket.status === 'lost' ? 'negative' : 'neutral'} className="text-[10px]">
                          {ticket.status}
                        </Badge>
                        <span className="font-mono text-terminal-text">#{ticket.ticket_id}</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          <ShareCardPreview share={{ id: `profile-${address}`, kind: 'profile', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }} />
        </section>
      ) : (
        <section className="terminal-panel p-6">
          <Badge tone="negative">not found</Badge>
          <p className="mt-3 text-terminal-muted">This profile could not be loaded.</p>
        </section>
      )}
    </main>
  );
}

function identiconColor(addr: string) {
  const seed = Array.from(addr.slice(0, 12)).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = seed % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
      <p className="mono-label inline-flex items-center gap-1 text-terminal-muted">{icon} {label}</p>
      <p className="mt-2 font-mono text-xl text-terminal-text">{value}</p>
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

function computeTicketPnl(ticket: {
  status: string;
  claimed?: boolean;
  realized_pnl_usdc?: string | null;
  cost_basis_usdc?: string;
  stake_amount: string;
  settlement_value_usdc?: string | null;
}): { display: string; tone: 'positive' | 'negative' | 'neutral' } {
  if (ticket.claimed || ticket.status === 'claimed' || ticket.status === 'won' || ticket.status === 'refundable') {
    const pnl = safeBigInt(ticket.realized_pnl_usdc);
    if (pnl !== null) {
      return {
        display: formatSignedUsdPrice(pnl),
        tone: pnl > 0n ? 'positive' : pnl < 0n ? 'negative' : 'neutral'
      };
    }
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
    const pnl = safeBigInt(ticket.realized_pnl_usdc);
    if (pnl !== null) {
      return {
        display: formatSignedUsdPrice(pnl),
        tone: pnl > 0n ? 'positive' : 'negative'
      };
    }
    const cost = safeBigInt(ticket.cost_basis_usdc) ?? safeBigInt(ticket.stake_amount) ?? 0n;
    return {
      display: `-${formatUsdPrice(cost)}`,
      tone: 'negative'
    };
  }

  return { display: '—', tone: 'neutral' };
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
