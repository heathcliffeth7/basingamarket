import { MarketWsDeltaSchema, type MarketWsDelta } from './types';

export type DeltaDecision =
  | { action: 'ignore'; lastSequence: number; reason: 'duplicate' }
  | { action: 'accept'; lastSequence: number; delta: MarketWsDelta }
  | { action: 'refetch'; lastSequence: number; reason: 'invalid' | 'market_mismatch' | 'sequence_gap' };

export function evaluateMarketDelta(input: {
  message: unknown;
  marketId: string;
  lastSequence: number;
}): DeltaDecision {
  const parsed = MarketWsDeltaSchema.safeParse(input.message);
  if (!parsed.success) {
    return { action: 'refetch', lastSequence: input.lastSequence, reason: 'invalid' };
  }

  const delta = parsed.data;
  if (delta.market_id !== input.marketId) {
    return { action: 'refetch', lastSequence: input.lastSequence, reason: 'market_mismatch' };
  }

  if (delta.sequence <= input.lastSequence) {
    return { action: 'ignore', lastSequence: input.lastSequence, reason: 'duplicate' };
  }

  if (delta.sequence !== input.lastSequence + 1) {
    return { action: 'refetch', lastSequence: input.lastSequence, reason: 'sequence_gap' };
  }

  return { action: 'accept', lastSequence: delta.sequence, delta };
}
