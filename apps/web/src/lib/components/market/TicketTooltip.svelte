<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';
  import { formatTokenAmount } from '$lib/utils/amount';

  let { node, containerRect }: { node: CanvasNode; containerRect: DOMRect } = $props();

  const pad = 12;
  const tooltipW = 260;
  const tooltipH = 138;

  const rawLeft = $derived(containerRect.left + (node.x / 1200) * containerRect.width + 24);
  const rawTop = $derived(containerRect.top + (node.y / 630) * containerRect.height - tooltipH - 16);

  const left = $derived(Math.min(Math.max(rawLeft, pad), window.innerWidth - tooltipW - pad));
  const top = $derived(Math.min(Math.max(rawTop, pad), window.innerHeight - tooltipH - pad));

  const badgeTone = $derived(
    node.status === 'listed'
      ? 'warning'
      : node.status === 'won'
        ? 'positive'
        : node.status === 'lost'
          ? 'negative'
          : 'neutral'
  );

  const toneClasses: Record<string, string> = {
    neutral: 'border-market-neutral/40 bg-market-neutral/10 text-market-neutral',
    positive: 'border-market-positive/45 bg-market-positive/10 text-market-positive',
    negative: 'border-market-negative/45 bg-market-negative/10 text-market-negative',
    warning: 'border-market-warning/45 bg-market-warning/10 text-market-warning'
  };
</script>

{#if node}
  <div
    class="pointer-events-none fixed z-50 rounded-2xl border border-terminal-line-strong bg-terminal-bg px-3 py-2 shadow-market"
    style={`left:${left}px; top:${top}px; width:${tooltipW}px;`}
    role="tooltip"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-bold text-terminal-text">Ticket #{node.ticket_id}</span>
      <span class={`mono-label rounded-full border px-1.5 py-0.5 ${toneClasses[badgeTone]}`}>
        {node.status.toUpperCase()}
      </span>
    </div>
    <div class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
      <span class="text-terminal-muted">OUTCOME</span>
      <span class="truncate text-right font-mono text-terminal-text">{node.outcome_id}</span>
      <span class="text-terminal-muted">OWNER</span>
      <span class="truncate text-right font-mono text-terminal-text">{node.owner_display}</span>
      <span class="text-terminal-muted">CALLER</span>
      <span class="truncate text-right font-mono text-terminal-text">{node.original_caller_display}</span>
      <span class="text-terminal-muted">CONFIDENCE</span>
      <span class="text-right font-mono text-terminal-text">{node.confidence}</span>
      <span class="text-terminal-muted">{node.listed_price ? 'ASK' : 'STATUS'}</span>
      <span
        class="text-right font-mono"
        class:text-market-warning={node.listed}
        class:text-market-positive={node.status === 'won' || node.status === 'active'}
        class:text-market-negative={node.status === 'lost'}
        class:text-terminal-muted={node.status === 'claimed'}
      >
        {node.listed_price ? formatTokenAmount(node.listed_price) : node.status.toUpperCase()}
      </span>
    </div>
  </div>
{/if}
