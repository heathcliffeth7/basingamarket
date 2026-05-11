<script lang="ts">
  import type { Outcome } from '$lib/api/types';
  import { formatOdds, formatTokenAmount } from '$lib/utils/amount';

  let { outcomes }: { outcomes: Outcome[] } = $props();

  const maxOdds = $derived(Math.max(...outcomes.map((o) => Number(o.current_odds))));
</script>

<div class="grid gap-2">
  {#each outcomes as outcome}
    {@const isLeading = Number(outcome.current_odds) === maxOdds}
    <div class="relative overflow-hidden rounded-2xl border border-terminal-line bg-terminal-panel p-3 transition-colors hover:border-terminal-line-strong">
      {#if isLeading}
        <div class="absolute inset-y-0 left-0 w-1 bg-market-lime"></div>
      {/if}
      <div class="flex items-center justify-between gap-3">
        <span class="font-medium text-terminal-text">{outcome.label}</span>
        <span class="font-mono font-bold text-market-lime">{formatOdds(outcome.current_odds)}</span>
      </div>
      <div class="mt-2 h-2 overflow-hidden rounded-full border border-terminal-line bg-terminal-bg">
        <div class="h-full bg-market-lime transition-all" style={`width: ${Math.min(100, (Number(outcome.current_odds) / maxOdds) * 100)}%`}></div>
      </div>
      <p class="mono-label mt-2 text-terminal-muted">{formatTokenAmount(outcome.total_stake)} staked</p>
    </div>
  {/each}
</div>
