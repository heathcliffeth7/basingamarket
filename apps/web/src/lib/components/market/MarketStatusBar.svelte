<script lang="ts">
  import { Bookmark, Code2, Link2 } from 'lucide-svelte';
  import type { Market } from '$lib/api/types';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let { market }: { market: Market } = $props();

  const closeLabel = $derived((() => {
    const diff = market.trade_until * 1000 - Date.now();
    if (diff <= 0) return 'Closed';
    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `${hours}h left`;
    return `${Math.ceil(hours / 24)}d left`;
  })());
</script>

<section>
  <div class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 items-start gap-3">
      <div class="grid h-12 w-12 shrink-0 place-items-center">
        <img src="/brand/bm-logo-mark.svg" alt="" aria-hidden="true" class="app-icon h-9 w-9" />
      </div>
      <div class="min-w-0">
        <h1 class="text-balance text-xl font-black leading-tight text-terminal-text sm:text-3xl">
          {market.question_hash}
        </h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm font-bold text-terminal-muted sm:text-base">
          <span>{closeLabel}</span>
          <span>·</span>
          <Badge tone={market.status === 'open' ? 'positive' : 'neutral'}>{market.status}</Badge>
          <span>·</span>
          <span>{market.outcome_count} outcomes</span>
        </div>
      </div>
    </div>
    <div class="hidden shrink-0 items-center gap-2 text-terminal-text sm:flex">
      <Button class="h-8 w-8" size="icon" variant="ghost" aria-label="Embed"><Code2 size={16} /></Button>
      <Button class="h-8 w-8" size="icon" variant="ghost" aria-label="Copy link"><Link2 size={16} /></Button>
      <Button class="h-8 w-8" size="icon" variant="ghost" aria-label="Bookmark"><Bookmark size={16} /></Button>
    </div>
  </div>
</section>
