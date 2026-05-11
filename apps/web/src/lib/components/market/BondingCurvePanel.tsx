'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CurvePoint, CurveSide, Market, MarketCurve } from '@/lib/api/types';
import { formatTokenAmount, formatUsdPrice } from '@/lib/utils/amount';

const sideStyle: Record<CurveSide['side'], { stroke: string; fill: string; label: string }> = {
  UP: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.16)', label: 'UP' },
  DOWN: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.15)', label: 'DOWN' }
};

type ChartPoint = CurvePoint & {
  x: number;
  y: number;
};

type CurveFilter = 'all' | CurveSide['side'];

export default function BondingCurvePanel({
  curve,
  market
}: {
  curve: MarketCurve | null | undefined;
  market?: Market | null;
}) {
  const [activePoint, setActivePoint] = useState<ChartPoint | null>(null);
  const [filter, setFilter] = useState<CurveFilter>('all');
  const visibleSides = useMemo(() => filteredSides(curve?.sides ?? [], filter), [curve, filter]);
  const view = useMemo(() => buildChartView(curve, filter), [curve, filter]);

  if (!curve || curve.points.length === 0 || curve.sides.length === 0) {
    return (
      <section className="terminal-panel grid min-h-[420px] place-items-center p-6">
        <div className="text-center">
          <p className="mono-label text-terminal-muted">curve projection pending</p>
          <h2 className="mt-2 text-xl font-semibold text-terminal-text">Bonding curve data is unavailable.</h2>
        </div>
      </section>
    );
  }

  const leader = leadingSide(visibleSides);

  return (
    <section className="terminal-panel overflow-hidden p-0" aria-label="UP and DOWN bonding curve chart">
      <div className="border-b border-terminal-line px-4 py-4">
        <MarketCurveHeader market={market} curve={curve} />
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="mono-label text-terminal-muted">bonding curve</p>
            <h2 className="mt-1 text-xl font-black text-terminal-text">UP / DOWN token price</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-terminal-line bg-terminal-bg p-1" aria-label="Curve side filter">
              {(['all', 'UP', 'DOWN'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`curve-filter-${option.toLowerCase()}`}
                  className={`h-8 rounded-full px-3 text-xs font-black transition ${
                    filter === option ? 'bg-terminal-text text-terminal-bg' : 'text-terminal-muted hover:text-terminal-text'
                  }`}
                  onClick={() => setFilter(option)}
                >
                  {option === 'all' ? 'All' : option}
                </button>
              ))}
            </div>
            {curve.sides.map((side) => {
              const active = filter === 'all' || filter === side.side;
              return (
                <button
                  key={side.side}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-sm font-black transition ${
                    active ? 'border-terminal-line bg-terminal-bg text-terminal-text' : 'border-terminal-line bg-terminal-bg/40 text-terminal-muted opacity-60'
                  }`}
                  onClick={() => setFilter(side.side)}
                >
                  <span style={{ color: sideStyle[side.side].stroke }}>{side.side}</span>
                  <span className="ml-2 font-mono">{formatUsdPrice(side.price)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-[420px] p-4">
          <svg className="h-full min-h-[390px] w-full" viewBox="0 0 900 420" role="img" aria-label="UP and DOWN token bonding curve prices">
            <defs>
              <linearGradient id="curve-grid-fade" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(148,163,184,0.16)" />
                <stop offset="100%" stopColor="rgba(148,163,184,0.02)" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="900" height="420" rx="18" fill="rgba(5,7,18,0.65)" />
            {view.gridLines.map((line) => (
              <g key={line.y}>
                <line x1="54" x2="856" y1={line.y} y2={line.y} stroke="url(#curve-grid-fade)" strokeWidth="1" />
                <text x="28" y={line.y + 4} fill="#64748b" fontSize="11" fontFamily="var(--font-mono)">
                  {line.label}
                </text>
              </g>
            ))}
            {view.paths.map((path) => (
              <g key={path.side} data-curve-side={path.side}>
                <path d={`${path.area} L ${path.endX} 362 L ${path.startX} 362 Z`} fill={sideStyle[path.side].fill} />
                <path data-curve-line={path.side} d={path.line} fill="none" stroke={sideStyle[path.side].stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {path.points.map((point) => (
                  <circle
                    key={`${point.side}-${point.ts}`}
                    cx={point.x}
                    cy={point.y}
                    r={8}
                    fill={sideStyle[point.side].stroke}
                    opacity={activePoint === point ? 1 : 0}
                    onMouseEnter={() => setActivePoint(point)}
                    onMouseLeave={() => setActivePoint(null)}
                  />
                ))}
              </g>
            ))}
            <line x1="54" x2="856" y1="362" y2="362" stroke="rgba(148,163,184,0.18)" />
          </svg>
          {activePoint ? (
            <div className="absolute left-6 top-6 rounded-xl border border-terminal-line bg-terminal-bg/95 px-3 py-2 shadow-market">
              <p className="text-sm font-black text-terminal-text">
                <span style={{ color: sideStyle[activePoint.side].stroke }}>{activePoint.side}</span> {formatUsdPrice(activePoint.price)}
              </p>
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                vMC {formatUsdPrice(activePoint.market_cap)} · Liq {formatUsdPrice(activePoint.liquidity)}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="border-t border-terminal-line p-4 xl:border-l xl:border-t-0" aria-label="Curve metrics">
          <p className="mono-label text-terminal-muted">curve read</p>
          <h3 className="mt-1 text-lg font-black text-terminal-text">Leads {leader?.side ?? '-'}</h3>
          <div className="mt-4 grid gap-3">
            <Metric label="Virtual MC" value={sumMetric(visibleSides, 'market_cap')} />
            <Metric label="Liquidity" value={sumMetric(visibleSides, 'liquidity')} />
            <Metric label="Volume" value={sumMetric(visibleSides, 'volume')} />
          </div>
          <div className="mt-4 grid gap-2">
            {visibleSides.map((side) => (
              <div key={side.side} className="rounded-xl border border-terminal-line bg-terminal-bg px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black" style={{ color: sideStyle[side.side].stroke }}>{side.side}</span>
                  <span className="font-mono text-terminal-text">{formatUsdPrice(side.price)}</span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-terminal-muted">
                  {formatUsdPrice(side.liquidity)} liq · {formatUsdPrice(side.volume)} vol
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function MarketCurveHeader({
  market,
  curve
}: {
  market: Market | null | undefined;
  curve: MarketCurve;
}) {
  const header = market?.price_header;
  const total = market?.outcomes.reduce((sum, outcome) => sum + BigInt(outcome.total_stake || '0'), 0n) ?? 0n;
  const assetLabel = header ? `${header.asset} ${Math.round(header.duration_seconds / 60)}m` : `Market ${curve.market_id}`;
  const secondaryLabel = header?.price_display_state === 'closed' ? 'Close' : 'Now';
  const secondaryValue = header?.price_display_state === 'closed' ? header.close_price : header?.current_price ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.75fr)] lg:items-end">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {header ? (
            <img
              src={header.asset_image_url}
              alt={`${header.asset} market`}
              className="h-12 w-12 shrink-0 rounded-xl border border-terminal-line bg-terminal-bg"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-black text-terminal-text">{assetLabel}</h1>
              {header ? (
                <span className="mono-label rounded-full border border-terminal-line bg-terminal-bg px-3 py-1 text-terminal-muted">
                  {header.symbol}
                </span>
              ) : null}
            </div>
            {market ? <p className="mt-1 truncate text-sm font-bold text-terminal-muted">{market.question_hash}</p> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <PriceBox label="Open" value={header?.open_price ?? null} />
          <PriceBox label={secondaryLabel} value={secondaryValue} accent={header?.price_display_state === 'closed'} />
        </div>
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          <HeaderChip tone={market?.status === 'resolved' ? 'success' : market?.status === 'open' ? 'positive' : 'neutral'}>
            {market?.status ?? 'projection'}
          </HeaderChip>
          <HeaderChip tone="info">{market?.outcome_count ?? curve.sides.length} outcomes</HeaderChip>
          <HeaderChip tone="info">{formatTokenAmount(total)} staked</HeaderChip>
        </div>
      </div>
    </div>
  );
}

function PriceBox({ label, value, accent = false }: { label: string; value: string | null; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-terminal-line bg-terminal-bg px-4 py-3">
      <p className="mono-label text-terminal-muted">{label}</p>
      <p className={`mt-2 truncate font-mono text-2xl font-black ${accent ? 'text-market-warning' : 'text-terminal-text'}`}>
        {formatUsdPrice(value)}
      </p>
    </div>
  );
}

function HeaderChip({ children, tone }: { children: ReactNode; tone: 'positive' | 'success' | 'info' | 'neutral' }) {
  const toneClass = {
    positive: 'border-market-positive/40 bg-market-positive/10 text-market-positive',
    success: 'border-market-positive/40 bg-market-positive/10 text-market-positive',
    info: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
    neutral: 'border-terminal-line bg-terminal-bg text-terminal-muted'
  }[tone];

  return (
    <span className={`rounded-full border px-4 py-2 text-sm font-black uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-terminal-line bg-terminal-bg px-3 py-2">
      <p className="mono-label text-terminal-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-black text-terminal-text">{formatUsdPrice(value)}</p>
    </div>
  );
}

function buildChartView(curve: MarketCurve | null | undefined, filter: CurveFilter) {
  const points = (curve?.points ?? []).filter((point) => filter === 'all' || point.side === filter);
  const prices = points.map((point) => Number(BigInt(point.price)) / 1_000_000);
  const min = Math.min(...prices, 0.45);
  const max = Math.max(...prices, 0.55);
  const pad = Math.max((max - min) * 0.18, 0.02);
  const minY = min - pad;
  const maxY = max + pad;
  const minTs = Math.min(...points.map((point) => point.ts), 0);
  const maxTs = Math.max(...points.map((point) => point.ts), minTs + 1);

  const paths = (['UP', 'DOWN'] as const)
    .filter((side) => filter === 'all' || filter === side)
    .map((side) => {
    const chartPoints = points
      .filter((point) => point.side === side)
      .map((point) => {
        const x = 54 + ((point.ts - minTs) / Math.max(maxTs - minTs, 1)) * 802;
        const price = Number(BigInt(point.price)) / 1_000_000;
        const y = 36 + (1 - (price - minY) / Math.max(maxY - minY, 0.01)) * 326;
        return { ...point, x, y };
      });

    const line = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    return {
      side,
      points: chartPoints,
      line,
      area: line,
      startX: chartPoints[0]?.x ?? 54,
      endX: chartPoints.at(-1)?.x ?? 856
    };
    });

  return {
    paths,
    gridLines: [0, 1, 2, 3].map((index) => {
      const value = maxY - ((maxY - minY) * index) / 3;
      return {
        y: 36 + (326 * index) / 3,
        label: `$${value.toFixed(2)}`
      };
    })
  };
}

function filteredSides(sides: CurveSide[], filter: CurveFilter) {
  return filter === 'all' ? sides : sides.filter((side) => side.side === filter);
}

function sumMetric(sides: CurveSide[], key: 'market_cap' | 'liquidity' | 'volume') {
  return sides.reduce((sum, side) => sum + BigInt(side[key]), 0n).toString();
}

function leadingSide(sides: CurveSide[]) {
  return [...sides].sort((a, b) => Number(BigInt(b.market_cap) - BigInt(a.market_cap)))[0] ?? null;
}
