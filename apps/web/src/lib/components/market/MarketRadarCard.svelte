<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowRight, TrendingUp, Ticket } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import { isMockFallbackEnabled } from '$lib/api/env';
  import type { Market } from '$lib/api/types';
  import { formatTokenAmount } from '$lib/utils/amount';
  import { deriveSimpleMarketRead } from '$lib/utils/signals';
  import Badge from '$lib/components/ui/Badge.svelte';

  let { market }: { market: Market } = $props();

  const ticketsQuery = createQuery(() => ({
    queryKey: ['market-card-tickets', market.market_id],
    queryFn: () => api.getMarketTickets(market.market_id),
    staleTime: 30_000
  }));

  const read = $derived(
    deriveSimpleMarketRead({
      market,
      tickets: ticketsQuery.data
    })
  );

  const totalStake = $derived(
    market.outcomes.reduce((sum, outcome) => sum + BigInt(outcome.total_stake), 0n).toString()
  );

  const ticketCount = $derived((ticketsQuery.data ?? []).length);
  const closeLabel = $derived((() => {
    const diff = market.trade_until * 1000 - Date.now();
    if (diff <= 0) return 'Closed';
    const hours = Math.ceil(diff / 3600000);
    if (hours < 24) return `${hours}h left`;
    return `${Math.ceil(hours / 24)}d left`;
  })());

  const statusTone = $derived(
    market.status === 'resolved'
      ? 'neutral'
      : market.status === 'open'
        ? 'positive'
        : 'warning'
  );
</script>

<a
  href={`/markets/${market.market_id}`}
  class="group block rounded-2xl border border-terminal-line bg-terminal-panel p-4 transition hover:border-market-positive/45"
  aria-label={`Open market ${market.question_hash}`}
>
  <div class="min-w-0">
    <div class="flex items-start gap-3">
      <span class="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-terminal-line bg-terminal-bg text-market-positive">
        <TrendingUp size={22} />
      </span>
      <div class="min-w-0">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone}>{market.status}</Badge>
          {#if isMockFallbackEnabled}
            <Badge tone="warning">MOCK</Badge>
          {/if}
          <span class="text-xs font-semibold text-terminal-muted">{closeLabel}</span>
        </div>
        <h2 class="text-lg font-black leading-snug text-terminal-text group-hover:text-white">
          {market.question_hash}
        </h2>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-terminal-muted">
      <span class="font-black text-market-positive">Crowd leans {read.dominantOutcomeLabel}</span>
      <span>·</span>
      <span class="font-mono text-terminal-text">{read.strengthLabel}</span>
      <span>·</span>
      <span class="inline-flex items-center gap-1"><Ticket size={12} /> {ticketCount} tickets</span>
      <span>·</span>
      <span>{formatTokenAmount(totalStake)} BUSDC</span>
      <span>·</span>
      <span class="inline-flex items-center gap-1 font-black text-market-positive">Open market <ArrowRight size={13} /></span>
    </div>
  </div>
</a>
