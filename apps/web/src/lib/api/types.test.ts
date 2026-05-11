import { describe, expect, it } from 'vitest';
import {
  CanvasResponseSchema,
  BusdcMintSchema,
  BusdcMintStatusSchema,
  CashBalanceSchema,
  DepositConfigSchema,
  DepositLiquiditySchema,
  DepositVerificationSchema,
  MarketCurveSchema,
  MarketPriceSeriesSchema,
  RoundHistorySchema,
  ShareCardResponseSchema,
  SolDepositQuoteSchema,
  SolDepositVerificationSchema,
  TransferDepositQuoteSchema,
  TransferDepositVerificationSchema,
  WithdrawConfigSchema,
  WithdrawalQuoteSchema,
  WithdrawalVerificationSchema
} from './types';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('api schemas', () => {
  it('requires the fixed canonical canvas coordinate system', () => {
    expect(() =>
      CanvasResponseSchema.parse({
        market_id: '1',
        market_sequence: 10,
        canvas_version: 10,
        width: 1000,
        height: 630,
        regions: [],
        nodes: []
      })
    ).toThrow();
  });

  it('accepts share rendering states used by the UI', () => {
    expect(
      ShareCardResponseSchema.parse({
        id: 'share-1',
        kind: 'ticket',
        ticket_id: '7',
        status: 'rendering',
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z'
      }).status
    ).toBe('rendering');
  });

  it('accepts ready and pending cash balance states', () => {
    expect(
      CashBalanceSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '8490000',
        status: 'ready'
      }).cash_balance
    ).toBe('8490000');

    expect(
      CashBalanceSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        status: 'projection_pending'
      }).cash_balance
    ).toBeNull();
  });

  it('accepts BUSDC mint status and credited responses', () => {
    expect(
      BusdcMintStatusSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        mint_amount: '50000000000',
        daily_mints_used: 1,
        daily_mints_remaining: 4,
        daily_mints_limit: 5,
        reset_at: '2026-05-12T00:00:00+00:00',
        status: 'ready'
      }).daily_mints_remaining
    ).toBe(4);

    expect(
      BusdcMintSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        minted_amount: '50000000000',
        cash_balance: '50000000000',
        daily_mints_used: 1,
        daily_mints_remaining: 4,
        daily_mints_limit: 5,
        reset_at: '2026-05-12T00:00:00+00:00',
        status: 'credited'
      }).minted_amount
    ).toBe('50000000000');
  });

  it('accepts deposit config and verification shapes', () => {
    expect(
      DepositConfigSchema.parse({
        cluster: 'devnet',
        currency: 'BUSDC',
        decimals: 6,
        mint: SOLANA_DEVNET_PUBKEY,
        vault_owner: SOLANA_DEVNET_PUBKEY,
        vault_token_account: 'So11111111111111111111111111111111111111112',
        commitment: 'confirmed',
        status: 'ready'
      }).status
    ).toBe('ready');

    expect(
      DepositVerificationSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        signature: '5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q',
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '1000000',
        deposited_amount: '1000000',
        status: 'credited'
      }).cash_balance
    ).toBe('1000000');
  });

  it('accepts deposit liquidity readiness shape', () => {
    expect(
      DepositLiquiditySchema.parse({
        cluster: 'devnet',
        currency: 'BUSDC',
        decimals: 6,
        mint: SOLANA_DEVNET_PUBKEY,
        vault_owner: SOLANA_DEVNET_PUBKEY,
        vault_token_account: 'So11111111111111111111111111111111111111112',
        vault_cash_balance: '2500000',
        total_cash_liabilities: '1000000',
        available_cash_reserve: '1500000',
        status: 'ready'
      }).available_cash_reserve
    ).toBe('1500000');
  });

  it('accepts SOL deposit quote and verification shapes', () => {
    expect(
      SolDepositQuoteSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        cash_amount: '1000000',
        quote_id: 'quote-1',
        lamports: '6666667',
        price: '150000000',
        expires_at: '2026-05-10T00:00:00Z',
        treasury: SOLANA_DEVNET_PUBKEY,
        status: 'ready'
      }).lamports
    ).toBe('6666667');

    expect(
      SolDepositVerificationSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        signature: '5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q',
        quote_id: 'quote-1',
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '1000000',
        deposited_amount: '1000000',
        lamports: '6666667',
        price: '150000000',
        status: 'credited'
      }).deposited_amount
    ).toBe('1000000');
  });

  it('accepts manual transfer deposit quote and verification shapes', () => {
    expect(
      TransferDepositQuoteSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        asset: 'BUSDC',
        currency: 'BUSDC',
        decimals: 6,
        cash_amount: '1000000',
        quote_id: 'quote-1',
        reference: 'bm:quote-1',
        transfer_amount: '1000000',
        expires_at: '2026-05-10T00:00:00Z',
        destination: 'So11111111111111111111111111111111111111112',
        mint: SOLANA_DEVNET_PUBKEY,
        status: 'ready'
      }).reference
    ).toBe('bm:quote-1');

    expect(
      TransferDepositVerificationSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        signature: '5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q',
        quote_id: 'quote-1',
        asset: 'SOL',
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '1000000',
        deposited_amount: '1000000',
        transfer_amount: '6666667',
        price: '150000000',
        status: 'credited'
      }).transfer_amount
    ).toBe('6666667');
  });

  it('accepts withdraw config quote and verification shapes', () => {
    expect(
      WithdrawConfigSchema.parse({
        cluster: 'devnet',
        currency: 'BUSDC',
        decimals: 6,
        mint: SOLANA_DEVNET_PUBKEY,
        vault_owner: SOLANA_DEVNET_PUBKEY,
        vault_token_account: 'So11111111111111111111111111111111111111112',
        quote_ttl_seconds: 60,
        status: 'ready'
      }).status
    ).toBe('ready');

    expect(
      WithdrawalQuoteSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        cash_amount: '1000000',
        quote_id: 'withdraw-quote-1',
        message: 'withdraw message',
        destination: SOLANA_DEVNET_PUBKEY,
        destination_token_account: 'So11111111111111111111111111111111111111112',
        mint: SOLANA_DEVNET_PUBKEY,
        expires_at: '2026-05-10T00:00:00Z',
        status: 'ready'
      }).message
    ).toBe('withdraw message');

    expect(
      WithdrawalVerificationSchema.parse({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        quote_id: 'withdraw-quote-1',
        user_signature: 'user-signature',
        vault_signature: 'vault-signature',
        currency: 'BUSDC',
        decimals: 6,
        mint: SOLANA_DEVNET_PUBKEY,
        cash_balance: '0',
        withdrawn_amount: '1000000',
        destination: SOLANA_DEVNET_PUBKEY,
        destination_token_account: 'So11111111111111111111111111111111111111112',
        explorer_url: 'https://explorer.solana.com/tx/vault-signature?cluster=devnet',
        status: 'sent'
      }).withdrawn_amount
    ).toBe('1000000');
  });

  it('accepts bonding curve and round history projections', () => {
    expect(
      MarketCurveSchema.parse({
        market_id: '1',
        round_id: '42',
        duration_seconds: 300,
        updated_at: '2026-05-10T00:00:00Z',
        sides: [
          { side: 'UP', price: '501000', best_entry_price: '501000', best_entry_source: 'fresh_curve', fresh_mint_price: '501000', listed_best_ask_price: null, last_trade_price: null, token_supply: '1000', market_cap: '501', liquidity: '1000000', volume: '1000000', virtual_usdc: '50001000000', virtual_ticket: '99998000000' },
          { side: 'DOWN', price: '499000', best_entry_price: '499000', best_entry_source: 'fresh_curve', fresh_mint_price: '499000', listed_best_ask_price: null, last_trade_price: null, token_supply: '900', market_cap: '449', liquidity: '900000', volume: '900000', virtual_usdc: '50000900000', virtual_ticket: '99998200000' }
        ],
        points: [
          { ts: 1_700_000_000, side: 'UP', price: '501000', market_cap: '501', liquidity: '1000000', volume: '1000000' }
        ]
      }).sides
    ).toHaveLength(2);

    expect(
      RoundHistorySchema.parse({
        market_id: '1',
        duration_seconds: 300,
        rounds: [{ round_id: '42', start_at: 1_700_000_000, end_at: 1_700_000_300, status: 'open', asset: 'BTC', asset_image_url: '/visuals/crypto/btc.svg' }]
      }).rounds[0].asset
    ).toBe('BTC');
  });

  it('accepts asset price series projections for round charts', () => {
    expect(
      MarketPriceSeriesSchema.parse({
        symbol: 'BTCUSDT',
        start_at: 1_778_413_500,
        end_at: 1_778_413_800,
        duration_seconds: 300,
        status: 'live',
        open_price: '80797280000',
        current_price: '80815450000',
        close_price: null,
        points: [
          { ts: 1_778_413_500, price: '80797280000' },
          { ts: 1_778_413_650, price: '80815450000' }
        ]
      }).points
    ).toHaveLength(2);
  });
});
