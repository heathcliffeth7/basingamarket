import type {
  CashBalance,
  CanvasResponse,
  DepositConfig,
  Market,
  MarketCurve,
  MarketPriceSeries,
  OrderBook,
  Profile,
  RoundHistory,
  ShareCardResponse,
  ShareRenderResponse,
  Ticket
} from './types';

const now = '2026-05-07T00:00:00Z';
const scale = 1_000_000n;
const defaultVirtualUsdc = 50_000n * scale;
const defaultVirtualToken = 100_000n * scale;
export const mockWalletAddress = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const mockTraderAddress = 'So11111111111111111111111111111111111111112';
const mockCallerAddress = '11111111111111111111111111111111';
const mockDownAddress = 'SysvarRent111111111111111111111111111111111';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const mockMarkets: Market[] = [
  {
    market_id: '1',
    market_sequence: 42,
    question_hash: 'BTC 5m Crypto Round',
    price_header: {
      asset: 'BTC',
      asset_image_url: '/visuals/crypto/btc.svg',
      duration_seconds: 300,
      settlement_source: 'Binance Spot BTCUSDT 5m',
      symbol: 'BTCUSDT',
      round_id: '5666667',
      start_at: 1_700_000_100,
      end_at: 1_700_000_400,
      open_price: '35567280000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      {
        outcome_id: 0,
        label: 'UP',
        total_stake: '185000000',
        total_reward_shares: '185000000',
        current_odds: '580000'
      },
      {
        outcome_id: 1,
        label: 'DOWN',
        total_stake: '134000000',
        total_reward_shares: '134000000',
        current_odds: '420000'
      }
    ]
  },
  {
    market_id: '2',
    market_sequence: 38,
    question_hash: 'ETH 5m Crypto Round',
    price_header: {
      asset: 'ETH',
      asset_image_url: '/visuals/crypto/eth.svg',
      duration_seconds: 300,
      settlement_source: 'Binance Spot ETHUSDT 5m',
      symbol: 'ETHUSDT',
      round_id: '5666668',
      start_at: 1_700_000_400,
      end_at: 1_700_000_700,
      open_price: '2030500000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      { outcome_id: 0, label: 'UP', total_stake: '121000000', total_reward_shares: '121000000', current_odds: '610000' },
      { outcome_id: 1, label: 'DOWN', total_stake: '71000000', total_reward_shares: '71000000', current_odds: '390000' }
    ]
  },
  {
    market_id: '3',
    market_sequence: 39,
    question_hash: 'SOL 5m Crypto Round',
    price_header: {
      asset: 'SOL',
      asset_image_url: '/visuals/crypto/sol.svg',
      duration_seconds: 300,
      settlement_source: 'Binance Spot SOLUSDT 5m',
      symbol: 'SOLUSDT',
      round_id: '5666669',
      start_at: 1_700_000_700,
      end_at: 1_700_001_000,
      open_price: '154250000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      { outcome_id: 0, label: 'UP', total_stake: '92000000', total_reward_shares: '92000000', current_odds: '540000' },
      { outcome_id: 1, label: 'DOWN', total_stake: '78000000', total_reward_shares: '78000000', current_odds: '460000' }
    ]
  },
  {
    market_id: '11',
    market_sequence: 43,
    question_hash: 'BTC 1m Crypto Round',
    price_header: {
      asset: 'BTC',
      asset_image_url: '/visuals/crypto/btc.svg',
      duration_seconds: 60,
      settlement_source: 'Binance Spot BTCUSDT 1m',
      symbol: 'BTCUSDT',
      round_id: '28333336',
      start_at: 1_700_000_160,
      end_at: 1_700_000_220,
      open_price: '35570280000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      { outcome_id: 0, label: 'UP', total_stake: '98000000', total_reward_shares: '98000000', current_odds: '520000' },
      { outcome_id: 1, label: 'DOWN', total_stake: '89000000', total_reward_shares: '89000000', current_odds: '480000' }
    ]
  },
  {
    market_id: '12',
    market_sequence: 44,
    question_hash: 'ETH 1m Crypto Round',
    price_header: {
      asset: 'ETH',
      asset_image_url: '/visuals/crypto/eth.svg',
      duration_seconds: 60,
      settlement_source: 'Binance Spot ETHUSDT 1m',
      symbol: 'ETHUSDT',
      round_id: '28333337',
      start_at: 1_700_000_220,
      end_at: 1_700_000_280,
      open_price: '2030700000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      { outcome_id: 0, label: 'UP', total_stake: '87000000', total_reward_shares: '87000000', current_odds: '560000' },
      { outcome_id: 1, label: 'DOWN', total_stake: '69000000', total_reward_shares: '69000000', current_odds: '440000' }
    ]
  },
  {
    market_id: '13',
    market_sequence: 45,
    question_hash: 'SOL 1m Crypto Round',
    price_header: {
      asset: 'SOL',
      asset_image_url: '/visuals/crypto/sol.svg',
      duration_seconds: 60,
      settlement_source: 'Binance Spot SOLUSDT 1m',
      symbol: 'SOLUSDT',
      round_id: '28333338',
      start_at: 1_700_000_280,
      end_at: 1_700_000_340,
      open_price: '154310000',
      current_price: null,
      close_price: null,
      price_display_state: 'live',
      fetched_at: now
    },
    status: 'open',
    outcome_count: 2,
    open_at: 0,
    trade_until: 1_778_800_000,
    winning_outcome: null,
    outcomes: [
      { outcome_id: 0, label: 'UP', total_stake: '68000000', total_reward_shares: '68000000', current_odds: '510000' },
      { outcome_id: 1, label: 'DOWN', total_stake: '64000000', total_reward_shares: '64000000', current_odds: '490000' }
    ]
  }
];

function curveMetrics(volume: bigint) {
  const virtual_usdc = defaultVirtualUsdc + volume;
  const virtual_ticket = (defaultVirtualUsdc * defaultVirtualToken) / virtual_usdc;
  const token_supply = defaultVirtualToken - virtual_ticket;
  const price = (virtual_usdc * scale) / virtual_ticket;
  const market_cap = (price * defaultVirtualToken) / scale;

  return {
    price,
    token_supply,
    market_cap,
    liquidity: volume,
    volume,
    virtual_usdc,
    virtual_ticket
  };
}

function buildMockCurve(market: Market): MarketCurve {
  const header = market.price_header;
  const startAt = header?.start_at ?? 1_700_000_000;
  const endAt = header?.end_at ?? startAt + 300;
  const sides = market.outcomes.slice(0, 2).map((outcome, index) => {
    const metrics = curveMetrics(BigInt(outcome.total_stake));
    const freshMintPrice = metrics.price.toString();
    return {
      side: index === 0 ? 'UP' as const : 'DOWN' as const,
      price: freshMintPrice,
      best_entry_price: freshMintPrice,
      best_entry_source: 'fresh_curve' as const,
      fresh_mint_price: freshMintPrice,
      listed_best_ask_price: null,
      last_trade_price: null,
      token_supply: metrics.token_supply.toString(),
      market_cap: metrics.market_cap.toString(),
      liquidity: metrics.liquidity.toString(),
      volume: metrics.volume.toString(),
      virtual_usdc: metrics.virtual_usdc.toString(),
      virtual_ticket: metrics.virtual_ticket.toString()
    };
  });
  const points = sides.flatMap((side) => {
    const finalVolume = BigInt(side.volume);
    return Array.from({ length: 18 }, (_, index) => {
      const volume = (finalVolume * BigInt(index)) / 17n;
      const metrics = curveMetrics(volume);
      return {
        ts: startAt + Math.round(((endAt - startAt) * index) / 17),
        side: side.side,
        price: metrics.price.toString(),
        market_cap: metrics.market_cap.toString(),
        liquidity: metrics.liquidity.toString(),
        volume: metrics.volume.toString()
      };
    });
  });

  return {
    market_id: market.market_id,
    round_id: header?.round_id ?? market.market_id,
    duration_seconds: header?.duration_seconds ?? 300,
    updated_at: now,
    sides,
    points
  };
}

function buildMockRoundHistory(market: Market): RoundHistory {
  const header = market.price_header;
  const duration = header?.duration_seconds ?? 300;
  const currentRoundId = BigInt(header?.round_id ?? '5666667');
  const currentStart = header?.start_at ?? 1_700_000_000;
  const asset = header?.asset ?? 'BTC';
  const assetImageUrl = header?.asset_image_url ?? '/visuals/crypto/btc.svg';

  return {
    market_id: market.market_id,
    duration_seconds: duration,
    rounds: Array.from({ length: 6 }, (_, index) => {
      const offset = index - 5;
      const startAt = currentStart + offset * duration;
      return {
        round_id: (currentRoundId + BigInt(offset)).toString(),
        start_at: startAt,
        end_at: startAt + duration,
        status: offset === 0 ? market.status : 'closed',
        asset,
        asset_image_url: assetImageUrl
      };
    })
  };
}

export const mockCurves: Record<string, MarketCurve> = Object.fromEntries(
  mockMarkets.map((market) => [market.market_id, buildMockCurve(market)])
);

export const mockRoundHistories: Record<string, RoundHistory> = Object.fromEntries(
  mockMarkets.map((market) => [market.market_id, buildMockRoundHistory(market)])
);

export function mockMarketPriceSeries(symbol: string, startAt: number, durationSeconds: number): MarketPriceSeries {
  const market = mockMarkets.find((candidate) =>
    candidate.price_header?.symbol === symbol &&
    candidate.price_header?.duration_seconds === durationSeconds
  ) ?? mockMarkets.find((candidate) => candidate.price_header?.symbol === symbol) ?? mockMarkets[0];
  const header = market.price_header;
  const closed = startAt + durationSeconds < Math.floor(Date.now() / 1000);
  const endAt = startAt + durationSeconds;
  const matchesFixtureRound = startAt === header?.start_at;
  const open = matchesFixtureRound ? header?.open_price ?? null : null;
  const liveOrClose = matchesFixtureRound
    ? closed ? header?.close_price ?? header?.current_price ?? null : header?.current_price ?? null
    : null;

  const terminalPrice = liveOrClose;

  if (!open || !terminalPrice) {
    return {
      symbol,
      start_at: startAt,
      end_at: endAt,
      duration_seconds: durationSeconds,
      status: closed ? 'unavailable' : 'live',
      open_price: null,
      current_price: null,
      close_price: null,
      points: []
    };
  }

  const openValue = BigInt(open);
  const endValue = BigInt(terminalPrice);
  const wave = symbol === 'ETHUSDT' ? 1_900_000n : symbol === 'SOLUSDT' ? 210_000n : 8_500_000n;
  const points = Array.from({ length: 36 }, (_, index) => {
    const progress = BigInt(index);
    const base = openValue + ((endValue - openValue) * progress) / 35n;
    const bump = (BigInt((index % 9) - 4) * wave) / 4n;
    return {
      ts: startAt + Math.round((durationSeconds * index) / 35),
      price: (base + bump).toString()
    };
  });

  points[0] = { ts: startAt, price: open };
  points[points.length - 1] = { ts: endAt, price: terminalPrice };

  return {
    symbol,
    start_at: startAt,
    end_at: endAt,
    duration_seconds: durationSeconds,
    status: closed ? 'closed' : 'live',
    open_price: open,
    current_price: closed ? null : terminalPrice,
    close_price: closed ? terminalPrice : null,
    points
  };
}

export const mockCanvas: Record<string, CanvasResponse> = {
  '1': {
    market_id: '1',
    market_sequence: 42,
    canvas_version: 42,
    width: 1200,
    height: 630,
    regions: [
      {
        outcome_id: '0',
        label: 'UP',
        x: 0,
        y: 0,
        width: 600,
        height: 630,
        total_stake: '185000000',
        current_odds: '580000',
        state: 'open'
      },
      {
        outcome_id: '1',
        label: 'DOWN',
        x: 600,
        y: 0,
        width: 600,
        height: 630,
        total_stake: '134000000',
        current_odds: '420000',
        state: 'open'
      }
    ],
    nodes: [
      {
        ticket_id: '1',
        outcome_id: '0',
        x: 240,
        y: 230,
        radius: 34,
        z_index: 3,
        owner: mockWalletAddress,
        owner_display: shortAddress(mockWalletAddress),
        current_owner: mockWalletAddress,
        original_caller: mockWalletAddress,
        original_caller_display: shortAddress(mockWalletAddress),
        mood: 'optimistic',
        confidence: 82,
        listed: false,
        status: 'active'
      },
      {
        ticket_id: '2',
        outcome_id: '0',
        x: 410,
        y: 340,
        radius: 46,
        z_index: 6,
        owner: mockTraderAddress,
        owner_display: shortAddress(mockTraderAddress),
        current_owner: mockTraderAddress,
        original_caller: mockCallerAddress,
        original_caller_display: shortAddress(mockCallerAddress),
        mood: 'euphoric',
        confidence: 94,
        listed: true,
        listed_price: '145000000',
        last_transfer_at: now,
        status: 'listed'
      },
      {
        ticket_id: '3',
        outcome_id: '1',
        x: 790,
        y: 300,
        radius: 32,
        z_index: 4,
        owner: mockCallerAddress,
        owner_display: shortAddress(mockCallerAddress),
        current_owner: mockCallerAddress,
        original_caller: mockCallerAddress,
        original_caller_display: shortAddress(mockCallerAddress),
        mood: 'anxious',
        confidence: 61,
        listed: false,
        status: 'active'
      },
      {
        ticket_id: '4',
        outcome_id: '1',
        x: 980,
        y: 410,
        radius: 24,
        z_index: 2,
        owner: mockDownAddress,
        owner_display: shortAddress(mockDownAddress),
        current_owner: mockDownAddress,
        original_caller: mockDownAddress,
        original_caller_display: shortAddress(mockDownAddress),
        mood: 'neutral',
        confidence: 48,
        listed: false,
        status: 'active'
      }
    ]
  },
  '2': {
    market_id: '2',
    market_sequence: 38,
    canvas_version: 38,
    width: 1200,
    height: 630,
    regions: [
      { outcome_id: '0', label: 'UP', x: 0, y: 0, width: 600, height: 630, total_stake: '121000000', current_odds: '610000', state: 'resolved' },
      { outcome_id: '1', label: 'DOWN', x: 600, y: 0, width: 600, height: 630, total_stake: '71000000', current_odds: '390000', state: 'resolved' }
    ],
    nodes: []
  },
  '3': {
    market_id: '3',
    market_sequence: 39,
    canvas_version: 39,
    width: 1200,
    height: 630,
    regions: [
      { outcome_id: '0', label: 'UP', x: 0, y: 0, width: 600, height: 630, total_stake: '92000000', current_odds: '540000', state: 'open' },
      { outcome_id: '1', label: 'DOWN', x: 600, y: 0, width: 600, height: 630, total_stake: '78000000', current_odds: '460000', state: 'open' }
    ],
    nodes: []
  },
  '11': {
    market_id: '11',
    market_sequence: 43,
    canvas_version: 43,
    width: 1200,
    height: 630,
    regions: [
      { outcome_id: '0', label: 'UP', x: 0, y: 0, width: 600, height: 630, total_stake: '98000000', current_odds: '520000', state: 'open' },
      { outcome_id: '1', label: 'DOWN', x: 600, y: 0, width: 600, height: 630, total_stake: '89000000', current_odds: '480000', state: 'open' }
    ],
    nodes: []
  },
  '12': {
    market_id: '12',
    market_sequence: 44,
    canvas_version: 44,
    width: 1200,
    height: 630,
    regions: [
      { outcome_id: '0', label: 'UP', x: 0, y: 0, width: 600, height: 630, total_stake: '87000000', current_odds: '560000', state: 'open' },
      { outcome_id: '1', label: 'DOWN', x: 600, y: 0, width: 600, height: 630, total_stake: '69000000', current_odds: '440000', state: 'open' }
    ],
    nodes: []
  },
  '13': {
    market_id: '13',
    market_sequence: 45,
    canvas_version: 45,
    width: 1200,
    height: 630,
    regions: [
      { outcome_id: '0', label: 'UP', x: 0, y: 0, width: 600, height: 630, total_stake: '68000000', current_odds: '510000', state: 'open' },
      { outcome_id: '1', label: 'DOWN', x: 600, y: 0, width: 600, height: 630, total_stake: '64000000', current_odds: '490000', state: 'open' }
    ],
    nodes: []
  }
};

export const mockTickets: Ticket[] = [
  {
    ticket_id: '1',
    market_id: '1',
    round_id: '5666667',
    outcome_id: 0,
    token_name: 'btc-updown-5m-1700000100-up',
    original_caller: mockWalletAddress,
    current_owner: mockWalletAddress,
    stake_amount: '75000000',
    token_amount: '75000000',
    reward_shares: '75000000',
    entry_odds: '510000',
    cost_basis_usdc: '38250000',
    avg_entry_price: '510000',
    settlement_value_usdc: null,
    realized_pnl_usdc: null,
    listed_price: null,
    status: 'active',
    claimed: false,
    confidence: 82,
    mood: 1
  },
  {
    ticket_id: '2',
    market_id: '1',
    round_id: '5666667',
    outcome_id: 0,
    token_name: 'btc-updown-5m-1700000100-up',
    original_caller: mockCallerAddress,
    current_owner: mockTraderAddress,
    stake_amount: '110000000',
    token_amount: '110000000',
    reward_shares: '110000000',
    entry_odds: '470000',
    cost_basis_usdc: '51700000',
    avg_entry_price: '470000',
    settlement_value_usdc: null,
    realized_pnl_usdc: null,
    listed_price: '145000000',
    status: 'listed',
    claimed: false,
    confidence: 94,
    mood: 3
  },
  {
    ticket_id: '3',
    market_id: '1',
    round_id: '5666667',
    outcome_id: 1,
    token_name: 'btc-updown-5m-1700000100-down',
    original_caller: mockCallerAddress,
    current_owner: mockCallerAddress,
    stake_amount: '68000000',
    token_amount: '68000000',
    reward_shares: '68000000',
    entry_odds: '440000',
    cost_basis_usdc: '29920000',
    avg_entry_price: '440000',
    settlement_value_usdc: null,
    realized_pnl_usdc: null,
    listed_price: null,
    status: 'active',
    claimed: false,
    confidence: 61,
    mood: 2
  }
];

export const mockOrderBooks: Record<string, OrderBook> = {
  '1': {
    market_id: '1',
    round_id: mockMarkets[0]?.price_header?.round_id ?? '5666667',
    updated_at: now,
    state: 'live',
    sides: [
      {
        side: 'UP',
        best_bid_price: '720000',
        best_ask_price: '145000000',
        bids: [
          {
            bid_id: 'mock-bid-up-1',
            price_per_ticket: '720000',
            remaining_usdc: '5000000',
            available_tickets: '6944444',
            total_usdc: '5000000'
          }
        ],
        asks: [
          {
            lot_id: '2',
            price_per_ticket: '145000000',
            ticket_amount: '110000000',
            total_usdc: '15950000000'
          }
        ]
      },
      {
        side: 'DOWN',
        best_bid_price: '180000',
        best_ask_price: null,
        bids: [
          {
            bid_id: 'mock-bid-down-1',
            price_per_ticket: '180000',
            remaining_usdc: '1500000',
            available_tickets: '8333333',
            total_usdc: '1500000'
          }
        ],
        asks: []
      }
    ]
  }
};

export const mockProfiles: Record<string, Profile> = {
  [mockWalletAddress]: {
    wallet_address: mockWalletAddress,
    display_name: 'Signal Runner',
    avatar_url: null
  }
};

export function mockShareRender(ticketId: string): ShareRenderResponse {
  return {
    share_card_id: `mock-share-${ticketId}`,
    status: 'pending'
  };
}

export function mockShareCard(shareCardId: string): ShareCardResponse {
  const ticketId = shareCardId.replace('mock-share-', '') || '1';

  return {
    id: shareCardId,
    kind: 'ticket',
    ticket_id: ticketId,
    status: 'ready',
    svg_hash: 'mock-svg-hash',
    png_url: '/visuals/market-canvas-empty.png',
    created_at: now,
    updated_at: now
  };
}

export function mockProfile(address: string): Profile {
  return (
    mockProfiles[address] ?? {
      wallet_address: address,
      display_name: null,
      avatar_url: null
    }
  );
}

export function mockCashBalance(address: string): CashBalance {
  return {
    wallet_address: address,
    currency: 'BUSDC',
    decimals: 6,
    cash_balance: null,
    status: 'projection_pending'
  };
}

export function mockDepositConfig(): DepositConfig {
  return {
    cluster: 'devnet',
    currency: 'BUSDC',
    decimals: 6,
    mint: null,
    vault_owner: null,
    vault_token_account: null,
    commitment: 'confirmed',
    status: 'projection_pending'
  };
}
