'use client';

import { useState } from 'react';
import type { CanvasNode, CanvasResponse } from '@/lib/api/types';
import type { DerivedMarketSignals, SimpleMarketRead } from '@/lib/utils/signals';
import { deriveMarketSignals, deriveSimpleMarketRead, getRenderedCanvasItems } from '@/lib/utils/signals';
import { formatTokenAmount } from '@/lib/utils/amount';

function CanvasA11yFallback({ nodes }: { nodes: CanvasNode[] }) {
  return (
    <div className="sr-only">
      <h2>Ticket node fallback list</h2>
      <table>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.ticket_id}>
              <td>{node.ticket_id}</td>
              <td>{node.outcome_id}</td>
              <td>{node.current_owner ?? node.owner}</td>
              <td>{node.status}</td>
              <td>{node.listed_price ? formatTokenAmount(node.listed_price) : 'Not listed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketNode({
  node,
  selected,
  hovered,
  compact,
  onSelect,
  onHover
}: {
  node: CanvasNode;
  selected?: boolean;
  hovered?: boolean;
  compact?: boolean;
  onSelect?: (node: CanvasNode) => void;
  onHover?: (node: CanvasNode | null) => void;
}) {
  const statusConfig: Record<string, { label: string; short: string; bg: string; text: string }> = {
    active: { label: 'ACTIVE', short: 'A', bg: '#5366f2', text: '#ffffff' },
    listed: { label: 'LISTED', short: '$', bg: '#f59e0b', text: '#050712' },
    won: { label: 'WON', short: 'W', bg: '#10b981', text: '#050712' },
    lost: { label: 'LOST', short: 'X', bg: '#ef4444', text: '#ffffff' },
    claimed: { label: 'CLAIMED', short: 'C', bg: '#94a3b8', text: '#050712' }
  };
  const moodColor: Record<string, string> = { neutral: '#00c4ff', optimistic: '#60a5fa', anxious: '#ef4444', euphoric: '#818cf8' };
  const config = statusConfig[node.status] ?? statusConfig.active;
  const ringColor = node.listed ? '#f59e0b' : moodColor[node.mood];

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Ticket ${node.ticket_id}, outcome ${node.outcome_id}, ${config.label}, owner ${node.owner_display}, original caller ${node.original_caller_display}, confidence ${node.confidence}`}
      transform={`translate(${node.x} ${node.y})`}
      className="cursor-pointer"
      onClick={() => onSelect?.(node)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(node);
        }
      }}
      onMouseEnter={() => onHover?.(node)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(node)}
      onBlur={() => onHover?.(null)}
    >
      {(selected || node.status === 'won') && <circle r={node.radius + 18} fill="none" stroke={selected ? '#00c4ff' : '#10b981'} strokeWidth="2" opacity="0.34" />}
      <circle r={node.radius + (selected ? 7 : hovered ? 4 : 2)} fill="none" stroke={ringColor} strokeWidth={node.listed ? 3.5 : 2.5} opacity={node.status === 'lost' ? 0.4 : 0.95} />
      <circle r={node.radius} fill={node.status === 'lost' ? 'rgba(148,163,184,0.20)' : 'rgba(5,7,18,0.98)'} stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
      {!compact ? (
        <text y="4" textAnchor="middle" fill={node.status === 'lost' ? '#9ca3af' : '#f8fafc'} fontSize={Math.max(11, node.radius * 0.4)} fontWeight="700" fontFamily="var(--font-mono)">
          {node.owner_display.slice(2, 6)}
        </text>
      ) : null}
      <g transform={`translate(${node.radius * 0.68} ${-node.radius * 0.68})`}>
        <circle r={compact ? 7 : 11} fill={config.bg} opacity={node.status === 'lost' ? 0.5 : 0.95} />
        <text y={compact ? 2.8 : 3.5} textAnchor="middle" fill={config.text} fontSize={compact ? 7 : 10} fontWeight="800" fontFamily="var(--font-mono)">
          {config.short}
        </text>
      </g>
    </g>
  );
}

export default function MarketCanvas({
  canvas,
  mode = 'simple',
  selectedTicketId = null,
  signals,
  simpleRead,
  mock = false,
  onSelect,
  onClearSelection
}: {
  canvas?: CanvasResponse | null;
  mode?: 'simple' | 'detail';
  selectedTicketId?: string | null;
  signals?: DerivedMarketSignals | null;
  simpleRead?: SimpleMarketRead | null;
  mock?: boolean;
  onSelect?: (node: CanvasNode) => void;
  onClearSelection?: () => void;
}) {
  const [activeNode, setActiveNode] = useState<CanvasNode | null>(null);
  const hasCanvasData = Boolean(canvas);
  const view = canvas ?? { market_id: 'empty', market_sequence: 0, canvas_version: 0, width: 1200 as const, height: 630 as const, regions: [], nodes: [] };
  const read = simpleRead ?? deriveSimpleMarketRead({ canvas: view });
  const canvasSignals = signals ?? deriveMarketSignals({ canvas: view });
  const renderedItems = getRenderedCanvasItems({ canvas: view, maxTicketsPerOutcome: 3 });
  const selectedNode = view.nodes.find((node) => node.ticket_id === selectedTicketId) ?? null;

  return (
    <section className="relative aspect-[1200/630] w-full overflow-hidden rounded-[1.5rem] border border-market-positive/35 bg-terminal-bg shadow-[0_0_0_1px_rgba(25,149,255,0.16),0_24px_60px_rgba(0,0,0,0.34)]" aria-label="Canonical market canvas">
      <svg className="block h-full w-full" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Market position map with backend-canonical ticket coordinates" data-canvas-mode={mode}>
        <defs>
          <linearGradient id="field-vignette" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#0b2b3d" />
            <stop offset="52%" stopColor="#07121f" />
            <stop offset="100%" stopColor="#0f1d34" />
          </linearGradient>
          <pattern id="field-dots" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(148,163,184,0.38)" />
          </pattern>
        </defs>
        <rect width={view.width} height={view.height} fill="url(#field-vignette)" />
        <rect width={view.width} height={view.height} fill="url(#field-dots)" opacity="0.34" />
        <rect x="14" y="14" width={view.width - 28} height={view.height - 28} rx="24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        {view.regions.map((region, index) => {
          const isDominant = region.outcome_id === read.dominantOutcomeId || region.label === read.dominantOutcomeLabel;
          return (
            <g key={region.outcome_id}>
              <rect x={region.x + 12} y={region.y + 12} width={region.width - 24} height={region.height - 24} rx="18" fill={isDominant ? 'rgba(0,196,255,0.18)' : 'rgba(83,102,242,0.075)'} stroke={isDominant ? '#00c4ff' : 'rgba(148,163,184,0.28)'} strokeWidth={isDominant ? 3 : 1.5} />
              <text x={region.x + 28} y={region.y + 38} fill={isDominant ? '#ffffff' : '#dbeafe'} fontSize="14" fontWeight="900">
                {region.label}
              </text>
              <text x={region.x + 28} y={region.y + 58} fill={isDominant ? '#93c5fd' : '#9ca3af'} fontSize="11" fontWeight="800" fontFamily="var(--font-mono)">
                {Math.round(Number(region.current_odds) / 10000)}%
              </text>
              <line x1={region.x + 12} y1={region.y + 78} x2={region.x + region.width - 12} y2={region.y + 78} stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
              {mode === 'detail' && <circle cx={region.x + region.width - 44} cy={region.y + 44} r={18 + index * 2} fill="#5366f2" opacity="0.18" />}
            </g>
          );
        })}
        {(mode === 'simple' ? renderedItems : view.nodes.map((node) => ({ type: 'ticket' as const, node }))).map((item) =>
          item.type === 'ticket' ? (
            <TicketNode key={item.node.ticket_id} node={item.node} compact={mode === 'simple'} selected={selectedTicketId === item.node.ticket_id} hovered={activeNode?.ticket_id === item.node.ticket_id} onSelect={onSelect} onHover={setActiveNode} />
          ) : (
            <g key={`cluster-${item.outcome_id}`} transform={`translate(${item.x} ${item.y})`} aria-hidden="true">
              <rect x="-35" y="-14" width="70" height="28" rx="2" fill="rgba(13,16,14,0.96)" stroke="rgba(244,239,218,0.72)" strokeWidth="2" />
              <circle cx="-22" cy="0" r="4" fill="#baff5a" />
              <text y="4" x="-10" fill="#f4efda" fontSize="11" fontWeight="800" fontFamily="var(--font-mono)">
                +{item.count} more
              </text>
            </g>
          )
        )}
        {mode === 'detail' && canvasSignals.dominantOutcomeLabel ? (
          <text x="600" y="602" textAnchor="middle" fill="#00c4ff" fontSize="10" fontWeight="800" fontFamily="var(--font-mono)">
            DOMINANT {canvasSignals.dominantOutcomeLabel}
          </text>
        ) : null}
      </svg>
      {activeNode ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-2xl border border-terminal-line-strong bg-terminal-bg px-3 py-2 shadow-market" role="tooltip">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-terminal-text">Ticket #{activeNode.ticket_id}</span>
            <span className="mono-label text-terminal-muted">{activeNode.status}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-terminal-muted">{activeNode.owner_display}</p>
        </div>
      ) : null}
      {selectedNode ? (
        <div className="absolute bottom-4 left-4 z-20 max-w-sm rounded-2xl border border-terminal-line-strong bg-terminal-bg/95 p-3 shadow-market">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-sm font-bold text-terminal-text">Ticket #{selectedNode.ticket_id}</p>
            <button className="text-terminal-muted" type="button" onClick={onClearSelection} aria-label="Close selected ticket preview">
              x
            </button>
          </div>
          <p className="mt-1 text-xs text-terminal-muted">{selectedNode.listed_price ? formatTokenAmount(selectedNode.listed_price) : selectedNode.status}</p>
        </div>
      ) : null}
      {view.nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-terminal-bg/25 p-6">
          <div className="max-w-md text-center">
            {mock ? <p className="mono-label mx-auto mb-3 inline-flex rounded-full border border-market-warning/35 bg-market-warning/10 px-2.5 py-1 text-market-warning">MOCK FALLBACK ACTIVE</p> : null}
            <p className="mono-label text-terminal-muted">{hasCanvasData ? 'empty sentiment field' : 'API unavailable / projection pending'}</p>
            <h2 className="mt-2 text-xl font-semibold text-terminal-text">{hasCanvasData ? 'No tickets on the field yet.' : 'Canvas projection unavailable.'}</h2>
          </div>
        </div>
      ) : null}
      <CanvasA11yFallback nodes={view.nodes} />
    </section>
  );
}
