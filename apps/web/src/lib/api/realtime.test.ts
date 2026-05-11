import { describe, expect, it } from 'vitest';
import { evaluateMarketDelta } from './realtime';

describe('market realtime sequence rules', () => {
  const base = {
    market_id: '1',
    canvas_version: 12,
    type: 'canvas_updated' as const,
    payload: {}
  };

  it('ignores duplicate deltas', () => {
    expect(evaluateMarketDelta({ message: { ...base, sequence: 10 }, marketId: '1', lastSequence: 10 })).toMatchObject({
      action: 'ignore'
    });
  });

  it('requests a full refetch on sequence gaps', () => {
    expect(evaluateMarketDelta({ message: { ...base, sequence: 12 }, marketId: '1', lastSequence: 10 })).toMatchObject({
      action: 'refetch',
      reason: 'sequence_gap'
    });
  });

  it('requests a full refetch on invalid payload shape', () => {
    expect(evaluateMarketDelta({ message: { ...base, type: 'unknown', sequence: 11 }, marketId: '1', lastSequence: 10 })).toMatchObject({
      action: 'refetch',
      reason: 'invalid'
    });
  });
});
