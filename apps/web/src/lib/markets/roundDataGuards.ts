import type { MarketCurve, MarketPriceSeries } from '@/lib/api/types';

export function roundIdForStartAt(startAt: number | undefined, durationSeconds: number | undefined) {
  if (startAt === undefined || durationSeconds === undefined || durationSeconds <= 0) {
    return null;
  }

  return String(Math.floor(startAt / durationSeconds));
}

export function priceSeriesForSelectedRound(
  series: MarketPriceSeries | null | undefined,
  selectedStartAt: number | undefined
) {
  if (!series) {
    return null;
  }

  if (selectedStartAt !== undefined && series.start_at !== selectedStartAt) {
    return null;
  }

  return series;
}

export function curveForSelectedRound(
  curve: MarketCurve | null | undefined,
  selectedStartAt: number | undefined,
  durationSeconds: number | undefined
) {
  if (!curve) {
    return null;
  }

  const expectedRoundId = roundIdForStartAt(selectedStartAt, durationSeconds);

  if (expectedRoundId !== null && curve.round_id !== expectedRoundId) {
    return null;
  }

  return curve;
}
