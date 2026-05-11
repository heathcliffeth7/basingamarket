<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';

  let { nodes }: { nodes: CanvasNode[] } = $props();

  const transferNodes = $derived(
    nodes
      .filter((node) => Boolean(node.last_transfer_at))
      .sort((a, b) => Date.parse(b.last_transfer_at ?? '') - Date.parse(a.last_transfer_at ?? ''))
      .slice(0, 6)
  );
</script>

<g aria-hidden="true" data-layer="flow-trails">
  {#each transferNodes as node (node.ticket_id)}
    <path
      d={`M ${Math.max(24, node.x - 96)} ${node.y + 32} C ${node.x - 58} ${node.y - 18}, ${node.x - 24} ${node.y - 18}, ${node.x} ${node.y}`}
      fill="none"
      stroke="#f59e0b"
      stroke-width="2"
      stroke-linecap="round"
      stroke-dasharray="7 7"
      opacity="0.5"
    />
    <text
      x={Math.max(24, node.x - 92)}
      y={node.y + 47}
      fill="#f59e0b"
      font-size="10"
      font-weight="800"
      font-family="var(--font-mono)"
      opacity="0.76"
    >
      TRANSFER
    </text>
  {/each}
</g>
