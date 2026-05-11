import { describe, expect, it } from 'vitest';
import {
  buildLiveRoundBootstrapTasks,
  formatKeeperError,
  marketsUrlForApiBaseUrl,
  parseKeeperArgs,
  runKeeperCycle
} from './devnet-live-round-keeper.mjs';

function market({ asset, durationSeconds, marketId, roundId }) {
  const startAt = Number(roundId) * durationSeconds;
  return {
    market_id: String(marketId),
    price_header: {
      asset,
      duration_seconds: durationSeconds,
      end_at: startAt + durationSeconds,
      price_display_state: 'live',
      round_id: String(roundId),
      start_at: startAt
    }
  };
}

const liveMarkets = [
  market({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 }),
  market({ asset: 'ETH', durationSeconds: 300, marketId: 2, roundId: 5_928_387 }),
  market({ asset: 'SOL', durationSeconds: 300, marketId: 3, roundId: 5_928_387 }),
  market({ asset: 'BTC', durationSeconds: 60, marketId: 11, roundId: 29_641_935 }),
  market({ asset: 'ETH', durationSeconds: 60, marketId: 12, roundId: 29_641_935 }),
  market({ asset: 'SOL', durationSeconds: 60, marketId: 13, roundId: 29_641_935 }),
  market({ asset: 'BTC', durationSeconds: 900, marketId: 4, roundId: 1_976_129 })
];

describe('devnet-live-round-keeper helpers', () => {
  it('parses once/watch options and builds the markets URL', () => {
    expect(parseKeeperArgs(['--watch', '--api-base-url', 'http://api.internal:9000/'])).toMatchObject({
      apiBaseUrl: 'http://api.internal:9000',
      lookaheadSeconds: 15,
      mode: 'watch',
      wait: true
    });
    expect(parseKeeperArgs(['--once', '--no-wait'])).toMatchObject({
      mode: 'once',
      wait: false
    });
    expect(marketsUrlForApiBaseUrl('http://api.internal:9000/')).toBe('http://api.internal:9000/markets');
  });

  it('creates one bootstrap task for each BTC/ETH/SOL 1m and 5m live market', () => {
    expect(buildLiveRoundBootstrapTasks(liveMarkets, { nowTs: 0 })).toEqual([
      expect.objectContaining({ asset: 'BTC', durationSeconds: 300, interval: '5m', marketId: 1, roundId: 5_928_387 }),
      expect.objectContaining({ asset: 'ETH', durationSeconds: 300, interval: '5m', marketId: 2, roundId: 5_928_387 }),
      expect.objectContaining({ asset: 'SOL', durationSeconds: 300, interval: '5m', marketId: 3, roundId: 5_928_387 }),
      expect.objectContaining({ asset: 'BTC', durationSeconds: 60, interval: '1m', marketId: 11, roundId: 29_641_935 }),
      expect.objectContaining({ asset: 'ETH', durationSeconds: 60, interval: '1m', marketId: 12, roundId: 29_641_935 }),
      expect.objectContaining({ asset: 'SOL', durationSeconds: 60, interval: '1m', marketId: 13, roundId: 29_641_935 })
    ]);
  });

  it('adds next-round lookahead tasks near the current round boundary', () => {
    const [task, nextTask] = buildLiveRoundBootstrapTasks([
      market({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 })
    ], {
      lookaheadSeconds: 15,
      nowTs: 5_928_387 * 300 + 291
    });

    expect(task).toMatchObject({ lookahead: false, roundId: 5_928_387 });
    expect(nextTask).toMatchObject({
      lookahead: true,
      roundId: 5_928_388,
      startAt: 5_928_388 * 300
    });
  });

  it('bootstraps each round once and picks up new watch rounds', async () => {
    const calls = [];
    const state = new Set();
    const options = parseKeeperArgs(['--once', '--no-wait']);
    const bootstrapDevnetRound = async (input) => {
      calls.push(input);
      return { sent: [], ...input };
    };
    const log = () => {};
    const firstTasks = buildLiveRoundBootstrapTasks(liveMarkets.slice(0, 2), { nowTs: 0 });
    const nextTasks = buildLiveRoundBootstrapTasks([
      market({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_388 }),
      liveMarkets[1]
    ], { nowTs: 0 });

    await runKeeperCycle(options, state, { bootstrapDevnetRound, log, tasks: firstTasks });
    await runKeeperCycle(options, state, { bootstrapDevnetRound, log, tasks: firstTasks });
    await runKeeperCycle(options, state, { bootstrapDevnetRound, log, tasks: nextTasks });

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => [call.asset, call.durationSeconds, call.marketId, call.roundId])).toEqual([
      ['BTC', 300, 1, 5_928_387],
      ['ETH', 300, 2, 5_928_387],
      ['BTC', 300, 1, 5_928_388]
    ]);
  });

  it('formats nested fetch causes in keeper logs', () => {
    const error = new Error('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
        code: 'ECONNREFUSED'
      })
    });

    expect(formatKeeperError(error)).toContain('fetch failed');
    expect(formatKeeperError(error)).toContain('ECONNREFUSED');
  });
});
