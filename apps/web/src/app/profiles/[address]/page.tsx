'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Copy, Ticket, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api/client';
import Button from '@/lib/components/ui/Button';
import Badge from '@/lib/components/ui/Badge';
import Skeleton from '@/lib/components/ui/Skeleton';
import ShareCardPreview from '@/lib/components/market/ShareCardPreview';

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const [copied, setCopied] = useState(false);
  const profileQuery = useQuery({ queryKey: ['profile', address], queryFn: () => api.getProfile(address) });
  const positionQuery = useQuery({
    queryKey: ['profile-positions', address],
    queryFn: async () => {
      const markets = await api.getMarkets();
      const ticketLists = await Promise.all(markets.map((market) => api.getMarketTickets(market.market_id).catch(() => [])));
      return ticketLists.flat().filter((ticket) => ticket.current_owner === address || ticket.original_caller === address);
    }
  });
  const ownedTickets = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.current_owner === address), [address, positionQuery.data]);
  const originalCalls = useMemo(() => (positionQuery.data ?? []).filter((ticket) => ticket.original_caller === address), [address, positionQuery.data]);
  const listedTickets = ownedTickets.filter((ticket) => Boolean(ticket.listed_price));
  const winningTickets = ownedTickets.filter((ticket) => ticket.status === 'won' || ticket.status === 'claimed');
  const bestEarlyCall = [...originalCalls].sort((a, b) => b.confidence - a.confidence)[0];
  const color = identiconColor(address);

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
                <Stat icon={<Ticket size={13} />} label="owned tickets" value={positionQuery.isLoading ? 'loading' : String(ownedTickets.length)} />
                <Stat icon={<Activity size={13} />} label="listed positions" value={positionQuery.isLoading ? 'loading' : String(listedTickets.length)} />
              </div>
              <div className="mt-5"><Badge tone={copied ? 'positive' : 'neutral'}>{copied ? 'copied' : 'normalized wallet'}</Badge></div>
            </div>
            <div className="terminal-panel p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-terminal-text">Position history preview</h2>
                <Badge tone={positionQuery.isError ? 'warning' : 'neutral'}>{positionQuery.isError ? 'projection pending' : 'projection read'}</Badge>
              </div>
              {positionQuery.isLoading ? <Skeleton className="h-32" /> : (positionQuery.data ?? []).length === 0 ? <p className="text-sm text-terminal-muted">No owned or original-call tickets found in the current market projection.</p> : (
                <div className="space-y-2">
                  {(positionQuery.data ?? []).slice(0, 6).map((ticket) => (
                    <a key={ticket.ticket_id} href={`/tickets/${ticket.ticket_id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-market-neutral/35 bg-terminal-bg px-3 py-2 text-sm">
                      <span className="text-terminal-muted">{ticket.original_caller === address ? 'Original call' : 'Held ticket'}</span>
                      <span className="font-mono text-terminal-text">#{ticket.ticket_id}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="terminal-panel p-5">
              <h2 className="mb-3 text-base font-semibold text-terminal-text">Forecast badges</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3"><p className="mono-label text-terminal-muted">winning tickets</p><p className="mt-1 font-mono text-terminal-text">{positionQuery.isLoading ? 'loading' : winningTickets.length}</p></div>
                <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3"><p className="mono-label text-terminal-muted">best early call</p><p className="mt-1 truncate font-mono text-terminal-text">{bestEarlyCall ? `#${bestEarlyCall.ticket_id} · ${bestEarlyCall.confidence}` : 'projection pending'}</p></div>
              </div>
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
