<script lang="ts">
  import { Activity } from 'lucide-svelte';
  import type { SimpleMarketRead } from '$lib/utils/signals';
  import Badge from '$lib/components/ui/Badge.svelte';

  let {
    read,
    realtimeState = 'live',
    mock = false
  }: {
    read: SimpleMarketRead;
    realtimeState?: 'connecting' | 'live' | 'refetching' | 'offline';
    mock?: boolean;
  } = $props();

  const statusTone = $derived(
    realtimeState === 'live'
      ? 'positive'
      : realtimeState === 'offline'
        ? 'negative'
        : realtimeState === 'refetching'
          ? 'warning'
          : 'neutral'
  );
</script>

<section aria-label="Market pulse strip">
  <div class="flex flex-col gap-1.5 border-b border-terminal-line pb-2.5 lg:flex-row lg:items-center lg:justify-between">
    <div class="min-w-0">
      <strong class="block truncate text-xl font-black text-terminal-text">
        Crowd leans {read.dominantOutcomeLabel}
      </strong>
      <p class="mt-0.5 truncate text-xs font-bold text-terminal-text sm:text-sm">
        {read.dominantOutcomeName} · {read.strengthLabel} · {read.confidenceLabel} confidence
      </p>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      {#if mock}
        <Badge tone="warning">MOCK</Badge>
      {/if}
      <Badge tone={statusTone}>
        <Activity size={13} />
        {realtimeState}
      </Badge>
    </div>
  </div>
</section>
