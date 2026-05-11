'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { Check, ChevronDown, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { Market, MarketCurve, MarketPricePoint, MarketPriceSeries } from '@/lib/api/types';
import type { LivePriceStore } from '@/lib/api/livePriceStore';
import type { LiveTickerUpdate } from '@/lib/api/livePrices';
import { priceSeriesForSelectedRound } from '@/lib/markets/roundDataGuards';
import { liveMarketRoundHref } from '@/lib/markets/routes';
import { formatEtChartTime, formatEtRoundWindow } from '@/lib/markets/time';
import { formatUsdPrice, scaledUsdToNumber } from '@/lib/utils/amount';
import LiveAssetPriceCanvas from './LiveAssetPriceCanvas';

type ChartPoint = MarketPricePoint & {
  x: number;
  y: number;
};

const PRICE_NUMBER_FORMAT = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
} satisfies Intl.NumberFormatOptions;

const PRICE_FLOW_TIMING = { duration: 160, easing: 'ease-out' } satisfies EffectTiming;
const PRICE_FLOW_SPIN_TIMING = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' } satisfies EffectTiming;
const PRICE_FLOW_OPACITY_TIMING = { duration: 120, easing: 'ease-out' } satisfies EffectTiming;
const MARKET_SWITCHER_DURATIONS = [
  { label: '1 Min', durationSeconds: 60 },
  { label: '5 Min', durationSeconds: 300 }
] as const;
const MARKET_SWITCHER_ASSETS = ['BTC', 'ETH', 'SOL'] as const;
const MARKET_SWITCHER_ASSET_NAMES: Record<typeof MARKET_SWITCHER_ASSETS[number], string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana'
};

type MarketSwitcherDuration = typeof MARKET_SWITCHER_DURATIONS[number]['durationSeconds'];
type MarketSwitcherAsset = typeof MARKET_SWITCHER_ASSETS[number];
type MarketSwitcherOption = {
  market: Market;
  asset: MarketSwitcherAsset;
  durationSeconds: MarketSwitcherDuration;
  assetName: string;
  imageUrl: string;
  leader: MarketSwitcherLeader | null;
};
type MarketSwitcherLeader = {
  side: 'UP' | 'DOWN';
  price: string;
};
type MarketSwitcherCurveMap = Record<string, MarketCurve | null | undefined>;

export default function AssetPriceChartPanel({
  market,
  series,
  selectedStartAt,
  liveHref,
  viewingLive,
  livePriceStore,
  switcherMarkets = [],
  switcherCurves = {},
  onGoLiveMarketClick
}: {
  market: Market | null | undefined;
  series: MarketPriceSeries | null | undefined;
  selectedStartAt?: number;
  liveHref: string;
  viewingLive: boolean;
  livePriceStore?: LivePriceStore | null;
  switcherMarkets?: Market[];
  switcherCurves?: MarketSwitcherCurveMap;
  onGoLiveMarketClick?: (href: string) => void;
}) {
  const header = market?.price_header ?? null;
  const selectedSeries = priceSeriesForSelectedRound(series, selectedStartAt);
  const durationSeconds = selectedSeries?.duration_seconds ?? header?.duration_seconds ?? 300;
  const startAt = selectedSeries?.start_at ?? selectedStartAt ?? header?.start_at ?? 0;
  const endAt = selectedSeries?.end_at ?? startAt + durationSeconds;
  const nowTs = useHydrationSafeNowTs(viewingLive ? startAt : endAt);
  const roundExpired = viewingLive && endAt > 0 && nowTs >= endAt;
  const liveWindowActive = viewingLive && !roundExpired;
  const effectiveLiveHref = roundExpired && market ? liveMarketRoundHref(market, nowTs * 1000) : liveHref;
  const livePrice = useThrottledLivePrice(livePriceStore, header?.symbol, startAt, endAt, liveWindowActive);
  const model = useMemo(
    () => buildPriceModel(market, selectedSeries, selectedStartAt, liveWindowActive, livePrice?.currentPrice ?? null, nowTs),
    [livePrice?.currentPrice, liveWindowActive, market, nowTs, selectedSeries, selectedStartAt]
  );
  const useLiveCanvas = liveWindowActive && !model.closed;
  const chart = useMemo(() => useLiveCanvas ? null : buildChartView(model.points, model.openPrice), [model.openPrice, model.points, useLiveCanvas]);
  const delta = useMemo(() => priceDelta(model.openPrice, model.displayPrice), [model.displayPrice, model.openPrice]);
  const marketSwitcherMarkets = useMemo(() => {
    if (!market) {
      return switcherMarkets;
    }

    return switcherMarkets.some((candidate) => candidate.market_id === market.market_id)
      ? switcherMarkets
      : [market, ...switcherMarkets];
  }, [market, switcherMarkets]);

  if (!model.header) {
    return (
      <section className="terminal-panel grid min-h-[520px] place-items-center p-6">
        <div className="text-center">
          <p className="mono-label text-terminal-muted">price chart pending</p>
          <h2 className="mt-2 text-xl font-semibold text-terminal-text">Market price data is unavailable.</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="terminal-panel overflow-hidden p-0" aria-label="Asset price round chart">
      <div className="p-3 sm:p-4">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <img
              src={model.header.asset_image_url}
              alt={`${model.header.asset} logo`}
              className="h-12 w-12 shrink-0 rounded-xl bg-black object-cover sm:h-14 sm:w-14"
            />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black leading-tight text-terminal-text sm:text-2xl">
                {model.header.asset} Up or Down {Math.round(model.header.duration_seconds / 60)}m
              </h1>
              <p className="mt-1 text-sm font-bold text-terminal-muted sm:text-base">{formatEtRoundWindow(model.startAt, model.endAt)}</p>
            </div>
          </div>
          <MarketSwitcher
            currentAsset={model.header.asset}
            currentDurationSeconds={model.header.duration_seconds}
            markets={marketSwitcherMarkets}
            curves={switcherCurves}
            nowMs={nowTs * 1000}
          />
        </div>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">
            <PriceReadout label="Price To Beat" value={model.openPrice} muted />
            <div className="hidden h-10 w-px bg-terminal-line-strong sm:block" />
            <AnimatedPriceReadout
              label={model.closed ? 'Final price' : 'Current Price'}
              value={model.displayPrice}
              accent={!model.closed}
              delta={delta}
              animate={!model.closed && liveWindowActive}
            />
          </div>

          {liveWindowActive ? (
            <Countdown endAt={model.endAt} nowTs={nowTs} />
          ) : (
            <a
              href={effectiveLiveHref}
              onClick={() => onGoLiveMarketClick?.(effectiveLiveHref)}
              data-testid="go-live-market"
              className="inline-flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-terminal-panel-strong px-5 text-sm font-black text-terminal-text transition hover:bg-terminal-line-strong"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-market-negative" />
              Go to live market
              <ChevronRight size={18} />
            </a>
          )}
        </div>

        <div className="relative mt-4 min-h-[240px] sm:min-h-[280px]" aria-label="Underlying asset price chart">
          <svg className="h-full min-h-[240px] w-full sm:min-h-[280px]" viewBox="0 0 1120 280" role="img" aria-label={`${model.header.asset} price line`}>
            <defs>
              <linearGradient id="asset-price-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(245,158,11,0.12)" />
                <stop offset="100%" stopColor="rgba(245,158,11,0.00)" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="1120" height="280" fill="transparent" />
            {chart ? (
              <>
                {chart.gridLines.map((line) => (
                  <g key={line.y}>
                    <line x1="0" x2="1000" y1={line.y} y2={line.y} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
                    <text x="1014" y={line.y + 4} fill="#94a3b8" fontSize="12" fontFamily="var(--font-mono)">
                      {line.label}
                    </text>
                  </g>
                ))}
                {chart.targetY ? (
                  <g>
                    <line x1="0" x2="1000" y1={chart.targetY} y2={chart.targetY} stroke="rgba(245,158,11,0.70)" strokeDasharray="7 9" strokeWidth="2" />
                    <rect x="990" y={chart.targetY - 12} width="72" height="24" rx="12" fill="#64748b" />
                    <text x="1026" y={chart.targetY + 4} fill="#f8fafc" fontSize="12" fontWeight="800" textAnchor="middle">
                      Target
                    </text>
                  </g>
                ) : null}
                <path d={`${chart.linePath} L ${chart.lastX} 238 L ${chart.firstX} 238 Z`} fill="url(#asset-price-fill)" />
                <path data-testid="asset-price-line" className="asset-price-motion" d={chart.linePath} fill="none" stroke="#f59e0b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
                {chart.lastPoint ? <circle className="asset-price-dot-motion" cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="6" fill="#f59e0b" /> : null}
                <line x1="0" x2="1000" y1="238" y2="238" stroke="rgba(148,163,184,0.24)" />
                {chart.timeLabels.map((label) => (
                  <text key={label.x} x={label.x} y="268" fill="#94a3b8" fontSize="12" fontFamily="var(--font-mono)" textAnchor={label.anchor}>
                    {label.text}
                  </text>
                ))}
              </>
            ) : null}
          </svg>
          {useLiveCanvas ? (
            <div className="absolute inset-0">
              <LiveAssetPriceCanvas
                symbol={model.header.symbol}
                startAt={model.startAt}
                endAt={model.endAt}
                openPrice={model.openPrice}
                points={model.points}
                livePriceStore={livePriceStore}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MarketSwitcher({
  currentAsset,
  currentDurationSeconds,
  markets,
  curves,
  nowMs
}: {
  currentAsset: string;
  currentDurationSeconds: number;
  markets: Market[];
  curves: MarketSwitcherCurveMap;
  nowMs: number;
}) {
  const currentSwitcherDuration = isMarketSwitcherDuration(currentDurationSeconds) ? currentDurationSeconds : 300;
  const [open, setOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<MarketSwitcherDuration>(currentSwitcherDuration);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const options = useMemo(() => buildMarketSwitcherOptions(markets, curves), [curves, markets]);
  const visibleOptions = useMemo(
    () => options.filter((option) => option.durationSeconds === selectedDuration),
    [options, selectedDuration]
  );

  useEffect(() => {
    setSelectedDuration(currentSwitcherDuration);
  }, [currentSwitcherDuration]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative self-end xl:self-start">
      <button
        type="button"
        data-testid="market-switcher-trigger"
        aria-label="Change market"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-terminal-line bg-terminal-panel-strong px-4 text-sm font-black text-terminal-text transition hover:border-terminal-line-strong hover:bg-terminal-line-strong"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-market-negative" />
        <span className="whitespace-nowrap">{currentAsset} · {formatMarketSwitcherDuration(currentDurationSeconds)}</span>
        <ChevronDown size={17} className={`transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="market-switcher-menu"
          className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-terminal-line-strong bg-terminal-panel p-2 shadow-market sm:w-96"
        >
          <div className="grid grid-cols-2 gap-1 rounded-full border border-terminal-line bg-terminal-bg p-1" role="tablist" aria-label="Market duration">
            {MARKET_SWITCHER_DURATIONS.map((duration) => {
              const active = selectedDuration === duration.durationSeconds;
              return (
                <button
                  key={duration.durationSeconds}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`market-switcher-duration-${duration.durationSeconds}`}
                  onClick={() => setSelectedDuration(duration.durationSeconds)}
                  className={`h-9 rounded-full text-sm font-black transition ${active
                    ? 'bg-terminal-text text-terminal-bg'
                    : 'text-terminal-muted hover:bg-terminal-panel-strong hover:text-terminal-text'}`}
                >
                  {duration.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 grid gap-1">
            {visibleOptions.length > 0 ? visibleOptions.map((option) => {
              const active = option.asset === currentAsset && option.durationSeconds === currentDurationSeconds;

              return (
                <a
                  key={`${option.asset}-${option.durationSeconds}`}
                  href={liveMarketRoundHref(option.market, nowMs)}
                  role="menuitem"
                  data-testid={`market-switcher-option-${option.asset}-${option.durationSeconds}`}
                  onClick={() => setOpen(false)}
                  className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active
                    ? 'border-market-warning/60 bg-terminal-panel-strong text-terminal-text'
                    : 'border-transparent text-terminal-text hover:border-terminal-line hover:bg-terminal-bg'}`}
                >
                  <img
                    src={option.imageUrl}
                    alt={`${option.asset} logo`}
                    className="h-10 w-10 rounded-xl bg-black object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">
                      {option.assetName} Up or Down - {formatMarketSwitcherDuration(option.durationSeconds)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-bold text-terminal-muted">{option.asset} Live</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      data-testid={`market-switcher-leader-${option.asset}-${option.durationSeconds}`}
                      className="min-w-[4.5rem] text-right"
                    >
                      {option.leader ? (
                        <span className={`block font-black leading-none ${option.leader.side === 'UP' ? 'text-market-success' : 'text-market-negative'}`}>
                          <span className="block text-[10px]">{option.leader.side}</span>
                          <span className="mt-0.5 block font-mono text-lg">{formatUsdPrice(option.leader.price)}</span>
                        </span>
                      ) : (
                        <span className="block font-mono text-lg font-black leading-none text-terminal-muted">-</span>
                      )}
                    </span>
                    {active ? <Check size={18} className="text-market-warning" aria-hidden="true" /> : <ChevronRight size={18} className="text-terminal-muted" aria-hidden="true" />}
                  </span>
                </a>
              );
            }) : (
              <p className="rounded-xl border border-terminal-line bg-terminal-bg px-3 py-3 text-sm font-bold text-terminal-muted">
                No live markets
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildMarketSwitcherOptions(markets: Market[], curves: MarketSwitcherCurveMap) {
  const options = new Map<string, MarketSwitcherOption>();

  for (const market of markets) {
    const header = market.price_header;

    if (!header || !isMarketSwitcherAsset(header.asset) || !isMarketSwitcherDuration(header.duration_seconds)) {
      continue;
    }

    const key = `${header.asset}-${header.duration_seconds}`;

    if (options.has(key)) {
      continue;
    }

    options.set(key, {
      market,
      asset: header.asset,
      durationSeconds: header.duration_seconds,
      assetName: MARKET_SWITCHER_ASSET_NAMES[header.asset],
      imageUrl: header.asset_image_url,
      leader: marketCurveLeader(curves[market.market_id])
    });
  }

  return Array.from(options.values()).sort((a, b) => {
    const assetOrder = MARKET_SWITCHER_ASSETS.indexOf(a.asset) - MARKET_SWITCHER_ASSETS.indexOf(b.asset);
    return assetOrder === 0 ? a.durationSeconds - b.durationSeconds : assetOrder;
  });
}

function marketCurveLeader(curve: MarketCurve | null | undefined): MarketSwitcherLeader | null {
  const upPrice = switcherSidePrice(curve, 'UP');
  const downPrice = switcherSidePrice(curve, 'DOWN');
  const upValue = safeBigInt(upPrice);
  const downValue = safeBigInt(downPrice);

  if (upValue === null && downValue === null) {
    return null;
  }

  if (downValue === null || (upValue !== null && upValue >= downValue)) {
    return upPrice ? { side: 'UP', price: upPrice } : null;
  }

  return downPrice ? { side: 'DOWN', price: downPrice } : null;
}

function switcherSidePrice(curve: MarketCurve | null | undefined, side: MarketSwitcherLeader['side']) {
  const curveSide = curve?.sides.find((candidate) => candidate.side === side);
  return curveSide?.best_entry_price || curveSide?.price || null;
}

function safeBigInt(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isMarketSwitcherAsset(asset: string): asset is MarketSwitcherAsset {
  return (MARKET_SWITCHER_ASSETS as readonly string[]).includes(asset);
}

function isMarketSwitcherDuration(durationSeconds: number): durationSeconds is MarketSwitcherDuration {
  return durationSeconds === 60 || durationSeconds === 300;
}

function formatMarketSwitcherDuration(durationSeconds: number) {
  return `${Math.round(durationSeconds / 60)} Min`;
}

function PriceReadout({
  label,
  value,
  muted = false,
  accent = false,
  delta = null
}: {
  label: string;
  value: string | null;
  muted?: boolean;
  accent?: boolean;
  delta?: ReturnType<typeof priceDelta>;
}) {
  return (
    <div className="min-w-[150px]">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-black ${accent ? 'text-market-warning' : 'text-terminal-muted'}`}>{label}</p>
        {delta ? (
          <span className={`inline-flex items-center gap-1 text-xs font-black ${delta.positive ? 'text-market-success' : 'text-market-negative'}`}>
            {delta.positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {delta.value}
          </span>
        ) : null}
      </div>
      <p className={`mt-1 font-mono text-2xl font-black leading-none sm:text-3xl ${muted ? 'text-terminal-muted' : accent ? 'text-market-warning' : 'text-terminal-text'}`}>
        {formatUsdPrice(value)}
      </p>
    </div>
  );
}

function AnimatedPriceReadout({
  label,
  value,
  accent = false,
  delta = null,
  animate = false
}: {
  label: string;
  value: string | null;
  accent?: boolean;
  delta?: ReturnType<typeof priceDelta>;
  animate?: boolean;
}) {
  const direction = usePriceDirection(value, animate, delta?.positive === false ? 'down' : 'up');
  const priceNumber = scaledUsdToNumber(value);
  const deltaNumber = scaledUsdToNumber(delta?.amount ?? null);

  return (
    <div className="min-w-[150px]" data-testid="animated-price-readout" data-price-direction={direction}>
      <div className="flex items-center gap-2">
        <p className={`text-sm font-black ${accent ? 'text-market-warning' : 'text-terminal-muted'}`}>{label}</p>
        {delta ? (
          <span className={`price-delta-flow inline-flex items-center gap-1 text-xs font-black ${delta.positive ? 'text-market-success' : 'text-market-negative'}`}>
            {delta.positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {deltaNumber === null ? (
              <span>{delta.value}</span>
            ) : (
              <NumberFlow
                value={deltaNumber}
                format={PRICE_NUMBER_FORMAT}
                isolate
                willChange={animate}
                animated={animate}
                transformTiming={PRICE_FLOW_TIMING}
                spinTiming={PRICE_FLOW_SPIN_TIMING}
                opacityTiming={PRICE_FLOW_OPACITY_TIMING}
              />
            )}
          </span>
        ) : null}
      </div>
      <NumberFlowGroup>
        <p className={`mt-1 font-mono text-2xl font-black leading-none sm:text-3xl ${accent ? 'text-market-warning' : 'text-terminal-text'}`}>
          {priceNumber === null ? (
            <span>-</span>
          ) : (
            <NumberFlow
              className="price-number-flow"
              value={priceNumber}
              format={PRICE_NUMBER_FORMAT}
              isolate
              willChange={animate}
              animated={animate}
              transformTiming={PRICE_FLOW_TIMING}
              spinTiming={PRICE_FLOW_SPIN_TIMING}
              opacityTiming={PRICE_FLOW_OPACITY_TIMING}
            />
          )}
        </p>
      </NumberFlowGroup>
    </div>
  );
}

function Countdown({ endAt, nowTs }: { endAt: number; nowTs: number }) {
  const remaining = Math.max(endAt - nowTs, 0);
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
  const seconds = (remaining % 60).toString().padStart(2, '0');

  return (
    <div className="grid grid-cols-2 gap-3 text-center font-mono text-market-negative" aria-label="Round countdown">
      <div>
        <p className="text-2xl font-black leading-none 2xl:text-3xl">{minutes}</p>
        <p className="mt-1 text-[10px] font-black text-terminal-muted">MINS</p>
      </div>
      <div>
        <p className="text-2xl font-black leading-none 2xl:text-3xl">{seconds}</p>
        <p className="mt-1 text-[10px] font-black text-terminal-muted">SECS</p>
      </div>
    </div>
  );
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function useHydrationSafeNowTs(fallbackNowTs: number) {
  const [nowTs, setNowTs] = useState(fallbackNowTs);

  useEffect(() => {
    const syncNow = () => setNowTs(currentUnixSeconds());
    syncNow();
    const timer = window.setInterval(syncNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return nowTs;
}

function buildPriceModel(
  market: Market | null | undefined,
  series: MarketPriceSeries | null | undefined,
  selectedStartAt: number | undefined,
  viewingLive: boolean,
  livePriceOverride: string | null,
  nowTs = currentUnixSeconds()
) {
  const header = market?.price_header ?? null;
  const hasSeries = series !== null && series !== undefined;
  const durationSeconds = series?.duration_seconds ?? header?.duration_seconds ?? 300;
  const startAt = series?.start_at ?? selectedStartAt ?? header?.start_at ?? 0;
  const endAt = series?.end_at ?? startAt + durationSeconds;
  const headerMatchesSelectedRound = selectedStartAt === undefined || header?.start_at === selectedStartAt;
  const headerOpenPrice = headerMatchesSelectedRound ? header?.open_price ?? null : null;
  const headerCurrentPrice = headerMatchesSelectedRound ? header?.current_price ?? null : null;
  const headerClosePrice = headerMatchesSelectedRound ? header?.close_price ?? null : null;
  const openPrice = hasSeries ? series.open_price : headerOpenPrice;
  const historicalWindowEnded = !viewingLive && endAt <= nowTs;
  const closed = viewingLive
    ? header?.price_display_state === 'closed'
    : series?.status === 'closed' || (headerMatchesSelectedRound && header?.price_display_state === 'closed') || historicalWindowEnded;
  const displayPrice = closed
    ? hasSeries ? series.close_price ?? series.current_price ?? null : headerClosePrice ?? headerCurrentPrice
    : livePriceOverride ?? headerCurrentPrice ?? (hasSeries ? series.current_price ?? series.close_price ?? null : null);
  const points = viewingLive && !closed
    ? normalizeInitialLivePoints(series?.points ?? [], startAt, openPrice, displayPrice)
    : normalizePoints(series?.points ?? [], startAt, endAt, openPrice, displayPrice, closed, nowTs);

  return {
    header,
    startAt,
    endAt,
    openPrice,
    displayPrice,
    closed,
    points
  };
}

function useThrottledLivePrice(
  livePriceStore: LivePriceStore | null | undefined,
  symbol: string | null | undefined,
  startAt: number,
  endAt: number,
  enabled: boolean
) {
  const [snapshot, setSnapshot] = useState<LiveTickerUpdate | null>(null);
  const latestRef = useRef<LiveTickerUpdate | null>(null);
  const lastFlushRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setSnapshot(null);
    latestRef.current = null;
    lastFlushRef.current = 0;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [startAt, symbol]);

  useEffect(() => {
    if (!enabled || !livePriceStore || !symbol) return;

    function flush() {
      timerRef.current = null;
      lastFlushRef.current = performance.now();
      setSnapshot(latestRef.current);
    }

    function schedule(update: LiveTickerUpdate) {
      if (update.symbol !== symbol || update.ts < startAt || update.ts > endAt) return;
      latestRef.current = update;
      const now = performance.now();
      const waitMs = Math.max(100 - (now - lastFlushRef.current), 0);
      if (waitMs === 0) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        flush();
        return;
      }
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(flush, waitMs);
      }
    }

    const latest = livePriceStore.getLatest(symbol);
    if (latest) schedule(latest);
    const unsubscribe = livePriceStore.subscribe(schedule);
    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, endAt, livePriceStore, startAt, symbol]);

  return snapshot;
}

function normalizeInitialLivePoints(
  points: MarketPricePoint[],
  startAt: number,
  openPrice: string | null,
  displayPrice: string | null
) {
  if (points.length > 0) {
    return points;
  }

  const base = [
    ...(openPrice ? [{ ts: startAt, price: openPrice }] : []),
    ...(displayPrice ? [{ ts: startAt + 1, price: displayPrice }] : [])
  ];
  return base.length > 0 ? base : [];
}

function normalizePoints(
  points: MarketPricePoint[],
  startAt: number,
  endAt: number,
  openPrice: string | null,
  displayPrice: string | null,
  closed: boolean,
  nowTs: number
) {
  const base = (points.length > 0 ? points : [
    ...(openPrice ? [{ ts: startAt, price: openPrice }] : []),
    ...(displayPrice ? [{ ts: endAt, price: displayPrice }] : [])
  ]).sort((a, b) => a.ts - b.ts);
  const terminalTs = closed ? endAt : Math.min(nowTs, endAt);

  if (base.length === 1 && displayPrice) {
    return [base[0], { ts: terminalTs, price: displayPrice }];
  }

  if (!displayPrice || base.length === 0) {
    return base;
  }

  const last = base.at(-1);

  if (!closed && last?.price === displayPrice) {
    return base;
  }

  if (last?.price === displayPrice && last.ts === terminalTs) {
    return base;
  }

  const previous = base.filter((point) => point.ts < terminalTs);
  return [...previous, { ts: terminalTs, price: displayPrice }];
}

function usePriceDirection(value: string | null, enabled: boolean, fallback: 'up' | 'down') {
  const previousRef = useRef<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down'>(fallback);

  useEffect(() => {
    if (!enabled || !value) {
      previousRef.current = value;
      setDirection(fallback);
      return;
    }

    const previous = previousRef.current;
    previousRef.current = value;

    if (!previous || previous === value) {
      return;
    }

    setDirection(BigInt(value) > BigInt(previous) ? 'up' : 'down');
  }, [enabled, fallback, value]);

  return direction;
}

function buildChartView(points: MarketPricePoint[], openPrice: string | null) {
  const usablePoints = points.length > 0 ? points : [{ ts: 0, price: '0' }, { ts: 1, price: '0' }];
  const values = usablePoints.map((point) => BigInt(point.price));
  const minValue = values.reduce((min, value) => value < min ? value : min, values[0]);
  const maxValue = values.reduce((max, value) => value > max ? value : max, values[0]);
  const spread = maxValue - minValue;
  const pad = spread > 0n ? spread / 5n : maxValue / 2000n + 1_000_000n;
  const minYValue = minValue - pad;
  const maxYValue = maxValue + pad;
  const valueRange = maxYValue - minYValue || 1n;
  const minTs = Math.min(...usablePoints.map((point) => point.ts));
  const maxTs = Math.max(...usablePoints.map((point) => point.ts), minTs + 1);
  const chartTop = 14;
  const chartHeight = 204;
  const chartPoints: ChartPoint[] = usablePoints.map((point) => {
    const x = ((point.ts - minTs) / Math.max(maxTs - minTs, 1)) * 1000;
    const value = BigInt(point.price);
    const y = chartTop + (1 - Number(value - minYValue) / Number(valueRange)) * chartHeight;
    return { ...point, x, y };
  });
  const linePath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const targetY = openPrice
    ? chartTop + (1 - Number(BigInt(openPrice) - minYValue) / Number(valueRange)) * chartHeight
    : null;

  return {
    linePath,
    firstX: chartPoints[0]?.x ?? 0,
    lastX: chartPoints.at(-1)?.x ?? 1000,
    lastPoint: chartPoints.at(-1) ?? null,
    targetY,
    gridLines: [0, 1, 2, 3, 4].map((index) => {
      const value = maxYValue - ((maxYValue - minYValue) * BigInt(index)) / 4n;
      return {
        y: chartTop + (chartHeight * index) / 4,
        label: formatUsdPrice(value)
      };
    }),
    timeLabels: [0, 1, 2, 3, 4].map((index) => {
      const ts = minTs + Math.round(((maxTs - minTs) * index) / 4);
      return {
        x: (1000 * index) / 4,
        text: formatEtChartTime(ts),
        anchor: index === 0 ? 'start' as const : index === 4 ? 'end' as const : 'middle' as const
      };
    })
  };
}

function priceDelta(openPrice: string | null, displayPrice: string | null) {
  if (!openPrice || !displayPrice) {
    return null;
  }

  const diff = BigInt(displayPrice) - BigInt(openPrice);
  const positive = diff >= 0n;
  return {
    positive,
    amount: (positive ? diff : -diff).toString(),
    value: formatUsdPrice(positive ? diff : -diff)
  };
}
