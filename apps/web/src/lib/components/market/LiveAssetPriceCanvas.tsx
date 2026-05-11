'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MarketPricePoint } from '@/lib/api/types';
import type { LivePriceStore } from '@/lib/api/livePriceStore';
import { formatEtChartTime } from '@/lib/markets/time';
import { formatUsdPrice } from '@/lib/utils/amount';

const MAX_BUFFER_POINTS = 1200;
const CHART_RIGHT_GUTTER = 120;
const CHART_TOP = 14;
const CHART_BOTTOM = 42;
const TARGET_PILL_WIDTH = 84;
const TARGET_PILL_HEIGHT = 28;

export type PriceDomain = {
  min: bigint;
  max: bigint;
};

type DrawModel = {
  width: number;
  height: number;
  points: MarketPricePoint[];
  openPrice: string | null;
  startAt: number;
  endAt: number;
  domain: PriceDomain;
};

export default function LiveAssetPriceCanvas({
  symbol,
  startAt,
  endAt,
  openPrice,
  points,
  livePriceStore
}: {
  symbol: string | null | undefined;
  startAt: number;
  endAt: number;
  openPrice: string | null;
  points: MarketPricePoint[];
  livePriceStore?: LivePriceStore | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<MarketPricePoint[]>([]);
  const domainRef = useRef<PriceDomain>(buildPriceDomain([], openPrice));
  const sizeRef = useRef({ width: 0, height: 0 });
  const frameRef = useRef<number | null>(null);
  const pointsKey = buildPointsKey(points);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const { width, height } = sizeRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    drawAssetPriceCanvas(context, {
      width,
      height,
      points: pointsRef.current,
      openPrice,
      startAt,
      endAt,
      domain: domainRef.current
    });
  }, [endAt, openPrice, startAt]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const sortedPoints = [...points].sort((a, b) => a.ts - b.ts).slice(-MAX_BUFFER_POINTS);
    pointsRef.current = sortedPoints.length > 0 ? sortedPoints : openPrice ? [{ ts: startAt, price: openPrice }] : [];
    domainRef.current = buildPriceDomain(pointsRef.current, openPrice);
    scheduleDraw();
  }, [openPrice, pointsKey, scheduleDraw, startAt, symbol]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width), 1);
      const height = Math.max(Math.floor(rect.height), 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const context = canvas.getContext('2d');
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height };
      scheduleDraw();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  useEffect(() => {
    if (!livePriceStore || !symbol) return;

    return livePriceStore.subscribe((update) => {
      if (update.symbol !== symbol || update.ts < startAt || update.ts > endAt) {
        return;
      }

      const point = {
        ts: Math.min(Math.max(update.ts, startAt), endAt),
        price: update.currentPrice
      };
      const nextPoints = appendPricePoint(pointsRef.current, point);
      if (nextPoints === pointsRef.current) return;
      pointsRef.current = nextPoints;
      domainRef.current = expandDomainForPrice(domainRef.current, point.price);
      scheduleDraw();
    });
  }, [endAt, livePriceStore, scheduleDraw, startAt, symbol]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="asset-price-canvas"
      className="h-full min-h-[240px] w-full sm:min-h-[280px]"
      role="img"
      aria-label={`${symbol ?? 'Asset'} live price line`}
    />
  );
}

function buildPointsKey(points: MarketPricePoint[]) {
  const first = points[0];
  const last = points.at(-1);
  return `${points.length}:${first?.ts ?? ''}:${first?.price ?? ''}:${last?.ts ?? ''}:${last?.price ?? ''}`;
}

export function appendPricePoint(points: MarketPricePoint[], point: MarketPricePoint, maxPoints = MAX_BUFFER_POINTS) {
  const last = points.at(-1);
  if (last && point.ts <= last.ts) {
    return points;
  }
  return [...points, point].slice(-maxPoints);
}

export function downsamplePricePoints(points: MarketPricePoint[], width: number) {
  const maxPoints = Math.max(120, Math.floor(width));
  if (points.length <= maxPoints) {
    return points;
  }
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index * (points.length - 1)) / Math.max(maxPoints - 1, 1));
    return points[sourceIndex];
  });
}

export function buildPriceDomain(points: MarketPricePoint[], openPrice: string | null): PriceDomain {
  const values = [
    ...points.map((point) => BigInt(point.price)),
    ...(openPrice ? [BigInt(openPrice)] : [])
  ];
  const fallback = openPrice ? BigInt(openPrice) : 0n;
  const minValue = values.reduce((min, value) => value < min ? value : min, values[0] ?? fallback);
  const maxValue = values.reduce((max, value) => value > max ? value : max, values[0] ?? fallback);
  return padDomain(minValue, maxValue);
}

export function expandDomainForPrice(domain: PriceDomain, price: string): PriceDomain {
  const value = BigInt(price);
  if (value >= domain.min && value <= domain.max) {
    return domain;
  }
  return padDomain(value < domain.min ? value : domain.min, value > domain.max ? value : domain.max);
}

export function drawAssetPriceCanvas(context: CanvasRenderingContext2D, model: DrawModel) {
  const { width, height, openPrice, startAt, endAt, domain } = model;
  const chartWidth = Math.max(width - CHART_RIGHT_GUTTER, 1);
  const chartHeight = Math.max(height - CHART_TOP - CHART_BOTTOM, 1);
  const points = downsamplePricePoints(model.points, chartWidth);
  const lastPoint = points.at(-1) ?? null;
  const minTs = startAt;
  const maxTs = Math.max(Math.min(lastPoint?.ts ?? startAt + 1, endAt), startAt + 1);

  context.clearRect(0, 0, width, height);
  context.save();
  context.font = '13px var(--font-mono)';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  drawGrid(context, width, chartWidth, chartHeight, domain);

  const targetY = openPrice ? priceToY(openPrice, domain, chartHeight) : null;
  if (targetY !== null) {
    drawTarget(context, chartWidth, targetY);
  }

  if (points.length > 0) {
    const mapped = points.map((point) => ({
      x: ((point.ts - minTs) / Math.max(maxTs - minTs, 1)) * chartWidth,
      y: priceToY(point.price, domain, chartHeight)
    }));
    drawFill(context, mapped, chartHeight);
    drawLine(context, mapped);
    const dot = mapped.at(-1);
    if (dot) {
      context.fillStyle = '#f59e0b';
      context.beginPath();
      context.arc(dot.x, dot.y, 5.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  drawTimeLabels(context, chartWidth, height, minTs, maxTs);
  context.restore();
}

function padDomain(minValue: bigint, maxValue: bigint): PriceDomain {
  const spread = maxValue - minValue;
  const pad = spread > 0n ? spread / 5n : maxValue / 2000n + 1_000_000n;
  return {
    min: minValue - pad,
    max: maxValue + pad
  };
}

function priceToY(price: string, domain: PriceDomain, chartHeight: number) {
  const value = BigInt(price);
  const range = domain.max - domain.min || 1n;
  return CHART_TOP + (1 - Number(value - domain.min) / Number(range)) * chartHeight;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, chartWidth: number, chartHeight: number, domain: PriceDomain) {
  context.strokeStyle = 'rgba(148,163,184,0.12)';
  context.fillStyle = '#94a3b8';
  context.textAlign = 'left';
  context.textBaseline = 'middle';

  for (let index = 0; index < 5; index += 1) {
    const y = CHART_TOP + (chartHeight * index) / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(chartWidth, y);
    context.stroke();
    const value = domain.max - ((domain.max - domain.min) * BigInt(index)) / 4n;
    context.fillText(formatUsdPrice(value), chartWidth + 14, y + 1);
  }

  context.strokeStyle = 'rgba(148,163,184,0.24)';
  context.beginPath();
  context.moveTo(0, CHART_TOP + chartHeight);
  context.lineTo(width - CHART_RIGHT_GUTTER, CHART_TOP + chartHeight);
  context.stroke();
}

function drawTarget(context: CanvasRenderingContext2D, chartWidth: number, targetY: number) {
  context.save();
  context.strokeStyle = 'rgba(245,158,11,0.70)';
  context.lineWidth = 2;
  context.setLineDash([7, 9]);
  context.beginPath();
  context.moveTo(0, targetY);
  context.lineTo(chartWidth, targetY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = '#64748b';
  roundRect(context, chartWidth - 16, targetY - TARGET_PILL_HEIGHT / 2, TARGET_PILL_WIDTH, TARGET_PILL_HEIGHT, TARGET_PILL_HEIGHT / 2);
  context.fill();
  context.fillStyle = '#f8fafc';
  context.font = '700 14px var(--font-sans)';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Target', chartWidth - 16 + TARGET_PILL_WIDTH / 2, targetY + 1);
  context.restore();
}

function drawFill(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, chartHeight: number) {
  const bottom = CHART_TOP + chartHeight;
  const gradient = context.createLinearGradient(0, CHART_TOP, 0, bottom);
  gradient.addColorStop(0, 'rgba(245,158,11,0.12)');
  gradient.addColorStop(1, 'rgba(245,158,11,0.00)');
  context.fillStyle = gradient;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  const last = points.at(-1)!;
  const first = points[0]!;
  context.lineTo(last.x, bottom);
  context.lineTo(first.x, bottom);
  context.closePath();
  context.fill();
}

function drawLine(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  context.strokeStyle = '#f59e0b';
  context.lineWidth = 4;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.stroke();
}

function drawTimeLabels(context: CanvasRenderingContext2D, chartWidth: number, height: number, minTs: number, maxTs: number) {
  context.fillStyle = '#94a3b8';
  context.font = '14px var(--font-mono)';
  context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) {
    const x = (chartWidth * index) / 4;
    const ts = minTs + Math.round(((maxTs - minTs) * index) / 4);
    context.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
    context.fillText(formatEtChartTime(ts), x, height - 12);
  }
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}
