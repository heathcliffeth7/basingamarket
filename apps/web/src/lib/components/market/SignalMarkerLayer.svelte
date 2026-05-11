<script lang="ts">
  import type { CanvasNode, CanvasRegion } from '$lib/api/types';
  import type { DerivedMarketSignals } from '$lib/utils/signals';

  let {
    regions,
    nodes,
    signals
  }: {
    regions: CanvasRegion[];
    nodes: CanvasNode[];
    signals: DerivedMarketSignals;
  } = $props();

  const dominantRegion = $derived(
    regions.find((region) => region.label === signals.dominantOutcomeLabel) ?? null
  );
  const userCenter = $derived(
    nodes.length
      ? {
          x: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
          y: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length
        }
      : null
  );
</script>

<g aria-hidden="true" data-layer="signal-markers">
  {#if dominantRegion}
    {@const x = dominantRegion.x + dominantRegion.width / 2}
    {@const y = dominantRegion.y + dominantRegion.height / 2}
    <g transform={`translate(${x} ${y})`}>
      <circle r="23" fill="none" stroke="#00c4ff" stroke-width="2" opacity="0.42" />
      <path d="M -8 0 L 0 -8 L 8 0 L 0 8 Z" fill="#00c4ff" opacity="0.8" />
      <text y="39" text-anchor="middle" fill="#00c4ff" font-size="10" font-weight="800" font-family="var(--font-mono)">
        DOMINANT
      </text>
    </g>
  {/if}

  {#if userCenter}
    <g transform={`translate(${userCenter.x} ${userCenter.y})`}>
      <circle r="15" fill="rgba(83,102,242,0.13)" stroke="#5366f2" stroke-width="1.5" stroke-dasharray="4 3" />
      <text y="-22" text-anchor="middle" fill="#5366f2" font-size="10" font-weight="800" font-family="var(--font-mono)">
        USER CENTER
      </text>
    </g>
  {/if}
</g>
