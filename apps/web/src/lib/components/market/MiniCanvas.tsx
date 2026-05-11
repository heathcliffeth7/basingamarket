import type { CanvasResponse } from '@/lib/api/types';

export default function MiniCanvas({ canvas }: { canvas?: CanvasResponse | null }) {
  const view = canvas ?? { width: 1200, height: 630, regions: [], nodes: [] };

  return (
    <div className="aspect-[1200/630] overflow-hidden rounded-2xl border border-terminal-line bg-terminal-bg">
      <svg className="h-full w-full" viewBox={`0 0 ${view.width} ${view.height}`} aria-hidden="true">
        <rect width={view.width} height={view.height} fill="#050712" />
        {view.regions.map((region) => (
          <rect key={region.outcome_id} x={region.x + 16} y={region.y + 16} width={region.width - 32} height={region.height - 32} rx="20" fill="rgba(0,196,255,0.07)" stroke="rgba(148,163,184,0.18)" />
        ))}
        {view.nodes.map((node) => (
          <circle key={node.ticket_id} cx={node.x} cy={node.y} r={node.radius} fill={node.listed ? '#f59e0b' : '#5366f2'} opacity={node.status === 'lost' ? 0.45 : 0.9} />
        ))}
      </svg>
    </div>
  );
}
