<script lang="ts">
  import { onMount } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Activity, BadgeDollarSign, ChartNoAxesCombined, ListChecks, RefreshCcw } from 'lucide-svelte';
  import { api, marketWebSocketUrl } from '$lib/api/client';
  import { isMockFallbackEnabled } from '$lib/api/env';
  import { evaluateMarketDelta } from '$lib/api/realtime';
  import type { CanvasNode } from '$lib/api/types';
  import { deriveMarketSignals, deriveSimpleMarketRead } from '$lib/utils/signals';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import MarketActionPanel from '$lib/components/market/MarketActionPanel.svelte';
  import MarketCanvas from '$lib/components/market/MarketCanvas.svelte';
  import MarketPulseStrip from '$lib/components/market/MarketPulseStrip.svelte';
  import MarketStatusBar from '$lib/components/market/MarketStatusBar.svelte';
  import OddsStrip from '$lib/components/market/OddsStrip.svelte';
  import { formatTokenAmount } from '$lib/utils/amount';

  let { data }: { data: { marketId: string } } = $props();
  const marketId = $derived(data.marketId);
  const queryClient = useQueryClient();

  let selectedNode: CanvasNode | null = $state(null);
  let realtimeState = $state<'connecting' | 'live' | 'refetching' | 'offline'>('connecting');
  let drawerOpen = $state(false);
  let drawerTab = $state<'details' | 'listed' | 'activity'>('details');
  let drawerSide: 'right' | 'bottom' = $state('right');
  let canvasMode: 'simple' | 'detail' = $state('simple');
  let actionPanelOpen = $state(false);

  const marketQuery = createQuery(() => ({
    queryKey: ['market', marketId],
    queryFn: () => api.getMarket(marketId)
  }));

  const canvasQuery = createQuery(() => ({
    queryKey: ['market-canvas', marketId],
    queryFn: () => api.getMarketCanvas(marketId)
  }));

  const ticketsQuery = createQuery(() => ({
    queryKey: ['market-tickets', marketId],
    queryFn: () => api.getMarketTickets(marketId)
  }));

  const signals = $derived(
    deriveMarketSignals({
      market: marketQuery.data,
      canvas: canvasQuery.data,
      tickets: ticketsQuery.data
    })
  );
  const simpleRead = $derived(
    deriveSimpleMarketRead({
      market: marketQuery.data,
      canvas: canvasQuery.data,
      tickets: ticketsQuery.data
    })
  );

  const listedTickets = $derived((ticketsQuery.data ?? []).filter((ticket) => ticket.listed_price));
  const topTickets = $derived([...(ticketsQuery.data ?? [])].sort((a, b) => b.confidence - a.confidence).slice(0, 5));

  function openDrawer(tab: 'details' | 'listed' | 'activity') {
    drawerTab = tab;
    drawerOpen = true;
  }

  function updateDrawerSide() {
    drawerSide = window.innerWidth < 768 ? 'bottom' : 'right';
  }

  function refetchMarketBundle() {
    realtimeState = 'refetching';
    void queryClient.invalidateQueries({ queryKey: ['market', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market-canvas', marketId] });
    void queryClient.invalidateQueries({ queryKey: ['market-tickets', marketId] });
    window.setTimeout(() => (realtimeState = 'live'), 500);
  }

  onMount(() => {
    updateDrawerSide();
    window.addEventListener('resize', updateDrawerSide);
    let lastSequence = canvasQuery.data?.market_sequence ?? marketQuery.data?.market_sequence ?? 0;

    const socket = new WebSocket(marketWebSocketUrl(marketId));
    socket.onopen = () => (realtimeState = 'live');
    socket.onclose = () => (realtimeState = 'offline');
    socket.onerror = () => (realtimeState = 'offline');
    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        refetchMarketBundle();
        return;
      }

      lastSequence = Math.max(
        lastSequence,
        canvasQuery.data?.market_sequence ?? marketQuery.data?.market_sequence ?? 0
      );
      const decision = evaluateMarketDelta({ message, marketId, lastSequence });
      if (decision.action === 'ignore') return;
      if (decision.action === 'refetch') {
        refetchMarketBundle();
        return;
      }

      lastSequence = decision.lastSequence;
      refetchMarketBundle();
    };

    return () => {
      window.removeEventListener('resize', updateDrawerSide);
      socket.close();
    };
  });
</script>

<svelte:head>
  <title>Market {marketId} | basingamarket</title>
</svelte:head>

<main class="mx-auto max-w-[1920px] px-4 py-3 sm:px-6 sm:py-4">
  {#if marketQuery.data}
    <MarketStatusBar market={marketQuery.data} />
  {:else}
    <div>
      <Skeleton class="h-24" />
    </div>
  {/if}

  <section class="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div class="min-w-0">
      <div class="xl:hidden">
        <MarketPulseStrip read={simpleRead} {realtimeState} mock={isMockFallbackEnabled} />
      </div>

      <div class="mt-2 hidden flex-wrap items-center justify-between gap-3 sm:flex xl:hidden">
        <div class="flex flex-wrap items-end gap-5">
          <div>
            <p class="text-xs font-bold text-terminal-muted">Visual capital</p>
            <p class="text-2xl font-black text-terminal-muted">{simpleRead.strengthLabel}</p>
          </div>
          <div>
            <p class="text-xs font-bold text-terminal-muted">Canvas read</p>
            <p class="text-2xl font-black text-terminal-text">{simpleRead.dominantOutcomeLabel}</p>
          </div>
        </div>
        <Button class="h-9 px-4 text-xs" variant="secondary" href={`/markets/${marketId}`}>
          Go to live market
        </Button>
      </div>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3 xl:mt-0">
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant={canvasMode === 'simple' ? 'default' : 'secondary'} onclick={() => (canvasMode = 'simple')}>
            Simple
          </Button>
          <Button size="sm" variant={canvasMode === 'detail' ? 'default' : 'secondary'} onclick={() => (canvasMode = 'detail')}>
            Detail
          </Button>
          <Button size="sm" variant="secondary" onclick={refetchMarketBundle}>
            <RefreshCcw size={14} /> Refetch
          </Button>
        </div>
      </div>

      <div class="mt-2">
        {#if canvasQuery.isLoading}
          <Skeleton class="aspect-[1200/630]" />
        {:else}
          <MarketCanvas
            canvas={canvasQuery.data}
            mode={canvasMode}
            {signals}
            simpleRead={simpleRead}
            mock={isMockFallbackEnabled}
            selectedTicketId={selectedNode?.ticket_id ?? null}
            onSelect={(node) => (selectedNode = node)}
            onClearSelection={() => (selectedNode = null)}
          />
        {/if}
      </div>

      {#if marketQuery.data}
        <div class="mt-5 flex gap-3 overflow-x-auto pb-1" aria-label="Outcome chips">
          {#each marketQuery.data.outcomes as outcome}
            <div
              class={`shrink-0 rounded-full px-5 py-3 text-sm font-black ${
                simpleRead.dominantOutcomeId === String(outcome.outcome_id)
                  ? 'bg-market-positive text-white'
                  : 'bg-terminal-panel text-terminal-text'
              }`}
            >
              <span>{outcome.label}</span>
              <span class="ml-2 font-mono">{Math.round(Number(outcome.current_odds) / 10000)}%</span>
            </div>
          {/each}
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <div class="flex flex-wrap gap-2">
            <Button class="xl:hidden" onclick={() => (actionPanelOpen = true)}>
              <BadgeDollarSign size={15} /> Trade intents
            </Button>
            <Button variant="secondary" onclick={() => openDrawer('details')}>
              <ListChecks size={15} /> Details
            </Button>
            <Button variant="secondary" onclick={() => openDrawer('listed')}>
              <BadgeDollarSign size={15} /> Listed tickets
            </Button>
            <Button variant="secondary" onclick={() => openDrawer('activity')}>
              <Activity size={15} /> Activity
            </Button>
          </div>
        </div>
      {/if}
    </div>

    <div class="hidden xl:block">
      <div class="sticky top-20">
        <MarketActionPanel
          {simpleRead}
          {signals}
          {listedTickets}
          {topTickets}
          {realtimeState}
          marketHref={`/markets/${marketId}`}
          mock={isMockFallbackEnabled}
          onOpenDetails={() => openDrawer('details')}
          onOpenListed={() => openDrawer('listed')}
          onOpenActivity={() => openDrawer('activity')}
        />
      </div>
    </div>
  </section>

  <div class="xl:hidden">
    <Sheet open={actionPanelOpen} side="bottom" onClose={() => (actionPanelOpen = false)}>
      <MarketActionPanel
        {simpleRead}
        {signals}
        {listedTickets}
        {topTickets}
        {realtimeState}
        marketHref={`/markets/${marketId}`}
        mock={isMockFallbackEnabled}
        onOpenDetails={() => {
          actionPanelOpen = false;
          openDrawer('details');
        }}
        onOpenListed={() => {
          actionPanelOpen = false;
          openDrawer('listed');
        }}
        onOpenActivity={() => {
          actionPanelOpen = false;
          openDrawer('activity');
        }}
      />
    </Sheet>
  </div>

  <!-- Mobile sheet -->
  <div class="sm:hidden">
    <Sheet open={Boolean(selectedNode)} side="bottom" onClose={() => (selectedNode = null)}>
      {#if selectedNode}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-terminal-text">Ticket #{selectedNode.ticket_id}</h2>
            <Button size="icon" variant="ghost" onclick={() => (selectedNode = null)} aria-label="Close">x</Button>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <p class="mono-label text-terminal-muted">Owner</p>
              <p class="mt-1 truncate font-mono text-terminal-text">{selectedNode.owner_display}</p>
            </div>
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <p class="mono-label text-terminal-muted">Listed</p>
              <p class="mt-1 font-mono text-terminal-text">{selectedNode.listed_price ? formatTokenAmount(selectedNode.listed_price) : selectedNode.status}</p>
            </div>
          </div>
          <div class="flex gap-2">
            <Button href={`/tickets/${selectedNode.ticket_id}`}>Open ticket</Button>
            <Button variant="secondary" onclick={() => (selectedNode = null)}>Buy intent</Button>
          </div>
        </div>
      {/if}
    </Sheet>
  </div>

  <Sheet open={drawerOpen} side={drawerSide} onClose={() => (drawerOpen = false)}>
    <div class="space-y-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="mono-label text-terminal-muted">Market drawer</p>
          <h2 class="text-lg font-semibold text-terminal-text">
            {drawerTab === 'details' ? 'Details' : drawerTab === 'listed' ? 'Listed tickets' : 'Activity'}
          </h2>
        </div>
        <Button size="icon" variant="ghost" onclick={() => (drawerOpen = false)} aria-label="Close market drawer">x</Button>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant={drawerTab === 'details' ? 'default' : 'secondary'} onclick={() => (drawerTab = 'details')}>Details</Button>
        <Button size="sm" variant={drawerTab === 'listed' ? 'default' : 'secondary'} onclick={() => (drawerTab = 'listed')}>Listed tickets</Button>
        <Button size="sm" variant={drawerTab === 'activity' ? 'default' : 'secondary'} onclick={() => (drawerTab = 'activity')}>Activity</Button>
      </div>

      {#if drawerTab === 'details'}
        <div class="space-y-4">
          <div class="grid gap-2 text-sm">
            <div class="flex justify-between gap-3 rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <span class="text-terminal-muted">Crowd read</span>
              <span class="text-right font-mono text-terminal-text">leans {simpleRead.dominantOutcomeLabel}</span>
            </div>
            <div class="flex justify-between gap-3 rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <span class="text-terminal-muted">Strength</span>
              <span class="text-right font-mono text-terminal-text">{simpleRead.strengthLabel}</span>
            </div>
            <div class="flex justify-between gap-3 rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <span class="text-terminal-muted">Confidence</span>
              <span class="text-right font-mono text-terminal-text">{simpleRead.confidenceLabel}</span>
            </div>
          </div>
          {#if marketQuery.data}
            <OddsStrip outcomes={marketQuery.data.outcomes} />
          {/if}
          <div class="space-y-2 text-sm">
            <h3 class="inline-flex items-center gap-2 text-base font-semibold text-terminal-text">
              <ChartNoAxesCombined size={16} /> Advanced read
            </h3>
            <div class="flex justify-between gap-3">
              <span class="text-terminal-muted">Users</span>
              <span class="font-mono text-terminal-text">{signals.userConcentrationLabel}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-terminal-muted">Mood</span>
              <span class="font-mono text-terminal-text">{signals.moodLabel}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-terminal-muted">Late flow</span>
              <span class="font-mono text-terminal-text">{signals.lateFlowLabel}</span>
            </div>
          </div>
        </div>
      {:else if drawerTab === 'listed'}
        <div class="space-y-2">
          {#each (listedTickets.length ? listedTickets : topTickets).slice(0, 8) as ticket (ticket.ticket_id)}
            <a href={`/tickets/${ticket.ticket_id}`} class="block rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <div class="flex items-center justify-between gap-3">
                <span class="font-mono text-sm text-terminal-text">#{ticket.ticket_id}</span>
                <Badge tone={ticket.status === 'listed' ? 'warning' : ticket.status === 'won' ? 'success' : ticket.status === 'lost' ? 'negative' : 'neutral'}>{ticket.status}</Badge>
              </div>
              <div class="mt-2 flex justify-between gap-3 text-xs">
                <span class="text-terminal-muted">Cashout uses BUSDC</span>
                <span class="font-mono text-terminal-text">{formatTokenAmount(ticket.stake_amount)}</span>
              </div>
            </a>
          {/each}
          {#if topTickets.length === 0}
            <p class="text-sm text-terminal-muted">No ticket projection available.</p>
          {/if}
        </div>
      {:else}
        <div class="space-y-2">
          {#each listedTickets.slice(0, 6) as ticket (ticket.ticket_id)}
            <a href={`/tickets/${ticket.ticket_id}`} class="flex items-center justify-between gap-3 rounded-2xl border border-market-warning/35 bg-terminal-bg px-3 py-2 text-sm">
              <span class="font-mono text-terminal-text">Ticket #{ticket.ticket_id}</span>
              <span class="mono-label text-market-warning">listed {formatTokenAmount(ticket.listed_price)}</span>
            </a>
          {/each}
          {#if listedTickets.length === 0}
            <p class="text-sm text-terminal-muted">Activity is hidden by default. Late flow: {signals.lateFlowLabel}</p>
          {/if}
        </div>
      {/if}
    </div>
  </Sheet>
</main>
