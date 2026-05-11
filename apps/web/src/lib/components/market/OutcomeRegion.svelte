<script lang="ts">
  import type { CanvasRegion } from '$lib/api/types';
  import { formatOdds, formatTokenAmount } from '$lib/utils/amount';

  let {
    region,
    active = false,
    mode = 'detail',
    dominant = false
  }: {
    region: CanvasRegion;
    active?: boolean;
    mode?: 'simple' | 'detail';
    dominant?: boolean;
  } = $props();

  const regionStateStyles: Record<string, { fill: string; stroke: string; label: string; dash?: string }> = {
    open: { fill: 'rgba(83, 102, 242, 0.055)', stroke: 'rgba(148, 163, 184, 0.18)', label: 'OPEN' },
    quiet: { fill: 'rgba(255, 255, 255, 0.018)', stroke: 'rgba(255, 255, 255, 0.11)', label: 'QUIET', dash: '8 8' },
    dominant: { fill: 'rgba(83, 102, 242, 0.15)', stroke: 'rgba(0, 196, 255, 0.72)', label: 'DOMINANT' },
    contested: { fill: 'rgba(0, 196, 255, 0.065)', stroke: 'rgba(0, 196, 255, 0.36)', label: 'CONTESTED' },
    'late-flow': { fill: 'rgba(245, 158, 11, 0.08)', stroke: 'rgba(245, 158, 11, 0.58)', label: 'LATE FLOW' },
    leading: { fill: 'rgba(83, 102, 242, 0.15)', stroke: 'rgba(0, 196, 255, 0.72)', label: 'DOMINANT' },
    'resolved-winning': { fill: 'rgba(16, 185, 129, 0.10)', stroke: 'rgba(16, 185, 129, 0.68)', label: 'WON' },
    'resolved-losing': { fill: 'rgba(91, 99, 107, 0.12)', stroke: 'rgba(255, 255, 255, 0.15)', label: 'LOST' },
    empty: { fill: 'rgba(255,255,255,0.018)', stroke: 'rgba(255,255,255,0.12)', label: 'EMPTY', dash: '7 7' }
  };

  const style = $derived(regionStateStyles[region.state] ?? regionStateStyles['open']);
  const percentLabel = $derived(formatOdds(region.current_odds).replace('.0%', '%'));
</script>

<g class:opacity-60={!active}>
  <rect
    x={region.x}
    y={region.y}
    width={region.width}
    height={region.height}
    fill={mode === 'simple' && dominant ? 'rgba(83, 102, 242, 0.14)' : mode === 'simple' ? 'rgba(0, 196, 255, 0.022)' : style.fill}
    stroke={mode === 'simple' && dominant ? 'rgba(0, 196, 255, 0.52)' : mode === 'simple' ? 'rgba(148, 163, 184, 0.16)' : style.stroke}
    stroke-width={mode === 'simple' && dominant ? '2' : '1.2'}
    stroke-dasharray={style.dash ?? undefined}
    rx="18"
  />
  {#if mode === 'simple' && region.width > 140 && region.height > 80}
    <text x={region.x + 24} y={region.y + 42} fill="#f8fafc" font-size="24" font-weight="850" font-family="var(--font-sans)">
      {region.label}
    </text>
    <text x={region.x + 24} y={region.y + 74} fill={dominant ? '#00c4ff' : '#dbeafe'} font-size="18" font-weight="800" font-family="var(--font-mono)">
      {percentLabel}
    </text>
  {:else if region.width > 140 && region.height > 80}
    <text x={region.x + 22} y={region.y + 32} fill="#f8fafc" font-size="17" font-weight="800" font-family="var(--font-sans)">
      {region.label}
    </text>
    <text x={region.x + 22} y={region.y + 56} fill="#9ca3af" font-size="12" font-family="var(--font-mono)">
      {formatOdds(region.current_odds)} / {formatTokenAmount(region.total_stake)} staked
    </text>
    <text x={region.x + 22} y={region.y + 76} fill="#9ca3af" font-size="10" font-family="var(--font-mono)" opacity="0.86">
      {style.label}
    </text>
  {:else}
    <text x={region.x + 12} y={region.y + 22} fill="#f8fafc" font-size="12" font-weight="800" font-family="var(--font-sans)">
      {region.label}
    </text>
  {/if}
</g>
