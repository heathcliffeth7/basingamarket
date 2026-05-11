import { describe, expect, it } from 'vitest';
import { mockCurves } from '@/lib/api/mock';
import type { MarketPriceSeries } from '@/lib/api/types';
import { curveForSelectedRound, priceSeriesForSelectedRound, roundIdForStartAt } from './roundDataGuards';

describe('round data guards', () => {
  it('derives route round ids from selected start timestamps', () => {
    expect(roundIdForStartAt(1_778_413_500, 300)).toBe('5928045');
    expect(roundIdForStartAt(1_778_413_740, 60)).toBe('29640229');
    expect(roundIdForStartAt(undefined, 300)).toBeNull();
  });

  it('keeps only price series for the selected start timestamp', () => {
    const series: MarketPriceSeries = {
      symbol: 'BTCUSDT',
      start_at: 1_778_413_500,
      end_at: 1_778_413_800,
      duration_seconds: 300,
      status: 'closed',
      open_price: '80000000000',
      current_price: null,
      close_price: '80100000000',
      points: []
    };

    expect(priceSeriesForSelectedRound(series, 1_778_413_500)).toBe(series);
    expect(priceSeriesForSelectedRound(series, 1_778_413_800)).toBeNull();
  });

  it('keeps only curves whose round id matches the selected start timestamp', () => {
    const selectedStartAt = 1_700_000_100;
    const matchingCurve = {
      ...mockCurves['1'],
      round_id: roundIdForStartAt(selectedStartAt, 300)!
    };

    expect(curveForSelectedRound(matchingCurve, selectedStartAt, 300)).toBe(matchingCurve);
    expect(curveForSelectedRound(mockCurves['1'], 1_778_413_500, 300)).toBeNull();
  });
});
