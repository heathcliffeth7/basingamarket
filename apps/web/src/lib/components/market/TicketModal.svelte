<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';
  import { ExternalLink, Share2 } from 'lucide-svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Dialog from '$lib/components/ui/Dialog.svelte';
  import PositionTimeline from './PositionTimeline.svelte';
  import { formatTokenAmount } from '$lib/utils/amount';

  let {
    node,
    onClose
  }: {
    node: CanvasNode | null;
    onClose?: () => void;
  } = $props();

  let tab: 'overview' | 'history' | 'share' = $state('overview');
</script>

<Dialog open={Boolean(node)} title={node ? `Ticket #${node.ticket_id}` : 'Ticket'} {onClose}>
  {#if node}
    <div class="space-y-5">
      <div class="flex items-center gap-4 border-b border-terminal-line-strong pb-4">
        <div class="relative grid h-16 w-16 shrink-0 place-items-center rounded-full border" class:border-market-warning={node.listed} class:border-market-positive={!node.listed} style={`background: ${node.status === 'lost' ? 'rgba(148,163,184,0.20)' : 'rgba(5,7,18,0.96)'}; border-color: ${node.listed ? '#f59e0b' : node.status === 'won' ? '#10b981' : node.status === 'lost' ? '#ef4444' : '#00c4ff'};`}>
          <span class="font-mono text-sm font-bold text-terminal-text">{node.owner_display.slice(2, 6)}</span>
          <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold" style={`background: ${node.listed ? '#f59e0b' : '#5366f2'}; color: #ffffff;`}>
            {node.status === 'active' ? 'A' : node.status === 'listed' ? 'L' : node.status === 'won' ? 'W' : node.status === 'lost' ? 'X' : 'C'}
          </span>
        </div>
        <div>
          <p class="mono-label text-terminal-muted">ticket overview</p>
          <p class="mt-0.5 text-lg font-semibold text-terminal-text">Outcome {node.outcome_id}</p>
          <p class="mt-1 font-mono text-sm capitalize text-terminal-muted">{node.status}</p>
        </div>
      </div>

      <div class="flex gap-2">
        <Button size="sm" variant={tab === 'overview' ? 'default' : 'secondary'} onclick={() => (tab = 'overview')}>Overview</Button>
        <Button size="sm" variant={tab === 'history' ? 'default' : 'secondary'} onclick={() => (tab = 'history')}>History</Button>
        <Button size="sm" variant={tab === 'share' ? 'default' : 'secondary'} onclick={() => (tab = 'share')}>Share</Button>
      </div>

      {#if tab === 'overview'}
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
            <p class="mono-label text-terminal-muted">owner</p>
            <p class="mt-1 truncate font-mono text-terminal-text">{node.owner_display}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
            <p class="mono-label text-terminal-muted">caller</p>
            <p class="mt-1 truncate font-mono text-terminal-text">{node.original_caller_display}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
            <p class="mono-label text-terminal-muted">entry</p>
            <p class="mt-1 font-mono text-terminal-text">{node.confidence}</p>
          </div>
          <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
            <p class="mono-label text-terminal-muted">listed</p>
            <p class="mt-1 font-mono text-terminal-text">{node.listed_price ? formatTokenAmount(node.listed_price) : 'not listed'}</p>
          </div>
        </div>
      {:else if tab === 'history'}
        <PositionTimeline {node} />
      {:else}
        <div class="rounded-2xl border border-terminal-line bg-terminal-bg p-4">
          <p class="mono-label text-terminal-muted">share card</p>
          <p class="mt-2 text-sm text-terminal-text">Share card rendering is available from the ticket page.</p>
        </div>
      {/if}

      <div class="flex flex-wrap gap-2">
        <Button href={`/tickets/${node.ticket_id}`}><ExternalLink size={15} /> Open ticket</Button>
        <Button variant="secondary" href={`/tickets/${node.ticket_id}`}>Manage cashout</Button>
        <Button variant="secondary"><Share2 size={15} /> Share card</Button>
      </div>
    </div>
  {/if}
</Dialog>
