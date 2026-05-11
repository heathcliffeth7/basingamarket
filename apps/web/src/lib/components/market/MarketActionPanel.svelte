<script lang="ts">
  import { Activity, CheckCircle2, ListPlus, ShieldAlert, Ticket } from 'lucide-svelte';
  import type { Ticket as MarketTicket } from '$lib/api/types';
  import type { DerivedMarketSignals, SimpleMarketRead } from '$lib/utils/signals';
  import { formatTokenAmount } from '$lib/utils/amount';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import LiveConnectionBadge from './LiveConnectionBadge.svelte';

  let {
    simpleRead,
    signals,
    listedTickets = [],
    topTickets = [],
    realtimeState = 'live',
    marketHref = '/markets',
    mock = false,
    onOpenDetails,
    onOpenListed,
    onOpenActivity
  }: {
    simpleRead: SimpleMarketRead;
    signals: DerivedMarketSignals;
    listedTickets?: MarketTicket[];
    topTickets?: MarketTicket[];
    realtimeState?: 'connecting' | 'live' | 'refetching' | 'offline';
    marketHref?: string;
    mock?: boolean;
    onOpenDetails?: () => void;
    onOpenListed?: () => void;
    onOpenActivity?: () => void;
  } = $props();

  const visibleTickets = $derived((listedTickets.length ? listedTickets : topTickets).slice(0, 4));
  const listedCount = $derived(listedTickets.length);
</script>

<aside class="space-y-3" aria-label="Market action panel">
  <section class="rounded-2xl border border-terminal-line bg-terminal-panel p-3" aria-label="Market read">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="text-base font-black leading-tight text-terminal-text">Crowd leans {simpleRead.dominantOutcomeLabel}</p>
        <p class="mt-1 truncate text-xs font-bold text-terminal-muted">
          {simpleRead.dominantOutcomeName} · {simpleRead.strengthLabel} · {simpleRead.confidenceLabel} confidence
        </p>
      </div>
      <Badge class="px-2 py-0.5" tone={simpleRead.confidenceLabel === 'High' ? 'positive' : simpleRead.confidenceLabel === 'Medium' ? 'neutral' : 'warning'}>
        {simpleRead.confidenceLabel}
      </Badge>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2">
      <div class="rounded-xl border border-terminal-line bg-terminal-bg px-2.5 py-2">
        <p class="text-xs font-bold text-terminal-muted">Visual capital</p>
        <p class="mt-0.5 truncate text-base font-black text-terminal-muted">{simpleRead.strengthLabel}</p>
      </div>
      <div class="rounded-xl border border-terminal-line bg-terminal-bg px-2.5 py-2">
        <p class="text-xs font-bold text-terminal-muted">Canvas read</p>
        <p class="mt-0.5 truncate text-base font-black text-terminal-text">{simpleRead.dominantOutcomeLabel}</p>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap gap-2">
        {#if mock}
          <LiveConnectionBadge status="mock" label="Mock" />
        {/if}
        <LiveConnectionBadge status={realtimeState} label={realtimeState === 'refetching' ? 'Refetching' : realtimeState === 'offline' ? 'Offline' : realtimeState === 'connecting' ? 'Connecting' : 'Live'} />
      </div>
      <Button class="ml-auto h-8 px-3 text-xs" variant="secondary" href={marketHref}>
        Go to live market
      </Button>
    </div>
  </section>

  <p class="text-center text-xs font-semibold text-terminal-muted">
    By trading, you agree to the <span class="underline underline-offset-4">Terms of Use</span>.
  </p>

  <section class="rounded-2xl border border-terminal-line bg-terminal-panel p-3">
    <div class="space-y-2.5">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-black text-terminal-text">Trade intent</h3>
        <Badge class="px-2 py-0.5" tone={simpleRead.confidenceLabel === 'High' ? 'positive' : simpleRead.confidenceLabel === 'Medium' ? 'neutral' : 'warning'}>
          {simpleRead.confidenceLabel}
        </Badge>
      </div>
      <div class="grid grid-cols-3 gap-2 rounded-full bg-terminal-panel p-1">
        <Button size="sm">Buy</Button>
        <Button size="sm" variant="ghost">List</Button>
        <Button size="sm" variant="ghost">Claim</Button>
      </div>
      <div class="py-3 text-center">
        <p class="text-4xl font-black tracking-tight text-terminal-muted">$0</p>
        <p class="mt-1 text-xs font-semibold uppercase text-terminal-muted">BUSDC balance</p>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <button class="rounded-2xl bg-terminal-panel px-2 py-1.5 text-sm font-semibold text-terminal-text" type="button">$25</button>
        <button class="rounded-2xl bg-terminal-panel px-2 py-1.5 text-sm font-semibold text-terminal-text" type="button">$100</button>
        <button class="rounded-2xl bg-terminal-panel px-2 py-1.5 text-sm font-semibold text-terminal-text" type="button">$250</button>
      </div>
      <Button class="mt-2 h-10 w-full px-3 text-xs" href={marketHref}>Use live trade panel</Button>
    </div>
  </section>

  <section class="rounded-2xl border border-terminal-line bg-terminal-panel p-3">
      <div class="mb-2 flex items-center justify-between gap-3">
        <h3 class="text-base font-black text-terminal-text">Related tickets</h3>
        <Badge tone={listedCount > 0 ? 'warning' : 'neutral'}>{listedCount}</Badge>
      </div>
      <div class="space-y-2">
        {#each visibleTickets as ticket (ticket.ticket_id)}
          <a href={`/tickets/${ticket.ticket_id}`} class="flex items-center justify-between gap-3 rounded-2xl bg-terminal-panel px-3 py-1.5 text-sm">
            <span class="inline-flex items-center gap-2 font-mono text-terminal-text">
              <Ticket size={14} /> #{ticket.ticket_id}
            </span>
            <span class="font-mono text-terminal-muted">{ticket.listed_price ? formatTokenAmount(ticket.listed_price) : ticket.status}</span>
          </a>
        {/each}
        {#if visibleTickets.length === 0}
          <p class="text-sm text-terminal-muted">No listed ticket projection yet.</p>
        {/if}
      </div>
  </section>

  <section class="grid gap-2 text-sm">
      <button class="flex items-center justify-between rounded-xl border border-terminal-line bg-terminal-panel px-3 py-2.5 text-left" type="button" onclick={onOpenDetails}>
        <span class="inline-flex items-center gap-2 text-terminal-text"><CheckCircle2 size={15} /> Details</span>
        <span class="font-mono text-terminal-muted">{signals.userConcentrationLabel}</span>
      </button>
      <button class="flex items-center justify-between rounded-xl border border-terminal-line bg-terminal-panel px-3 py-2.5 text-left" type="button" onclick={onOpenListed}>
        <span class="inline-flex items-center gap-2 text-terminal-text"><ListPlus size={15} /> Listed</span>
        <span class="font-mono text-terminal-muted">{listedCount}</span>
      </button>
      <button class="flex items-center justify-between rounded-xl border border-terminal-line bg-terminal-panel px-3 py-2.5 text-left" type="button" onclick={onOpenActivity}>
        <span class="inline-flex items-center gap-2 text-terminal-text"><Activity size={15} /> Activity</span>
        <span class="font-mono text-terminal-muted">{signals.lateFlowLabel}</span>
      </button>
      <div class="flex items-start gap-2 rounded-xl border border-market-warning/25 bg-market-warning/10 px-3 py-2.5 text-xs text-market-warning">
        <ShieldAlert class="mt-0.5 shrink-0" size={14} />
        <span>Fresh buys and cashout use BUSDC inside the app.</span>
      </div>
  </section>
</aside>
