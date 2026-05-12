import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mockRoundHistories } from '@/lib/api/mock';
import RoundTimeRail from './RoundTimeRail';

describe('RoundTimeRail', () => {
  it('marks the live round with a Polymarket-style pinging tone dot', () => {
    const history = mockRoundHistories['1'];
    const liveStartAt = history.rounds.at(-1)!.start_at;
    const html = renderToStaticMarkup(
      <RoundTimeRail
        history={history}
        selectedStartAt={liveStartAt}
        liveStartAt={liveStartAt}
        liveTone="up"
        roundHref={(round) => `/markets/btc-updown-5m-${round.start_at}`}
      />
    );

    expect(html).toContain('data-testid="live-round-dot"');
    expect(html).toContain('data-testid="live-round-dot-ping"');
    expect(html).toContain('data-tone="up"');
    expect(html).toContain('bg-market-success');
    expect(html).toContain('animate-ping');
    expect(html).not.toContain('animate-pulse');
    expect(html).toContain(`/markets/btc-updown-5m-${liveStartAt}`);
  });

  it('builds live and previous links from the actual live start timestamp', () => {
    const history = mockRoundHistories['1'];
    const liveStartAt = 1_778_414_700;
    const html = renderToStaticMarkup(
      <RoundTimeRail
        history={history}
        selectedStartAt={liveStartAt - history.duration_seconds}
        liveStartAt={liveStartAt}
        roundHref={(round) => `/markets/btc-updown-5m-${round.start_at}`}
      />
    );

    expect(html).toContain('/markets/btc-updown-5m-1778414700');
    expect(html).toContain('/markets/btc-updown-5m-1778414400');
  });

  it('adds a selected historical chip when the viewed slug is outside recent history', () => {
    const html = renderToStaticMarkup(
      <RoundTimeRail
        history={mockRoundHistories['1']}
        selectedStartAt={1_778_413_500}
        liveStartAt={1_778_414_700}
        roundHref={(round) => `/markets/btc-updown-5m-${round.start_at}`}
      />
    );

    expect(html).toContain('Ended:');
    expect(html).toContain('/markets/btc-updown-5m-1778413500');
  });
});
