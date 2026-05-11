<script lang="ts">
  import type { CanvasNode, CanvasResponse } from '$lib/api/types';
  import type { DerivedMarketSignals, SimpleMarketRead } from '$lib/utils/signals';
  import { deriveMarketSignals, deriveSimpleMarketRead, getRenderedCanvasItems } from '$lib/utils/signals';
  import CanvasA11yFallback from './CanvasA11yFallback.svelte';
  import CanvasBackground from './CanvasBackground.svelte';
  import DensityLayer from './DensityLayer.svelte';
  import FlowTrailLayer from './FlowTrailLayer.svelte';
  import OutcomeRegionLayer from './OutcomeRegionLayer.svelte';
  import SignalMarkerLayer from './SignalMarkerLayer.svelte';
  import SelectedTicketPreview from './SelectedTicketPreview.svelte';
  import TicketClusterLayer from './TicketClusterLayer.svelte';
  import TicketNodeLayer from './TicketNodeLayer.svelte';
  import TicketTooltip from './TicketTooltip.svelte';

  let {
    canvas,
    mode = 'simple',
    selectedTicketId = null,
    signals,
    simpleRead,
    mock = false,
    showSelectedPreview = true,
    onSelect,
    onClearSelection
  }: {
    canvas: CanvasResponse | null | undefined;
    mode?: 'simple' | 'detail';
    selectedTicketId?: string | null;
    signals?: DerivedMarketSignals | null;
    simpleRead?: SimpleMarketRead | null;
    mock?: boolean;
    showSelectedPreview?: boolean;
    onSelect?: (node: CanvasNode) => void;
    onClearSelection?: () => void;
  } = $props();

  let activeNode: CanvasNode | null = $state(null);
  let containerRef: HTMLDivElement | null = $state(null);
  let containerRect: DOMRect | null = $state(null);

  const fallbackCanvas: CanvasResponse = {
    market_id: 'empty',
    market_sequence: 0,
    canvas_version: 0,
    width: 1200,
    height: 630,
    regions: [],
    nodes: []
  };

  const view = $derived(canvas ?? fallbackCanvas);
  const hasNodes = $derived(view.nodes.length > 0);
  const canvasSignals = $derived(signals ?? deriveMarketSignals({ canvas: view }));
  const read = $derived(simpleRead ?? deriveSimpleMarketRead({ canvas: view }));
  const renderedItems = $derived(getRenderedCanvasItems({ canvas: view, maxTicketsPerOutcome: 3 }));
  const selectedNode = $derived(view.nodes.find((node) => node.ticket_id === selectedTicketId) ?? null);

  function updateRect() {
    if (containerRef) {
      containerRect = containerRef.getBoundingClientRect();
    }
  }

  function handleHover(node: CanvasNode | null) {
    activeNode = node;
    if (node) updateRect();
  }
</script>

<svelte:window onresize={updateRect} onscroll={updateRect} />

<section class="relative aspect-[1200/630] w-full overflow-hidden rounded-[1.5rem] border border-terminal-line bg-terminal-bg shadow-market" aria-label="Canonical market canvas">
  <div bind:this={containerRef} class="absolute inset-0">
    <svg
      class="block h-full w-full"
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Market position map with backend-canonical ticket coordinates"
      data-canvas-mode={mode}
    >
      <CanvasBackground width={view.width} height={view.height} />
      <OutcomeRegionLayer
        regions={view.regions}
        activeOutcomeId={activeNode?.outcome_id ?? null}
        {selectedTicketId}
        {mode}
        dominantOutcomeId={read.dominantOutcomeId}
      />
      {#if mode === 'detail'}
        <DensityLayer regions={view.regions} nodes={view.nodes} />
        <FlowTrailLayer nodes={view.nodes} />
        <TicketNodeLayer
          nodes={view.nodes}
          {selectedTicketId}
          activeTicketId={activeNode?.ticket_id ?? null}
          onSelect={(nextNode) => onSelect?.(nextNode)}
          onHover={handleHover}
        />
        <SignalMarkerLayer regions={view.regions} nodes={view.nodes} signals={canvasSignals} />
      {:else}
        <TicketClusterLayer
          items={renderedItems}
          {selectedTicketId}
          activeTicketId={activeNode?.ticket_id ?? null}
          onSelect={(nextNode) => onSelect?.(nextNode)}
          onHover={handleHover}
        />
      {/if}

      {#if !hasNodes}
        <g opacity="0.52" aria-hidden="true">
          <circle cx="310" cy="270" r="28" fill="rgba(17,24,39,0.92)" stroke="rgba(148,163,184,0.20)" stroke-width="2" stroke-dasharray="6 5" />
          <circle cx="605" cy="350" r="38" fill="rgba(5,7,18,0.92)" stroke="rgba(0,196,255,0.34)" stroke-width="2" stroke-dasharray="6 5" />
          <circle cx="880" cy="260" r="24" fill="rgba(17,24,39,0.92)" stroke="rgba(83,102,242,0.42)" stroke-width="2" stroke-dasharray="6 5" />
          <path d="M310 270 C430 210, 520 405, 605 350 S760 220, 880 260" fill="none" stroke="rgba(148,163,184,0.16)" stroke-width="2" stroke-dasharray="8 9" />
        </g>
      {/if}
    </svg>
  </div>

  <!-- HTML Tooltip overlay -->
  {#if activeNode && containerRect}
    <TicketTooltip node={activeNode} {containerRect} />
  {/if}

  {#if mode === 'simple' && showSelectedPreview}
    <SelectedTicketPreview node={selectedNode} onClose={onClearSelection} />
  {/if}

  {#if !hasNodes}
    <div class="pointer-events-none absolute inset-0 grid place-items-center bg-terminal-bg/25 p-6">
      <div class="max-w-md text-center">
        {#if mock}
          <p class="mono-label mx-auto mb-3 inline-flex rounded-full border border-market-warning/35 bg-market-warning/10 px-2.5 py-1 text-market-warning">
            MOCK FALLBACK ACTIVE
          </p>
        {/if}
        <p class="mono-label text-terminal-muted">empty sentiment field</p>
        <h2 class="mt-2 text-xl font-semibold text-terminal-text">No tickets on the field yet.</h2>
        <p class="mt-2 text-sm text-terminal-muted">Back an outcome to place the first position.</p>
      </div>
    </div>
  {/if}

  <CanvasA11yFallback nodes={view.nodes} />
</section>
