<script lang="ts">
  import type { CanvasNode } from '$lib/api/types';

  let {
    node,
    selected = false,
    hovered = false,
    compact = false,
    onSelect,
    onHover
  }: {
    node: CanvasNode;
    selected?: boolean;
    hovered?: boolean;
    compact?: boolean;
    onSelect?: (node: CanvasNode) => void;
    onHover?: (node: CanvasNode | null) => void;
  } = $props();

  const moodColor: Record<string, string> = {
    neutral: '#00c4ff',
    optimistic: '#60a5fa',
    anxious: '#ef4444',
    euphoric: '#818cf8'
  };

  const statusConfig: Record<string, { label: string; short: string; bg: string; text: string }> = {
    active: { label: 'ACTIVE', short: 'A', bg: '#5366f2', text: '#ffffff' },
    listed: { label: 'LISTED', short: '$', bg: '#f59e0b', text: '#050712' },
    won: { label: 'WON', short: '✓', bg: '#10b981', text: '#050712' },
    lost: { label: 'LOST', short: '×', bg: '#ef4444', text: '#ffffff' },
    claimed: { label: 'CLAIMED', short: 'C', bg: '#94a3b8', text: '#050712' }
  };

  const config = $derived(statusConfig[node.status] ?? statusConfig['active']);
  const ringColor = $derived(node.listed ? '#f59e0b' : moodColor[node.mood]);
  const isLost = $derived(node.status === 'lost');
  const isWon = $derived(node.status === 'won');
  const markerX = $derived(node.radius * 0.68);
  const markerY = $derived(-node.radius * 0.68);
  const markerRadius = $derived(compact ? 7 : 11);

  function activate() {
    onSelect?.(node);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  }
</script>

<g
  role="button"
  tabindex="0"
  aria-label={`Ticket ${node.ticket_id}, outcome ${node.outcome_id}, ${config.label}, owner ${node.owner_display}, original caller ${node.original_caller_display}, confidence ${node.confidence}`}
  transform={`translate(${node.x} ${node.y})`}
  class="cursor-pointer"
  onclick={activate}
  onkeydown={keydown}
  onmouseenter={() => onHover?.(node)}
  onmouseleave={() => onHover?.(null)}
  onfocus={() => onHover?.(node)}
  onblur={() => onHover?.(null)}
>
  {#if isWon || selected}
    <circle r={node.radius + 18} fill="none" stroke={selected ? '#00c4ff' : '#10b981'} stroke-width="2" opacity="0.34" />
    <circle r={node.radius + 10} fill={selected ? 'rgba(0,196,255,0.08)' : 'rgba(16,185,129,0.08)'} />
  {/if}

  <circle
    r={node.radius + (selected ? 7 : hovered ? 4 : 2)}
    fill="none"
    stroke={ringColor}
    stroke-width={node.listed ? 3.5 : 2.5}
    opacity={isLost ? 0.4 : 0.95}
  />

  <circle
    r={node.radius + 10}
    fill="none"
    stroke="var(--focus)"
    stroke-width="1.5"
    opacity={selected ? 0.8 : 0}
    stroke-dasharray="4 2"
  />

  <circle
    r={node.radius}
    fill={isLost ? 'rgba(148,163,184,0.20)' : 'rgba(5,7,18,0.98)'}
    stroke="rgba(255,255,255,0.22)"
    stroke-width="2"
  />

  {#if node.avatar_url}
    <clipPath id={`avatar-${node.ticket_id}`}>
      <circle r={node.radius - 5} />
    </clipPath>
    <image
      href={node.avatar_url}
      x={-node.radius + 5}
      y={-node.radius + 5}
      width={(node.radius - 5) * 2}
      height={(node.radius - 5) * 2}
      clip-path={`url(#avatar-${node.ticket_id})`}
      opacity={isLost ? 0.55 : 0.9}
    />
  {/if}

  {#if !compact}
    <text
      y="4"
      text-anchor="middle"
      fill={isLost ? '#9ca3af' : '#f8fafc'}
      font-size={Math.max(11, node.radius * 0.4)}
      font-weight="700"
      font-family="var(--font-mono)"
    >
      {node.owner_display.slice(2, 6)}
    </text>
  {/if}

  <g transform={`translate(${markerX} ${markerY})`}>
    <circle r={markerRadius} fill={config.bg} opacity={isLost ? 0.5 : 0.95} />
    <text y={compact ? 2.8 : 3.5} text-anchor="middle" fill={config.text} font-size={compact ? 7 : 10} font-weight="800" font-family="var(--font-mono)">
      {config.short}
    </text>
  </g>

  {#if !compact && (node.status !== 'active' || node.listed_price)}
    <rect
      x={-(config.label.length * 4.2 + 12) / 2}
      y={node.radius + 10}
      width={config.label.length * 4.2 + 12}
      height="18"
      fill={node.listed ? 'rgba(245,158,11,0.14)' : 'rgba(5,7,18,0.94)'}
      stroke={node.listed ? '#f59e0b' : config.bg}
      stroke-width="2"
      rx="9"
    />
    <text y={node.radius + 23} text-anchor="middle" fill={node.listed ? '#f59e0b' : config.bg} font-size="10" font-family="var(--font-mono)" font-weight="800">
      {config.label}
    </text>
  {/if}
</g>
