<script lang="ts">
  import { ExternalLink } from 'lucide-svelte';
  import type { CanvasNode } from '$lib/api/types';
  import { formatTokenAmount } from '$lib/utils/amount';
  import Button from '$lib/components/ui/Button.svelte';

  let { node, onClose }: { node: CanvasNode | null; onClose?: () => void } = $props();
</script>

{#if node}
  <div class="pointer-events-auto absolute bottom-3 left-3 z-20 w-[min(360px,calc(100%-24px))] rounded-3xl border border-terminal-line-strong bg-terminal-panel p-3 shadow-market">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="mono-label text-terminal-muted">Selected ticket</p>
        <h3 class="mt-1 text-base font-semibold text-terminal-text">Ticket #{node.ticket_id}</h3>
      </div>
      <button class="mono-label text-terminal-muted hover:text-terminal-text" type="button" onclick={onClose} aria-label="Clear selected ticket">x</button>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
      <span class="text-terminal-muted">Owner</span>
      <span class="truncate text-right font-mono text-terminal-text">{node.owner_display}</span>
      <span class="text-terminal-muted">Confidence</span>
      <span class="text-right font-mono text-terminal-text">{node.confidence}</span>
      <span class="text-terminal-muted">{node.listed_price ? 'Listed' : 'Status'}</span>
      <span class="text-right font-mono" class:text-market-warning={Boolean(node.listed_price)}>
        {node.listed_price ? formatTokenAmount(node.listed_price) : node.status}
      </span>
    </div>
    <Button class="mt-3 w-full" size="sm" href={`/tickets/${node.ticket_id}`}>
      <ExternalLink size={14} /> View ticket
    </Button>
  </div>
{/if}
