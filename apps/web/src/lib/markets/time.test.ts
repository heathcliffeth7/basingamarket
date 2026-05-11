import { describe, expect, it } from 'vitest';
import { formatEtChartTime, formatEtRoundTime, formatEtRoundWindow } from './time';

describe('market ET time formatting', () => {
  it('formats crypto round labels in America/New_York time', () => {
    expect(formatEtRoundWindow(1_778_413_500, 1_778_413_800)).toBe('May 10, 7:45AM-7:50AM ET');
    expect(formatEtRoundTime(1_778_414_700)).toBe('8:05 AM');
    expect(formatEtChartTime(1_778_413_508.5)).toContain('7:45:08');
  });
});
