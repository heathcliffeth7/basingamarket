import { describe, expect, it } from 'vitest';
import {
  bootstrapRequestsUrlForApiBaseUrl,
  bootstrapRequestUrlForTask,
  buildRequestedRoundBootstrapTasks,
  buildLiveRoundBootstrapTasks,
  fetchRoundBootstrapTasks,
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

function bootstrapRequest({ asset = 'BTC', durationSeconds = 300, marketId = 1, roundId = 5_928_387 }) {
  const startAt = Number(roundId) * durationSeconds;
  return {
    asset,
    duration_seconds: durationSeconds,
    end_at: startAt + durationSeconds,
    market_id: String(marketId),
    round_id: String(roundId),
    start_at: startAt
  };
}

describe('devnet-live-round-keeper helpers', () => {
  it('parses once/watch options and builds API URLs', () => {
    expect(parseKeeperArgs(['--watch', '--api-base-url', 'http://api.internal:9000/'])).toMatchObject({
      apiBaseUrl: 'http://api.internal:9000',
      eager: false,
      lookaheadSeconds: 15,
      mode: 'watch',
      wait: true
    });
    expect(parseKeeperArgs(['--watch', '--eager'])).toMatchObject({
      eager: true,
      mode: 'watch'
    });
    expect(parseKeeperArgs(['--once', '--no-wait'])).toMatchObject({
      mode: 'once',
      wait: false
    });
    expect(marketsUrlForApiBaseUrl('http://api.internal:9000/')).toBe('http://api.internal:9000/markets');
    expect(bootstrapRequestsUrlForApiBaseUrl('http://api.internal:9000/')).toBe('http://api.internal:9000/_devnet/round-bootstrap-requests');
    expect(bootstrapRequestUrlForTask({ marketId: 1, roundId: 5_928_387 }, 'http://api.internal:9000/')).toBe('http://api.internal:9000/_devnet/round-bootstrap-requests/1/5928387');
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

  it('creates bootstrap tasks from on-demand API requests', () => {
    expect(buildRequestedRoundBootstrapTasks([
      bootstrapRequest({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 }),
      bootstrapRequest({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 }),
      bootstrapRequest({ asset: 'DOGE', durationSeconds: 300, marketId: 99, roundId: 5_928_387 })
    ])).toEqual([
      expect.objectContaining({
        asset: 'BTC',
        durationSeconds: 300,
        interval: '5m',
        marketId: 1,
        requested: true,
        roundId: 5_928_387
      })
    ]);
  });

  it('uses on-demand requests by default and live markets only in eager mode', async () => {
    const requestedCalls = [];
    const requestedTasks = await fetchRoundBootstrapTasks(parseKeeperArgs(['--once']), {
      fetchImpl: async (url) => {
        requestedCalls.push(url);
        return new Response(JSON.stringify([
          bootstrapRequest({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 })
        ]), { status: 200 });
      }
    });
    expect(requestedCalls).toEqual([bootstrapRequestsUrlForApiBaseUrl()]);
    expect(requestedTasks).toEqual([
      expect.objectContaining({ marketId: 1, requested: true, roundId: 5_928_387 })
    ]);

    const eagerCalls = [];
    const eagerTasks = await fetchRoundBootstrapTasks(parseKeeperArgs(['--once', '--eager']), {
      fetchImpl: async (url) => {
        eagerCalls.push(url);
        return new Response(JSON.stringify(liveMarkets.slice(0, 1)), { status: 200 });
      }
    });
    expect(eagerCalls).toEqual([marketsUrlForApiBaseUrl()]);
    expect(eagerTasks[0]).toEqual(expect.objectContaining({ marketId: 1, roundId: 5_928_387 }));
    expect(eagerTasks[0]).not.toHaveProperty('requested');
  });

  it('bootstraps each round once and picks up new watch rounds', async () => {
    const calls = [];
    const state = new Set();
    const options = parseKeeperArgs(['--once', '--no-wait', '--eager', '--opening-batch-seconds', '7']);
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
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ openingBatchSeconds: 7, wait: false })
    ]));
  });

  it('deletes requested bootstrap tasks after successful bootstrap', async () => {
    const calls = [];
    const deleted = [];
    const options = parseKeeperArgs(['--once', '--opening-batch-seconds', '7']);
    const task = buildRequestedRoundBootstrapTasks([
      bootstrapRequest({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 })
    ])[0];

    await runKeeperCycle(options, new Set(), {
      bootstrapDevnetRound: async (input) => {
        calls.push(input);
        return { sent: [] };
      },
      deleteBootstrapRequest: async ({ task }) => deleted.push([task.marketId, task.roundId]),
      log: () => {},
      tasks: [task]
    });

    expect(calls).toEqual([
      expect.objectContaining({ openingBatchSeconds: 0, wait: false })
    ]);
    expect(deleted).toEqual([[1, 5_928_387]]);
  });

  it('keeps requested bootstrap tasks pending when bootstrap fails', async () => {
    const deleted = [];
    const options = parseKeeperArgs(['--once', '--no-wait']);
    const task = buildRequestedRoundBootstrapTasks([
      bootstrapRequest({ asset: 'BTC', durationSeconds: 300, marketId: 1, roundId: 5_928_387 })
    ])[0];

    await expect(runKeeperCycle(options, new Set(), {
      bootstrapDevnetRound: async () => {
        throw new Error('insufficient lamports');
      },
      deleteBootstrapRequest: async ({ task }) => deleted.push([task.marketId, task.roundId]),
      log: () => {},
      tasks: [task]
    })).rejects.toThrow('insufficient lamports');

    expect(deleted).toEqual([]);
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

  it('includes funding simulation logs in keeper errors', () => {
    const error = Object.assign(new Error('Transaction simulation failed'), {
      context: {
        logs: [
          'Program log: Instruction: OpenRound',
          'Transfer: insufficient lamports 1207302, need 2470800'
        ]
      }
    });

    expect(formatKeeperError(error)).toContain('Transfer: insufficient lamports 1207302, need 2470800');
  });
});
