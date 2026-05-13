'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import { Check, ChevronDown, ChevronRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { Market, MarketCurve, MarketPricePoint, MarketPriceSeries } from '@/lib/api/types';
import type { LivePriceStore } from '@/lib/api/livePriceStore';
import type { LiveTickerUpdate } from '@/lib/api/livePrices';
import { derivePriceLead, type PriceLead, type PriceLeadTone } from '@/lib/markets/priceLead';
import { priceSeriesForSelectedRound } from '@/lib/markets/roundDataGuards';
import { liveMarketRoundHref } from '@/lib/markets/routes';
import { formatEtChartTime, formatEtRoundWindow } from '@/lib/markets/time';
import { formatUsdPrice, scaledUsdToNumber } from '@/lib/utils/amount';
import { Liveline } from 'liveline';
import type { LivelinePoint } from 'liveline';
import LivePingDot from './LivePingDot';

const PRICE_NUMBER_FORMAT = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
} satisfies Intl.NumberFormatOptions;

const PRICE_FLOW_TIMING = { duration: 160, easing: 'ease-out' } satisfies EffectTiming;
const PRICE_FLOW_SPIN_TIMING = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' } satisfies EffectTiming;
const PRICE_FLOW_OPACITY_TIMING = { duration: 120, easing: 'ease-out' } satisfies EffectTiming;
const PRICE_READOUT_FLUSH_INTERVAL_MS = 250;
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
  const priceLead = useMemo(() => derivePriceLead(model.openPrice, model.displayPrice), [model.displayPrice, model.openPrice]);
  const chartData = useMemo(() => buildLivelineData(model.points), [model.points]);
  const latestValue = useMemo(() => scaledUsdToNumber(model.displayPrice) ?? 0, [model.displayPrice]);
  const openPriceNum = useMemo(() => scaledUsdToNumber(model.openPrice), [model.openPrice]);
  const chartColor = useMemo(() => priceLeadColor(priceLead.tone), [priceLead.tone]);
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
            priceLeadTone={priceLead.tone}
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
              tone={priceLead.tone}
              lead={priceLead}
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
              <LivePingDot testId="go-live-market-dot" tone={priceLead.tone} />
              Go to live market
              <ChevronRight size={18} />
            </a>
          )}
        </div>

        <div data-testid="asset-price-chart" className="relative mt-4 h-[300px] sm:h-[360px]" aria-label="Underlying asset price chart">
          <Liveline
            data={chartData}
            value={latestValue}
            color={chartColor}
            window={Math.max(60, durationSeconds)}
            theme="dark"
            grid
            fill
            pulse
            lineWidth={2.5}
            padding={{ top: 6, right: 70, bottom: 38, left: 8 }}
            referenceLine={openPriceNum !== null ? { value: openPriceNum, label: 'Target' } : undefined}
            formatValue={(v) => formatUsdPriceNumber(v)}
            formatTime={(t) => formatEtChartTime(Math.floor(t))}
            badge={false}
            scrub={false}
            momentum={false}
          />
        </div>
      </div>
    </section>
  );
}

function MarketSwitcher({
  currentAsset,
  currentDurationSeconds,
  priceLeadTone,
  markets,
  curves,
  nowMs
}: {
  currentAsset: string;
  currentDurationSeconds: number;
  priceLeadTone: PriceLeadTone;
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
        <span data-tone={priceLeadTone} className={`h-2.5 w-2.5 rounded-full ${priceLeadBgClass(priceLeadTone)}`} />
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
  tone = 'neutral',
  lead = null
}: {
  label: string;
  value: string | null;
  muted?: boolean;
  tone?: PriceLeadTone;
  lead?: PriceLead | null;
}) {
  const textClass = muted ? 'text-terminal-muted' : priceLeadTextClass(tone);
  return (
    <div className="min-w-[150px]">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-black ${muted ? 'text-terminal-muted' : textClass}`}>{label}</p>
        {lead?.available ? (
          <span className={`inline-flex items-center gap-1 text-xs font-black ${priceLeadTextClass(lead.tone)}`}>
            <PriceLeadIcon tone={lead.tone} />
            {lead.value}
          </span>
        ) : null}
      </div>
      <p className={`mt-1 font-mono text-2xl font-black leading-none sm:text-3xl ${textClass}`}>
        {formatUsdPrice(value)}
      </p>
    </div>
  );
}

function AnimatedPriceReadout({
  label,
  value,
  tone,
  lead,
  animate = false
}: {
  label: string;
  value: string | null;
  tone: PriceLeadTone;
  lead: PriceLead;
  animate?: boolean;
}) {
  const direction = usePriceDirection(value, animate, tone === 'down' ? 'down' : 'up');
  const priceNumber = scaledUsdToNumber(value);
  const deltaNumber = scaledUsdToNumber(lead.amount);
  const textClass = priceLeadTextClass(tone);

  return (
    <div className="min-w-[150px]" data-testid="animated-price-readout" data-price-lead={tone} data-price-direction={direction}>
      <div className="flex items-center gap-2">
        <p className={`text-sm font-black ${textClass}`}>{label}</p>
        {lead.available ? (
          <span className={`price-delta-flow inline-flex items-center gap-1 text-xs font-black ${priceLeadTextClass(lead.tone)}`}>
            <PriceLeadIcon tone={lead.tone} />
            {deltaNumber === null ? (
              <span>{lead.value}</span>
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
        <p className={`mt-1 font-mono text-2xl font-black leading-none sm:text-3xl ${textClass}`}>
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

function PriceLeadIcon({ tone }: { tone: PriceLeadTone }) {
  if (tone === 'up') return <TrendingUp size={14} aria-hidden="true" />;
  if (tone === 'down') return <TrendingDown size={14} aria-hidden="true" />;
  return <Minus size={14} aria-hidden="true" />;
}

function priceLeadTextClass(tone: PriceLeadTone) {
  if (tone === 'up') return 'text-market-success';
  if (tone === 'down') return 'text-market-negative';
  return 'text-market-warning';
}

function priceLeadBgClass(tone: PriceLeadTone) {
  if (tone === 'up') return 'bg-market-success';
  if (tone === 'down') return 'bg-market-negative';
  return 'bg-market-warning';
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
    ? normalizeInitialLivePoints(series?.points ?? [], startAt, openPrice)
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
      const waitMs = Math.max(PRICE_READOUT_FLUSH_INTERVAL_MS - (now - lastFlushRef.current), 0);
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
  openPrice: string | null
) {
  if (points.length > 0) {
    return points;
  }

  return openPrice ? [{ ts: startAt, price: openPrice }] : [];
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

function priceLeadColor(tone: PriceLeadTone): string {
  switch (tone) {
    case 'up': return '#10b981';
    case 'down': return '#ef4444';
    case 'neutral': return '#f59e0b';
  }
}

function formatUsdPriceNumber(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function buildLivelineData(points: MarketPricePoint[]): LivelinePoint[] {
  return points
    .filter((p) => scaledUsdToNumber(p.price) !== null)
    .map((p) => ({
      time: p.ts,
      value: scaledUsdToNumber(p.price)!
    }));
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
