import { describe, expect, it } from 'vitest';
import { derivePriceLead } from './priceLead';

describe('derivePriceLead', () => {
  it('keeps prices within the neutral band yellow', () => {
    expect(derivePriceLead('100000000', '102000000')).toMatchObject({
      tone: 'neutral',
      amount: '2000000',
      value: '$2.00'
    });
    expect(derivePriceLead('100000000', '99000000').tone).toBe('neutral');
    expect(derivePriceLead('100000000', '101000000').tone).toBe('neutral');
  });

  it('marks prices outside the neutral band as up or down', () => {
    expect(derivePriceLead('100000000', '102010000')).toMatchObject({
      tone: 'up',
      value: '$2.01'
    });
    expect(derivePriceLead('100000000', '97990000')).toMatchObject({
      tone: 'down',
      value: '$2.01'
    });
  });

  it('falls back to neutral when prices are unavailable', () => {
    expect(derivePriceLead(null, '102010000')).toMatchObject({ tone: 'neutral', available: false });
    expect(derivePriceLead('100000000', null)).toMatchObject({ tone: 'neutral', available: false });
    expect(derivePriceLead('not-a-price', '102010000')).toMatchObject({ tone: 'neutral', available: false });
  });
});
