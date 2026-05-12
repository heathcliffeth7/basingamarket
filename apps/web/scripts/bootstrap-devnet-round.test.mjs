import { describe, expect, it } from 'vitest';
import {
  anchorDiscriminator,
  assertBinanceOpenTime,
  createMarketConfigData,
  defaultMarketId,
  deriveDevnetPdas,
  fixedBytes,
  initializeGlobalConfigData,
  intervalForDuration,
  openRoundData,
  parseArgs,
  parseDecimalToScaledAmount,
  selectRoundWindow,
  symbolForAsset
} from './bootstrap-devnet-round.mjs';

const PROGRAM_ID = '3oAve8qsR5oVtqUcsXtSELBVz5CnJifj4UCvM6AiHa2r';
const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('bootstrap-devnet-round script helpers', () => {
  it('parses default BTC 5m bootstrap options', () => {
    expect(parseArgs([])).toMatchObject({
      asset: 'BTC',
      durationSeconds: 300,
      marketId: 1,
      minRemainingSeconds: 60,
      openingBatchSeconds: 5,
      wait: true
    });
    expect(parseArgs(['--program-id', PROGRAM_ID, '--no-wait'])).toMatchObject({
      programId: PROGRAM_ID,
      wait: false
    });
  });

  it('parses ETH 1m bootstrap options and derives default market id', () => {
    expect(parseArgs(['--asset', 'ETH', '--duration', '60', '--no-wait'])).toMatchObject({
      asset: 'ETH',
      durationSeconds: 60,
      marketId: 12,
      wait: false
    });
    expect(defaultMarketId('SOL', 60)).toBe(13);
    expect(symbolForAsset('ETH')).toBe('ETHUSDT');
    expect(intervalForDuration(60)).toBe('1m');
  });

  it('selects the next round when the current round has less than the minimum remaining time', () => {
    expect(selectRoundWindow({
      nowTs: 1_778_494_745,
      durationSeconds: 300,
      minRemainingSeconds: 60
    })).toMatchObject({
      roundId: 5_928_316,
      startAt: 1_778_494_800,
      endAt: 1_778_495_100,
      waitSeconds: 55
    });
    expect(selectRoundWindow({
      nowTs: 1_778_494_700,
      durationSeconds: 300,
      minRemainingSeconds: 60
    })).toMatchObject({
      roundId: 5_928_315,
      waitSeconds: 0
    });
  });

  it('derives stable devnet PDAs matching the program seeds', async () => {
    await expect(deriveDevnetPdas(PROGRAM_ID, 1, 5_928_316)).resolves.toMatchObject({
      global: '5k2zQuYhuk6UvJDkw142Nz9AiAgoSjkFdGbhdUu5KEK1',
      market: '5xNWrfYTiKo8t4PRqioUHw9Qbg86rUX4253u7qqKzmVv',
      round: '7P2pUYsMRLZYw3tThZujmL8t72vGKx8UJP7LwR2F6kgn'
    });
  });

  it('encodes Anchor instruction discriminators and args deterministically', () => {
    expect(Buffer.from(anchorDiscriminator('buy_fresh')).toString('hex')).toBe('6505ce55370b768a');
    expect(initializeGlobalConfigData({
      protocolTreasury: SOLANA_DEVNET_PUBKEY,
      usdcMint: SOLANA_DEVNET_PUBKEY,
      trustedSettlementActor: SOLANA_DEVNET_PUBKEY,
      buyFeeBps: 50,
      resaleFeeBps: 50,
      settlementFeeBps: 0,
      minSideRealUsdc: 10_000_000n
    })).toHaveLength(118);
    expect(createMarketConfigData({
      asset: 'BTC',
      marketId: 1,
      durationSeconds: 300,
      symbol: 'BTCUSDT',
      interval: '5m',
      virtualUsdc: 50_000_000_000n,
      virtualTicket: 100_000_000_000n,
      openingBatchSeconds: 5,
      openingWalletSideCapUsdc: 500_000_000n
    })).toHaveLength(75);
    expect(openRoundData({
      roundId: 5_928_316,
      startAt: 1_778_494_800,
      batchUntil: 1_778_494_805,
      endAt: 1_778_495_100,
      startPrice: 103_456_123_456n,
      symbol: 'BTCUSDT',
      interval: '5m',
      binanceOpenTimeMs: 1_778_494_800_000
    })).toHaveLength(80);
  });

  it('encodes ETH 1m market and round settlement metadata', () => {
    const marketConfig = createMarketConfigData({
      asset: 'ETH',
      marketId: 12,
      durationSeconds: 60,
      symbol: 'ETHUSDT',
      interval: '1m',
      virtualUsdc: 50_000_000_000n,
      virtualTicket: 100_000_000_000n,
      openingBatchSeconds: 5,
      openingWalletSideCapUsdc: 500_000_000n
    });
    const round = openRoundData({
      roundId: 29_641_580,
      startAt: 1_778_494_800,
      batchUntil: 1_778_494_805,
      endAt: 1_778_494_860,
      startPrice: 3_456_123_456n,
      symbol: 'ETHUSDT',
      interval: '1m',
      binanceOpenTimeMs: 1_778_494_800_000
    });

    expect(Buffer.from(marketConfig).toString('utf8')).toContain('ETHUSDT');
    expect(Buffer.from(marketConfig).toString('utf8')).toContain('1m');
    expect(Buffer.from(round).toString('utf8')).toContain('ETHUSDT');
    expect(Buffer.from(round).toString('utf8')).toContain('1m');
  });

  it('validates fixed Binance symbol bytes and kline open time', () => {
    expect(Buffer.from(fixedBytes('BTCUSDT', 16)).toString('utf8').replace(/\0+$/, '')).toBe('BTCUSDT');
    expect(parseDecimalToScaledAmount('103456.12345678')).toBe('103456123456');
    expect(() => assertBinanceOpenTime({ openTimeMs: 1_778_494_800_000 }, 1_778_494_800)).not.toThrow();
    expect(() => assertBinanceOpenTime({ openTimeMs: 1_778_494_799_000 }, 1_778_494_800)).toThrow(/open time mismatch/);
  });
});
