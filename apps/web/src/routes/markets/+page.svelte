<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { Filter, Search, Sparkles } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import { isMockFallbackEnabled } from '$lib/api/env';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import LiveConnectionBadge from '$lib/components/market/LiveConnectionBadge.svelte';
  import MarketRadarCard from '$lib/components/market/MarketRadarCard.svelte';

  type FilterMode = 'movers' | 'open' | 'closing' | 'resolved' | 'demo';

  let filter: FilterMode = $state('movers');
  let search = $state('');

  const marketsQuery = createQuery(() => ({
    queryKey: ['markets'],
    queryFn: () => api.getMarkets()
  }));

  const normalizedSearch = $derived(search.trim().toLowerCase());
  const filterTabs: { mode: FilterMode; label: string }[] = [
    { mode: 'movers', label: 'Movers' },
    { mode: 'open', label: 'Open' },
    { mode: 'closing', label: 'Closing' },
    { mode: 'resolved', label: 'Resolved' },
    { mode: 'demo', label: 'Demo' }
  ];

  const filteredMarkets = $derived(
    (marketsQuery.data ?? [])
      .filter((market) => {
        if (filter === 'demo') return isMockFallbackEnabled;
        if (filter === 'resolved') return market.status === 'resolved';
        if (filter === 'closing') return market.status === 'open' && market.trade_until * 1000 - Date.now() < 86400000 * 3;
        if (filter === 'open') return market.status === 'open';
        return true;
      })
      .filter((market) => {
        if (!normalizedSearch) return true;
        const searchable = [
          market.question_hash,
          market.status,
          ...market.outcomes.map((outcome) => outcome.label)
        ].join(' ').toLowerCase();
        return searchable.includes(normalizedSearch);
      })
  );

  const connectionStatus = $derived(marketsQuery.isError ? 'offline' : marketsQuery.isFetching ? 'refetching' : 'live');
</script>

<svelte:head>
  <title>Markets | basingamarket</title>
</svelte:head>

<main class="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
  <section class="mb-5 space-y-4">
    <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <h1 class="text-3xl font-black text-terminal-text">Markets</h1>
        <p class="mt-2 max-w-3xl text-sm leading-relaxed text-terminal-muted">
          Browse live sentiment markets and open the field that is leaning hardest.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <LiveConnectionBadge status={connectionStatus} label={connectionStatus === 'refetching' ? 'Refetching' : connectionStatus === 'offline' ? 'Offline' : 'Live'} />
        {#if isMockFallbackEnabled}
          <LiveConnectionBadge status="mock" />
        {/if}
      </div>
    </div>

    <div class="flex flex-col gap-3 rounded-2xl border border-terminal-line bg-terminal-panel p-3 xl:flex-row xl:items-center">
      <label class="relative min-w-0 flex-1">
        <span class="sr-only">Search markets</span>
        <Search class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-terminal-muted" size={18} />
        <Input class="pl-11" placeholder="Search markets..." bind:value={search} aria-label="Search markets" />
      </label>
      <div class="flex gap-2 overflow-x-auto pb-1 xl:pb-0" aria-label="Market filters">
        <span class="inline-flex shrink-0 items-center gap-1 px-2 text-sm font-semibold text-terminal-muted"><Filter size={13} /> Filters</span>
        {#each filterTabs as tab}
          <Button size="sm" variant={filter === tab.mode ? 'default' : 'secondary'} onclick={() => (filter = tab.mode)}>
            {#if tab.mode === 'movers'}
              <Sparkles size={14} />
            {/if}
            {tab.label}
          </Button>
        {/each}
      </div>
    </div>
  </section>

  {#if marketsQuery.isLoading}
    <div class="grid gap-3">
      {#each Array(6) as _}
        <Skeleton class="h-36" />
      {/each}
    </div>
  {:else if marketsQuery.isError}
    <section class="terminal-panel p-6">
      <Badge tone="negative">API unavailable</Badge>
      <p class="mt-3 text-sm text-terminal-muted">The market list could not be loaded.</p>
    </section>
  {:else if filteredMarkets.length === 0}
    <section class="terminal-panel grid min-h-[360px] place-items-center p-8 text-center">
      <div>
        <p class="mono-label text-terminal-muted">empty state</p>
        <h2 class="mt-2 text-2xl font-semibold text-terminal-text">No markets match this search.</h2>
        <p class="mt-2 text-sm text-terminal-muted">Clear search, switch filters, or start the Rust API with seeded projections.</p>
      </div>
    </section>
  {:else}
    <section class="grid gap-3">
      {#each filteredMarkets as market (market.market_id)}
        <MarketRadarCard {market} />
      {/each}
    </section>
  {/if}
</main>
