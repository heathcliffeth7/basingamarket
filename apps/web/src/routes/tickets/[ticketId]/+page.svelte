<script lang="ts">
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { ArrowLeft, ExternalLink, Share2 } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';
  import PositionTimeline from '$lib/components/market/PositionTimeline.svelte';
  import ShareCardPreview from '$lib/components/market/ShareCardPreview.svelte';
  import { formatTokenAmount, formatUsdPrice } from '$lib/utils/amount';

  let { data }: { data: { ticketId: string } } = $props();
  const ticketId = $derived(data.ticketId);

  let shareCardId = $state<string | null>(null);
  let toast = $state('');

  const ticketQuery = createQuery(() => ({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.getTicket(ticketId)
  }));

  const marketQuery = createQuery(() => ({
    queryKey: ['ticket-market', ticketQuery.data?.market_id],
    queryFn: () => api.getMarket(ticketQuery.data?.market_id ?? ''),
    enabled: Boolean(ticketQuery.data?.market_id)
  }));

  const shareQuery = createQuery(() => ({
    queryKey: ['share-card', shareCardId],
    queryFn: () => api.getShareCard(shareCardId ?? ''),
    enabled: Boolean(shareCardId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'rendering' ? 1500 : false;
    }
  }));

  const shareMutation = createMutation(() => ({
    mutationFn: (nextTicketId: string) => api.requestShareRender(nextTicketId),
    onSuccess: (render) => {
      shareCardId = render.share_card_id;
      toast = `Share render ${render.status}.`;
    }
  }));

  const outcomeLabel = $derived(
    marketQuery.data?.outcomes.find((outcome) => outcome.outcome_id === ticketQuery.data?.outcome_id)?.label ??
      `Outcome ${ticketQuery.data?.outcome_id ?? '-'}`
  );
</script>

<svelte:head>
  <title>Ticket {ticketId} | basingamarket</title>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <div class="mb-4 flex items-center justify-between gap-3">
    <Button href={ticketQuery.data ? `/markets/${ticketQuery.data.market_id}` : '/markets'} variant="ghost">
      <ArrowLeft size={15} /> Market
    </Button>
    {#if toast}
      <Toast message={toast} tone="positive" />
    {/if}
  </div>

  {#if ticketQuery.isLoading}
    <Skeleton class="aspect-[1200/630]" />
  {:else if ticketQuery.data}
    <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div class="terminal-panel p-5">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-terminal-line-strong pb-5">
          <div>
            <p class="mono-label text-terminal-muted">position receipt</p>
            <h1 class="mt-2 text-3xl font-black text-terminal-text">Ticket #{ticketId}</h1>
            <p class="mt-2 text-base text-terminal-muted">Outcome: <span class="font-black text-terminal-text">{outcomeLabel}</span></p>
          </div>
          <Badge tone={ticketQuery.data.status === 'listed' ? 'warning' : ticketQuery.data.status === 'won' ? 'success' : ticketQuery.data.status === 'lost' ? 'negative' : 'neutral'}>
            {ticketQuery.data.status}
          </Badge>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">stake</p>
            <p class="mt-2 font-mono text-xl text-terminal-text">{formatTokenAmount(ticketQuery.data.stake_amount)}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">avg entry</p>
            <p class="mt-2 font-mono text-xl text-terminal-text">{formatUsdPrice(ticketQuery.data.entry_odds)}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">confidence</p>
            <p class="mt-2 font-mono text-xl text-terminal-text">{ticketQuery.data.confidence}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">listed ask</p>
            <p class="mt-2 font-mono text-xl text-terminal-text">
              {ticketQuery.data.listed_price ? formatTokenAmount(ticketQuery.data.listed_price) : 'none'}
            </p>
          </div>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">original caller</p>
            <p class="mt-2 break-all font-mono text-sm text-terminal-text">{ticketQuery.data.original_caller}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
            <p class="mono-label text-terminal-muted">current owner</p>
            <p class="mt-2 break-all font-mono text-sm text-terminal-text">{ticketQuery.data.current_owner}</p>
          </div>
        </div>

        <div class="mt-6">
          <h2 class="mb-3 text-lg font-semibold text-terminal-text">Ownership trail</h2>
          <PositionTimeline ticket={ticketQuery.data} />
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <Button href={`/markets/${ticketQuery.data.market_id}`} variant="secondary">Manage in market</Button>
          <Button variant="secondary" onclick={() => shareMutation.mutate(ticketId)} disabled={shareMutation.isPending}>
            <Share2 size={15} /> Render share card
          </Button>
          <Button variant="ghost" href={`/profiles/${ticketQuery.data.current_owner}`}>
            <ExternalLink size={15} /> Owner profile
          </Button>
        </div>
      </div>

      <ShareCardPreview
        share={shareQuery.data}
        render={shareMutation.data}
        onRender={() => shareMutation.mutate(ticketId)}
      />
    </section>
  {:else}
    <section class="terminal-panel p-6">
      <Badge tone="negative">not found</Badge>
      <p class="mt-3 text-terminal-muted">This ticket could not be loaded.</p>
    </section>
  {/if}
</main>
