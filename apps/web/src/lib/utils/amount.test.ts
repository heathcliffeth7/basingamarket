import { describe, expect, it } from 'vitest';
import { formatOdds, formatTokenAmount, parseTokenAmountToBaseUnits, scaledUsdToNumber } from './amount';

describe('amount formatting', () => {
  it('formats fixed 6-decimal token strings without computing financial state', () => {
    expect(formatTokenAmount('1250000')).toBe('1.25');
    expect(formatTokenAmount('1000000')).toBe('1');
  });

  it('formats backend-provided scaled odds', () => {
    expect(formatOdds('500000')).toBe('50.0%');
  });

  it('parses positive 6-decimal deposit amounts', () => {
    expect(parseTokenAmountToBaseUnits('1')).toBe('1000000');
    expect(parseTokenAmountToBaseUnits('1.25')).toBe('1250000');
    expect(parseTokenAmountToBaseUnits('0.000001')).toBe('1');
    expect(parseTokenAmountToBaseUnits('0')).toBeNull();
    expect(parseTokenAmountToBaseUnits('1.0000001')).toBeNull();
    expect(parseTokenAmountToBaseUnits('-1')).toBeNull();
    expect(parseTokenAmountToBaseUnits('abc')).toBeNull();
  });

  it('converts fixed-scale USD strings for animated number displays', () => {
    expect(scaledUsdToNumber('80921770000')).toBe(80921.77);
    expect(scaledUsdToNumber('-11520000')).toBe(-11.52);
    expect(scaledUsdToNumber(null)).toBeNull();
    expect(scaledUsdToNumber('not-a-number')).toBeNull();
  });
});
