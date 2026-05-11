<script lang="ts">
  import type { CanvasResponse, Market } from '$lib/api/types';
  import { deriveSimpleMarketRead, getRenderedCanvasItems, type RenderedCanvasItem, type SimpleMarketRead } from '$lib/utils/signals';

  let {
    market,
    canvas = null,
    simpleRead = null
  }: {
    market: Market;
    canvas?: CanvasResponse | null;
    simpleRead?: SimpleMarketRead | null;
  } = $props();

  const outcomeTints = [
    'rgba(83,102,242,0.12)',
    'rgba(0,196,255,0.10)',
    'rgba(129,140,248,0.10)',
    'rgba(148,163,184,0.08)'
  ];

  const outcomeStrokes = [
    'rgba(83,102,242,0.62)',
    'rgba(0,196,255,0.50)',
    'rgba(129,140,248,0.50)',
    'rgba(148,163,184,0.35)'
  ];

  const nodeColors = ['#5366f2', '#00c4ff', '#818cf8', '#dbeafe'];

  const read = $derived(simpleRead ?? deriveSimpleMarketRead({ market, canvas }));

  function isTicketItem(item: RenderedCanvasItem): item is Extract<RenderedCanvasItem, { type: 'ticket' }> {
    return item.type === 'ticket';
  }

  const regions = $derived(
    canvas
      ? canvas.regions.map((region, index) => ({
          id: region.outcome_id,
          label: region.label,
          x: (region.x / 1200) * 120,
          y: (region.y / 630) * 64,
          width: (region.width / 1200) * 120,
          height: (region.height / 630) * 64,
          tint: outcomeTints[index % outcomeTints.length],
          stroke: outcomeStrokes[index % outcomeStrokes.length],
          dominant: region.outcome_id === read.dominantOutcomeId || region.label === read.dominantOutcomeLabel,
          resolvedWon: market.winning_outcome !== null && String(market.winning_outcome) === region.outcome_id
        }))
      : market.outcomes.map((outcome, index) => {
          const base = market.outcome_count === 2
            ? { x: index === 0 ? 0 : 60, y: 0, width: 60, height: 64 }
            : market.outcome_count === 3
              ? { x: index === 0 ? 0 : 40, y: index === 0 ? 0 : 32, width: index === 0 ? 80 : 40, height: index === 0 ? 32 : 32 }
              : { x: (index % 2) * 60, y: Math.floor(index / 2) * 32, width: 60, height: 32 };
          return {
            id: String(outcome.outcome_id),
            label: outcome.label,
            ...base,
            tint: outcomeTints[index % outcomeTints.length],
            stroke: outcomeStrokes[index % outcomeStrokes.length],
            dominant: String(outcome.outcome_id) === read.dominantOutcomeId || outcome.label === read.dominantOutcomeLabel,
            resolvedWon: market.winning_outcome !== null && market.winning_outcome === outcome.outcome_id
          };
        })
  );

  const nodes = $derived(
    canvas?.nodes.length
      ? getRenderedCanvasItems({ canvas, maxTicketsPerOutcome: 2 })
          .filter(isTicketItem)
          .slice(0, 5)
          .map(({ node }, i) => ({
            x: (node.x / 1200) * 120,
            y: (node.y / 630) * 64,
            r: Math.max(3.5, Math.min(8, node.radius / 7)),
            color: node.listed ? '#f59e0b' : node.status === 'won' ? '#10b981' : node.status === 'lost' ? '#ef4444' : nodeColors[i % nodeColors.length],
            listed: node.listed,
            status: node.status
          }))
      : market.outcomes.slice(0, 4).map((outcome, i) => {
          const region = regions[i];
          const lean = Number(outcome.current_odds) / 1_000_000;
          return {
            x: region.x + region.width * 0.5 + (i % 2 === 0 ? -8 : 8),
            y: region.y + region.height * 0.5 + (i % 2 === 0 ? 4 : -4),
            r: Math.max(3.5, Math.min(7, lean * 12)),
            color: nodeColors[i % nodeColors.length],
            listed: false,
            status: 'active'
          };
        })
  );
</script>

<svg class="h-20 w-full rounded-2xl border border-terminal-line bg-terminal-bg" viewBox="0 0 120 64" aria-hidden="true">
  <rect width="120" height="64" fill="#050712" />
  {#each regions as region}
    <rect
      x={region.x}
      y={region.y}
      width={region.width}
      height={region.height}
      fill={region.dominant ? 'rgba(83,102,242,0.18)' : region.tint}
      stroke={region.resolvedWon ? '#10b981' : region.dominant ? 'rgba(0,196,255,0.78)' : region.stroke}
      stroke-width={region.dominant || region.resolvedWon ? '2.2' : '1.2'}
      rx="1"
    />
  {/each}
  {#each regions as region}
    {#if region.dominant}
      <text x={region.x + 4} y={region.y + 10} fill="#00c4ff" font-size="6" font-family="var(--font-mono)" font-weight="800">
        LEAN
      </text>
    {/if}
    {#if region.resolvedWon}
      <text x={region.x + region.width - 22} y={region.y + 10} fill="#10b981" font-size="6" font-family="var(--font-mono)" font-weight="800">
        WON
      </text>
    {/if}
  {/each}
  {#each nodes as node}
    <circle cx={node.x} cy={node.y} r={node.r} fill="#050712" stroke={node.color} stroke-width="2" />
    {#if node.listed}
      <rect x={node.x + node.r - 1} y={node.y - node.r - 4} width="12" height="7" fill="rgba(245,158,11,0.18)" stroke="#f59e0b" stroke-width="0.8" rx="1" />
    {/if}
  {/each}
</svg>
