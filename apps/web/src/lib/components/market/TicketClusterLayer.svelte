<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';
  import type { RenderedCanvasItem } from '$lib/utils/signals';
  import TicketNode from './TicketNode.svelte';

  let {
    items,
    selectedTicketId = null,
    activeTicketId = null,
    onSelect,
    onHover
  }: {
    items: RenderedCanvasItem[];
    selectedTicketId?: string | null;
    activeTicketId?: string | null;
    onSelect?: (node: CanvasNode) => void;
    onHover?: (node: CanvasNode | null) => void;
  } = $props();
</script>

<g data-layer="ticket-clusters">
  {#each items as item (`${item.type}-${item.type === 'ticket' ? item.node.ticket_id : item.outcome_id}`)}
    {#if item.type === 'ticket'}
      <TicketNode
        node={item.node}
        compact
        selected={selectedTicketId === item.node.ticket_id}
        hovered={activeTicketId === item.node.ticket_id}
        {onSelect}
        {onHover}
      />
    {:else}
      <g transform={`translate(${item.x} ${item.y})`} aria-hidden="true" data-cluster-outcome={item.outcome_id}>
        <rect
          x="-35"
          y="-14"
          width="70"
          height="28"
          rx="2"
          fill="rgba(13,16,14,0.96)"
          stroke="rgba(244,239,218,0.72)"
          stroke-width="2"
        />
        <circle cx="-22" cy="0" r="4" fill="#baff5a" />
        <text y="4" x="-10" fill="#f4efda" font-size="11" font-weight="800" font-family="var(--font-mono)">
          +{item.count} more
        </text>
      </g>
    {/if}
  {/each}
</g>
