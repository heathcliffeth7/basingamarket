import { describe, expect, it } from 'vitest';
import { mockCanvas, mockMarkets, mockTickets } from '$lib/api/mock';
import { deriveMarketSignals, deriveSimpleMarketRead, getRenderedCanvasItems } from './signals';

describe('deriveMarketSignals', () => {
  it('marks unavailable inputs as pending projection', () => {
    const signals = deriveMarketSignals({});

    expect(signals.dominantOutcomeLabel).toBeNull();
    expect(signals.capitalConcentrationLabel).toBeNull();
    expect(signals.visualWeightConcentrationLabel).toBeNull();
    expect(signals.lateFlowLabel).toBe('unavailable');
    expect(signals.hasPendingProjection).toBe(true);
  });

  it('uses stake data for capital concentration when stake exists', () => {
    const signals = deriveMarketSignals({ market: mockMarkets[0] });

    expect(signals.dominantOutcomeLabel).toBe('UP');
    expect(signals.capitalConcentrationLabel).toBe('57.9% in UP');
    expect(signals.visualWeightConcentrationLabel).toBeNull();
  });

  it('falls back to visual weight without claiming canonical capital', () => {
    const signals = deriveMarketSignals({ canvas: mockCanvas['1'] });

    expect(signals.capitalConcentrationLabel).toBeNull();
    expect(signals.visualWeightConcentrationLabel).toBe('58.8% in UP');
  });

  it('keeps late flow pending when no movement timestamp exists', () => {
    const canvas = {
      ...mockCanvas['1'],
      nodes: mockCanvas['1'].nodes.map((node) => ({ ...node, last_transfer_at: null }))
    };

    const signals = deriveMarketSignals({ market: mockMarkets[0], canvas, tickets: mockTickets });

    expect(signals.lateFlowLabel).toBe('projection pending');
    expect(signals.hasPendingProjection).toBe(true);
  });
});

describe('deriveSimpleMarketRead', () => {
  it('returns direction, strength, and simple confidence', () => {
    const read = deriveSimpleMarketRead({ market: mockMarkets[0], canvas: mockCanvas['1'], tickets: mockTickets });

    expect(read.dominantOutcomeId).toBe('0');
    expect(read.dominantOutcomeLabel).toBe('UP');
    expect(read.strengthLabel).toBe('57.9% capital');
    expect(read.confidenceLabel).toBe('High');
  });

  it('uses cautious defaults when data is missing', () => {
    const read = deriveSimpleMarketRead({});

    expect(read.dominantOutcomeId).toBeNull();
    expect(read.dominantOutcomeLabel).toBe('Projection pending');
    expect(read.strengthLabel).toBe('projection pending');
    expect(read.confidenceLabel).toBe('Low');
  });
});

describe('getRenderedCanvasItems', () => {
  it('renders at most three tickets per outcome and clusters the rest', () => {
    const canvas = {
      ...mockCanvas['1'],
      nodes: [
        ...mockCanvas['1'].nodes,
        ...Array.from({ length: 5 }, (_, index) => ({
          ...mockCanvas['1'].nodes[0],
          ticket_id: `extra-${index}`,
          radius: 10 + index,
          z_index: 20 + index
        }))
      ]
    };

    const items = getRenderedCanvasItems({ canvas, maxTicketsPerOutcome: 3 });
    const visibleOutcomeZero = items.filter((item) => item.type === 'ticket' && item.node.outcome_id === '0');
    const cluster = items.find((item) => item.type === 'cluster' && item.outcome_id === '0');

    expect(visibleOutcomeZero).toHaveLength(3);
    expect(cluster).toMatchObject({ type: 'cluster', count: 4 });
  });
});
