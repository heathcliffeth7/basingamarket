'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Share2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/privy';
import Button from '@/lib/components/ui/Button';
import Badge from '@/lib/components/ui/Badge';
import Skeleton from '@/lib/components/ui/Skeleton';
import Toast from '@/lib/components/ui/Toast';
import PositionTimeline from '@/lib/components/market/PositionTimeline';
import ShareCardPreview from '@/lib/components/market/ShareCardPreview';
import { formatTokenAmount, formatUsdPrice } from '@/lib/utils/amount';

export default function TicketPage() {
  const params = useParams<{ ticketId: string }>();
  const { ready, authenticated, privyConfigured, loginSolana, getAccessToken } = useAuth();
  const ticketId = params.ticketId;
  const [shareCardId, setShareCardId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const ticketQuery = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => api.getTicket(ticketId) });
  const marketQuery = useQuery({
    queryKey: ['ticket-market', ticketQuery.data?.market_id],
    queryFn: () => api.getMarket(ticketQuery.data?.market_id ?? ''),
    enabled: Boolean(ticketQuery.data?.market_id)
  });
  const shareQuery = useQuery({
    queryKey: ['share-card', shareCardId],
    queryFn: () => api.getShareCard(shareCardId ?? ''),
    enabled: Boolean(shareCardId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'rendering' ? 1500 : false;
    }
  });
  const shareMutation = useMutation({
    mutationFn: async (nextTicketId: string) => api.requestShareRender(nextTicketId, await requireAccessToken()),
    onSuccess: (render) => {
      setShareCardId(render.share_card_id);
      setToast(`Share render ${render.status}.`);
    },
    onError: (error) => {
      if ((error as Error).message !== 'auth_required') {
        setToast('Authentication required. Please login again.');
      }
    }
  });
  const outcomeLabel = marketQuery.data?.outcomes.find((outcome) => outcome.outcome_id === ticketQuery.data?.outcome_id)?.label ?? `Outcome ${ticketQuery.data?.outcome_id ?? '-'}`;

  async function requireAccessToken() {
    if (!ready || !authenticated) {
      if (privyConfigured) {
        void loginSolana();
      }
      throw new Error('auth_required');
    }
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('auth_token_unavailable');
    }
    return accessToken;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button href={ticketQuery.data ? `/markets/${ticketQuery.data.market_id}` : '/markets'} variant="ghost"><ArrowLeft size={15} /> Market</Button>
        {toast ? <Toast message={toast} tone="positive" /> : null}
      </div>
      {ticketQuery.isLoading ? (
        <Skeleton className="aspect-[1200/630]" />
      ) : ticketQuery.data ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="terminal-panel p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-terminal-line-strong pb-5">
              <div>
                <p className="mono-label text-terminal-muted">position receipt</p>
                <h1 className="mt-2 text-3xl font-black text-terminal-text">{ticketQuery.data.token_name ? `${ticketQuery.data.token_name} #${ticketId}` : `Ticket #${ticketId}`}</h1>
                <p className="mt-2 text-base text-terminal-muted">Outcome: <span className="font-black text-terminal-text">{outcomeLabel}</span></p>
              </div>
              <Badge tone={ticketQuery.data.status === 'listed' ? 'warning' : ticketQuery.data.status === 'won' ? 'success' : ticketQuery.data.status === 'lost' ? 'negative' : 'neutral'}>{ticketQuery.data.status}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="stake" value={formatTokenAmount(ticketQuery.data.stake_amount)} />
              <Metric label="avg entry" value={formatUsdPrice(ticketQuery.data.entry_odds)} />
              <Metric label="confidence" value={String(ticketQuery.data.confidence)} />
              <Metric label="listed ask" value={ticketQuery.data.listed_price ? formatTokenAmount(ticketQuery.data.listed_price) : 'none'} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Metric label="original caller" value={ticketQuery.data.original_caller} />
              <Metric label="current owner" value={ticketQuery.data.current_owner} />
            </div>
            <div className="mt-6">
              <h2 className="mb-3 text-lg font-semibold text-terminal-text">Ownership trail</h2>
              <PositionTimeline ticket={ticketQuery.data} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button href={`/markets/${ticketQuery.data.market_id}`} variant="secondary">Manage in market</Button>
              <Button variant="secondary" onClick={() => shareMutation.mutate(ticketId)} disabled={!ready || shareMutation.isPending}><Share2 size={15} /> Render share card</Button>
              <Button variant="ghost" href={`/profiles/${ticketQuery.data.current_owner}`}><ExternalLink size={15} /> Owner profile</Button>
            </div>
          </div>
          <ShareCardPreview share={shareQuery.data} render={shareMutation.data} onRender={() => shareMutation.mutate(ticketId)} disabled={!ready || shareMutation.isPending} />
        </section>
      ) : (
        <section className="terminal-panel p-6">
          <Badge tone="negative">not found</Badge>
          <p className="mt-3 text-terminal-muted">This ticket could not be loaded.</p>
        </section>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
      <p className="mono-label text-terminal-muted">{label}</p>
      <p className="mt-2 break-all font-mono text-xl text-terminal-text">{value}</p>
    </div>
  );
}
