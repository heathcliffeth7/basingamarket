<script lang="ts">
  import type { CanvasNode, CanvasRegion } from '$lib/api/types';

  let { nodes, regions }: { nodes: CanvasNode[]; regions: CanvasRegion[] } = $props();

  const regionColors = ['#5366f2', '#00c4ff', '#818cf8', '#94a3b8', '#10b981'];
  const nodesByOutcome = $derived(
    nodes.reduce<Record<string, CanvasNode[]>>((groups, node) => {
      groups[node.outcome_id] = [...(groups[node.outcome_id] ?? []), node];
      return groups;
    }, {})
  );

  function regionOpacity(region: CanvasRegion) {
    const lean = Number(region.current_odds) / 1_000_000;
    return Math.min(0.22, Math.max(0.045, lean * 0.22));
  }

  function colorForRegion(index: number) {
    return regionColors[index % regionColors.length];
  }
</script>

<g aria-hidden="true" data-layer="density">
  {#each regions as region, index (region.outcome_id)}
    {@const color = colorForRegion(index)}
    <rect
      x={region.x + 10}
      y={region.y + 10}
      width={Math.max(0, region.width - 20)}
      height={Math.max(0, region.height - 20)}
      fill={color}
      opacity={regionOpacity(region)}
      rx="8"
    />
    {#each nodesByOutcome[region.outcome_id] ?? [] as node (node.ticket_id)}
      <circle
        cx={node.x}
        cy={node.y}
        r={Math.max(42, node.radius * 2.8)}
        fill={color}
        opacity={node.status === 'lost' ? 0.035 : node.listed ? 0.13 : 0.1}
      />
      <circle
        cx={node.x}
        cy={node.y}
        r={Math.max(24, node.radius * 1.35)}
        fill={color}
        opacity={node.status === 'lost' ? 0.04 : 0.14}
      />
    {/each}
  {/each}
</g>
