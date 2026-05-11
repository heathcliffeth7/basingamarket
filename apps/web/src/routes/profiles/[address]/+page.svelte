<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowLeft, Copy, UserRound, Ticket, Activity, TrendingUp } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import ShareCardPreview from '$lib/components/market/ShareCardPreview.svelte';

  let { data }: { data: { address: string } } = $props();
  const address = $derived(data.address);
  let copied = $state(false);

  const profileQuery = createQuery(() => ({
    queryKey: ['profile', address],
    queryFn: () => api.getProfile(address)
  }));

  const positionQuery = createQuery(() => ({
    queryKey: ['profile-positions', address],
    queryFn: async () => {
      const markets = await api.getMarkets();
      const ticketLists = await Promise.all(
        markets.map((market) => api.getMarketTickets(market.market_id).catch(() => []))
      );
      return ticketLists
        .flat()
        .filter(
          (ticket) =>
            ticket.current_owner === address ||
            ticket.original_caller === address
        );
    }
  }));

  const ownedTickets = $derived((positionQuery.data ?? []).filter((ticket) => ticket.current_owner === address));
  const originalCalls = $derived((positionQuery.data ?? []).filter((ticket) => ticket.original_caller === address));
  const listedTickets = $derived(ownedTickets.filter((ticket) => Boolean(ticket.listed_price)));
  const winningTickets = $derived(ownedTickets.filter((ticket) => ticket.status === 'won' || ticket.status === 'claimed'));
  const bestEarlyCall = $derived([...originalCalls].sort((a, b) => b.confidence - a.confidence)[0]);

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    copied = true;
    window.setTimeout(() => (copied = false), 1000);
  }

  function identiconColor(addr: string) {
    const seed = addr
      .slice(0, 12)
      .split('')
      .reduce((total, char) => total + char.charCodeAt(0), 0);
    const hue = seed % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }
</script>

<svelte:head>
  <title>Profile | basingamarket</title>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <div class="mb-4">
    <Button href="/markets" variant="ghost"><ArrowLeft size={15} /> Markets</Button>
  </div>

  {#if profileQuery.isLoading}
    <Skeleton class="h-96" />
  {:else if profileQuery.data}
    <section class="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div class="space-y-4">
        <div class="terminal-panel p-5">
          <div class="mb-6 flex items-start gap-4 border-b border-terminal-line-strong pb-5">
            <div class="grid h-16 w-16 shrink-0 place-items-center rounded-3xl border font-mono text-xl font-bold" style={`border-color: ${identiconColor(address)}; background: ${identiconColor(address)}15; color: ${identiconColor(address)};`}>
              {address.slice(2, 4).toUpperCase()}
            </div>
            <div class="min-w-0 flex-1">
              <p class="mono-label text-terminal-muted">forecast identity</p>
              <h1 class="mt-2 text-2xl font-black text-terminal-text">
                {profileQuery.data.display_name ?? 'Unnamed wallet'}
              </h1>
              <p class="mt-2 break-all font-mono text-sm text-terminal-muted">{profileQuery.data.wallet_address}</p>
            </div>
            <Button size="icon" variant="secondary" onclick={copyAddress} aria-label="Copy address">
              <Copy size={15} />
            </Button>
          </div>

          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
              <p class="mono-label inline-flex items-center gap-1 text-terminal-muted"><TrendingUp size={13} /> original calls</p>
              <p class="mt-2 font-mono text-xl text-terminal-text">{positionQuery.isLoading ? 'loading' : originalCalls.length}</p>
            </div>
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
              <p class="mono-label inline-flex items-center gap-1 text-terminal-muted"><Ticket size={13} /> owned tickets</p>
              <p class="mt-2 font-mono text-xl text-terminal-text">{positionQuery.isLoading ? 'loading' : ownedTickets.length}</p>
            </div>
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
              <p class="mono-label inline-flex items-center gap-1 text-terminal-muted"><Activity size={13} /> listed positions</p>
              <p class="mt-2 font-mono text-xl text-terminal-text">{positionQuery.isLoading ? 'loading' : listedTickets.length}</p>
            </div>
          </div>

          <div class="mt-5">
            <Badge tone={copied ? 'positive' : 'neutral'}>{copied ? 'copied' : 'normalized wallet'}</Badge>
          </div>
        </div>

        <div class="terminal-panel p-5">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-terminal-text">Position history preview</h2>
            <Badge tone={positionQuery.isError ? 'warning' : 'neutral'}>
              {positionQuery.isError ? 'projection pending' : 'projection read'}
            </Badge>
          </div>
          {#if positionQuery.isLoading}
            <Skeleton class="h-32" />
          {:else if positionQuery.isError}
            <p class="text-sm text-terminal-muted">Ticket ownership projection is pending.</p>
          {:else if (positionQuery.data ?? []).length === 0}
            <p class="text-sm text-terminal-muted">No owned or original-call tickets found in the current market projection.</p>
          {:else}
            <div class="space-y-2">
              {#each (positionQuery.data ?? []).slice(0, 6) as ticket (ticket.ticket_id)}
                <a href={`/tickets/${ticket.ticket_id}`} class="flex items-center justify-between gap-3 rounded-2xl border border-market-neutral/35 bg-terminal-bg px-3 py-2 text-sm">
                  <span class="text-terminal-muted">
                    {ticket.original_caller === address ? 'Original call' : 'Held ticket'}
                  </span>
                  <span class="font-mono text-terminal-text">#{ticket.ticket_id}</span>
                </a>
              {/each}
            </div>
          {/if}
        </div>

        <div class="terminal-panel p-5">
          <h2 class="mb-3 text-base font-semibold text-terminal-text">Forecast badges</h2>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <p class="mono-label text-terminal-muted">winning tickets</p>
              <p class="mt-1 font-mono text-terminal-text">{positionQuery.isLoading ? 'loading' : winningTickets.length}</p>
            </div>
            <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
              <p class="mono-label text-terminal-muted">best early call</p>
              <p class="mt-1 truncate font-mono text-terminal-text">{bestEarlyCall ? `#${bestEarlyCall.ticket_id} · ${bestEarlyCall.confidence}` : 'projection pending'}</p>
            </div>
          </div>
        </div>
      </div>

      <ShareCardPreview
        share={{
          id: `profile-${address}`,
          kind: 'profile',
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }}
      />
    </section>
  {:else}
    <section class="terminal-panel p-6">
      <Badge tone="negative">not found</Badge>
      <p class="mt-3 text-terminal-muted">This profile could not be loaded.</p>
    </section>
  {/if}
</main>
