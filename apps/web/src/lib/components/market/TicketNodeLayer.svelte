<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';
  import TicketNode from './TicketNode.svelte';

  let {
    nodes,
    selectedTicketId = null,
    activeTicketId = null,
    compact = false,
    onSelect,
    onHover
  }: {
    nodes: CanvasNode[];
    selectedTicketId?: string | null;
    activeTicketId?: string | null;
    compact?: boolean;
    onSelect?: (node: CanvasNode) => void;
    onHover?: (node: CanvasNode | null) => void;
  } = $props();

  const sortedNodes = $derived([...nodes].sort((a, b) => a.z_index - b.z_index || Number(a.ticket_id) - Number(b.ticket_id)));
</script>

<g>
  {#each sortedNodes as node (node.ticket_id)}
    <TicketNode
      {node}
      {compact}
      selected={selectedTicketId === node.ticket_id}
      hovered={activeTicketId === node.ticket_id}
      {onSelect}
      {onHover}
    />
  {/each}
</g>
