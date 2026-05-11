#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

mod math;
use math::{
    checked_add, checked_sub, expected_close_time_ms, fee_amount, mul_div, seconds_to_millis,
};
mod ops;
use ops::*;

declare_id!("3oAve8qsR5oVtqUcsXtSELBVz5CnJifj4UCvM6AiHa2r");

pub(crate) const SCALE: u128 = 1_000_000;

#[program]
pub mod basingamarket {
    use super::*;

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        args: InitializeGlobalConfigArgs,
    ) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        config.admin = ctx.accounts.admin.key();
        config.protocol_treasury = args.protocol_treasury;
        config.usdc_mint = args.usdc_mint;
        config.trusted_settlement_actor = args.trusted_settlement_actor;
        config.buy_fee_bps = args.buy_fee_bps;
        config.resale_fee_bps = args.resale_fee_bps;
        config.settlement_fee_bps = args.settlement_fee_bps;
        config.min_side_real_usdc = args.min_side_real_usdc;
        config.protocol_fee_accrued_usdc = 0;
        config.paused = false;
        config.bump = ctx.bumps.global_config;
        Ok(())
    }

    pub fn create_market_config(
        ctx: Context<CreateMarketConfig>,
        args: CreateMarketConfigArgs,
    ) -> Result<()> {
        require_admin(&ctx.accounts.global_config, &ctx.accounts.admin)?;
        require!(
            args.duration_seconds > 0,
            BasingamarketError::InvalidDuration
        );
        require!(
            args.virtual_usdc_start > 0 && args.virtual_ticket_start > 0,
            BasingamarketError::InvalidVirtualReserves
        );

        let market = &mut ctx.accounts.market_config;
        market.market_id = args.market_id;
        market.asset = args.asset;
        market.duration_seconds = args.duration_seconds;
        market.binance_symbol = args.binance_symbol;
        market.binance_interval = args.binance_interval;
        market.virtual_usdc_start = args.virtual_usdc_start;
        market.virtual_ticket_start = args.virtual_ticket_start;
        market.opening_batch_seconds = args.opening_batch_seconds;
        market.opening_wallet_side_cap_usdc = args.opening_wallet_side_cap_usdc;
        market.active = true;
        market.bump = ctx.bumps.market_config;
        Ok(())
    }

    pub fn set_cash_mint(ctx: Context<SetCashMint>, args: SetCashMintArgs) -> Result<()> {
        require_admin(&ctx.accounts.global_config, &ctx.accounts.admin)?;
        ctx.accounts.global_config.usdc_mint = args.usdc_mint;
        Ok(())
    }

    pub fn pause_market(ctx: Context<SetMarketActive>) -> Result<()> {
        require_admin(&ctx.accounts.global_config, &ctx.accounts.admin)?;
        ctx.accounts.market_config.active = false;
        Ok(())
    }

    pub fn unpause_market(ctx: Context<SetMarketActive>) -> Result<()> {
        require_admin(&ctx.accounts.global_config, &ctx.accounts.admin)?;
        ctx.accounts.market_config.active = true;
        Ok(())
    }

    pub fn open_round(ctx: Context<OpenRound>, args: OpenRoundArgs) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.authority)?;
        require!(
            !ctx.accounts.global_config.paused && ctx.accounts.market_config.active,
            BasingamarketError::Paused
        );
        require!(
            args.end_at > args.start_at
                && args.batch_until >= args.start_at
                && args.batch_until < args.end_at,
            BasingamarketError::InvalidRoundWindow
        );

        let market = &ctx.accounts.market_config;
        require!(
            args.binance_symbol == market.binance_symbol
                && args.binance_interval == market.binance_interval,
            BasingamarketError::InvalidBinanceSnapshot
        );
        require!(
            args.binance_open_time_ms == seconds_to_millis(args.start_at)?,
            BasingamarketError::InvalidBinanceSnapshot
        );

        let round = &mut ctx.accounts.round;
        round.market = market.key();
        round.round_id = args.round_id;
        round.start_at = args.start_at;
        round.batch_until = args.batch_until;
        round.end_at = args.end_at;
        round.start_price = args.start_price;
        round.end_price = 0;
        round.status = RoundStatus::Open;
        round.winning_side = RoundOutcome::None;
        round.up = Curve::new(market.virtual_usdc_start, market.virtual_ticket_start);
        round.down = Curve::new(market.virtual_usdc_start, market.virtual_ticket_start);
        round.round_bonus_usdc = 0;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        round.binance_symbol = args.binance_symbol;
        round.binance_interval = args.binance_interval;
        round.binance_open_time_ms = args.binance_open_time_ms;
        round.binance_close_time_ms = 0;
        round.bump = ctx.bumps.round;

        init_aggregate(&mut ctx.accounts.up_aggregate, round.key(), Side::Up)?;
        init_aggregate(&mut ctx.accounts.down_aggregate, round.key(), Side::Down)?;
        Ok(())
    }

    pub fn submit_opening_order(
        ctx: Context<SubmitOpeningOrder>,
        args: SubmitOpeningOrderArgs,
    ) -> Result<()> {
        require_not_paused(&ctx.accounts.global_config)?;
        require_opening_batch(&ctx.accounts.round)?;
        require!(
            args.net_usdc > 0
                && args.net_usdc <= ctx.accounts.market_config.opening_wallet_side_cap_usdc,
            BasingamarketError::OpeningWalletCapExceeded
        );
        require!(
            ctx.accounts.aggregate.round == ctx.accounts.round.key()
                && ctx.accounts.aggregate.side == args.side
                && !ctx.accounts.aggregate.finalized,
            BasingamarketError::InvalidOpeningAggregate
        );

        let order = &mut ctx.accounts.opening_order;
        order.round = ctx.accounts.round.key();
        order.user = ctx.accounts.user.key();
        order.side = args.side;
        order.net_usdc = args.net_usdc;
        order.claimed = false;
        order.bump = 0;

        ctx.accounts.aggregate.total_net_usdc =
            checked_add(ctx.accounts.aggregate.total_net_usdc, args.net_usdc)?;
        Ok(())
    }

    pub fn finalize_opening_side(ctx: Context<FinalizeOpeningSide>) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.authority)?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.round.batch_until,
            BasingamarketError::BatchStillOpen
        );
        require!(
            ctx.accounts.aggregate.round == ctx.accounts.round.key()
                && !ctx.accounts.aggregate.finalized,
            BasingamarketError::InvalidOpeningAggregate
        );

        let quote = quote_buy(
            curve_for_side_mut(&mut ctx.accounts.round, ctx.accounts.aggregate.side),
            ctx.accounts.aggregate.total_net_usdc,
        )?;
        apply_buy(
            curve_for_side_mut(&mut ctx.accounts.round, ctx.accounts.aggregate.side),
            ctx.accounts.aggregate.total_net_usdc,
            quote,
        )?;
        ctx.accounts.aggregate.total_tickets_out = quote;
        ctx.accounts.aggregate.finalized = true;
        Ok(())
    }

    pub fn claim_opening_order(
        ctx: Context<ClaimOpeningOrder>,
        args: ClaimOpeningOrderArgs,
    ) -> Result<()> {
        require!(
            ctx.accounts.aggregate.round == ctx.accounts.round.key()
                && ctx.accounts.aggregate.side == ctx.accounts.opening_order.side
                && ctx.accounts.aggregate.finalized,
            BasingamarketError::InvalidOpeningAggregate
        );
        require!(
            ctx.accounts.opening_order.user == ctx.accounts.user.key()
                && !ctx.accounts.opening_order.claimed,
            BasingamarketError::Unauthorized
        );
        require!(
            ctx.accounts.aggregate.total_net_usdc > 0,
            BasingamarketError::ZeroAmount
        );

        let tickets = mul_div(
            ctx.accounts.opening_order.net_usdc,
            ctx.accounts.aggregate.total_tickets_out,
            ctx.accounts.aggregate.total_net_usdc,
        )?;
        require!(tickets > 0, BasingamarketError::ZeroTicketAmount);

        let lot = &mut ctx.accounts.position_lot;
        init_lot(
            lot,
            args.lot_id,
            ctx.accounts.round.key(),
            ctx.accounts.opening_order.side,
            ctx.accounts.user.key(),
            tickets,
            ctx.accounts.opening_order.net_usdc,
            Clock::get()?.unix_timestamp,
        )?;
        ctx.accounts.opening_order.claimed = true;
        Ok(())
    }

    pub fn buy_fresh(ctx: Context<BuyFresh>, args: BuyFreshArgs) -> Result<()> {
        execute_fresh_buy(FreshBuyExecution {
            global_config: &mut ctx.accounts.global_config,
            round: &mut ctx.accounts.round,
            position_lot: &mut ctx.accounts.position_lot,
            usdc_mint: &ctx.accounts.usdc_mint,
            source_usdc_account: &ctx.accounts.buyer_usdc_account,
            round_vault: &ctx.accounts.round_vault,
            fee_vault: &ctx.accounts.fee_vault,
            source_authority: &ctx.accounts.buyer,
            token_program: &ctx.accounts.token_program,
            position_owner: ctx.accounts.buyer.key(),
            lot_id: args.lot_id,
            side: args.side,
            usdc_in: args.usdc_in,
            min_tickets_out: args.min_tickets_out,
        })
    }

    pub fn buy_fresh_from_vault(
        ctx: Context<BuyFreshFromVault>,
        args: BuyFreshFromVaultArgs,
    ) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.cashier)?;
        execute_fresh_buy(FreshBuyExecution {
            global_config: &mut ctx.accounts.global_config,
            round: &mut ctx.accounts.round,
            position_lot: &mut ctx.accounts.position_lot,
            usdc_mint: &ctx.accounts.usdc_mint,
            source_usdc_account: &ctx.accounts.cash_vault,
            round_vault: &ctx.accounts.round_vault,
            fee_vault: &ctx.accounts.fee_vault,
            source_authority: &ctx.accounts.cashier,
            token_program: &ctx.accounts.token_program,
            position_owner: args.position_owner,
            lot_id: args.lot_id,
            side: args.side,
            usdc_in: args.usdc_in,
            min_tickets_out: args.min_tickets_out,
        })
    }

    pub fn list_ticket_from_cashier(
        ctx: Context<ListTicketFromCashier>,
        args: ListTicketFromCashierArgs,
    ) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.cashier)?;
        require_round_tradeable(&ctx.accounts.round)?;
        require!(
            ctx.accounts.position_lot.round == ctx.accounts.round.key(),
            BasingamarketError::InvalidLotRound
        );
        require!(
            ctx.accounts.position_lot.current_owner == args.seller_wallet,
            BasingamarketError::Unauthorized
        );
        require!(
            !ctx.accounts.position_lot.claimed,
            BasingamarketError::AlreadyClaimed
        );
        require!(
            ctx.accounts.position_lot.ticket_amount > 0,
            BasingamarketError::ZeroTicketAmount
        );
        require!(args.price_per_ticket > 0, BasingamarketError::ZeroAmount);

        let lot = &mut ctx.accounts.position_lot;
        lot.listed = true;
        lot.listed_price = args.price_per_ticket;
        Ok(())
    }

    pub fn cancel_listing_from_cashier(
        ctx: Context<CancelListingFromCashier>,
        args: CancelListingFromCashierArgs,
    ) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.cashier)?;
        require_round_tradeable(&ctx.accounts.round)?;
        require!(
            ctx.accounts.position_lot.round == ctx.accounts.round.key(),
            BasingamarketError::InvalidLotRound
        );
        require!(
            ctx.accounts.position_lot.current_owner == args.seller_wallet,
            BasingamarketError::Unauthorized
        );
        require!(
            ctx.accounts.position_lot.listed,
            BasingamarketError::ListingNotActive
        );

        let lot = &mut ctx.accounts.position_lot;
        lot.listed = false;
        lot.listed_price = 0;
        Ok(())
    }

    pub fn buy_listing_from_vault(
        ctx: Context<BuyListingFromVault>,
        args: BuyListingFromVaultArgs,
    ) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.cashier)?;
        require_not_paused(&ctx.accounts.global_config)?;
        require_round_tradeable(&ctx.accounts.round)?;
        require!(
            ctx.accounts.position_lot.round == ctx.accounts.round.key(),
            BasingamarketError::InvalidLotRound
        );

        let gross_usdc = listing_total_price(&ctx.accounts.position_lot)?;
        require!(
            ctx.accounts.position_lot.listed && !ctx.accounts.position_lot.claimed,
            BasingamarketError::ListingNotActive
        );
        require!(
            ctx.accounts.position_lot.current_owner != args.buyer_wallet,
            BasingamarketError::SelfBuy
        );
        require!(
            ctx.accounts.position_lot.listed_price <= args.max_price_per_ticket,
            BasingamarketError::Slippage
        );

        let now = Clock::get()?.unix_timestamp;
        execute_secondary_fee_transfers(
            &mut ctx.accounts.global_config,
            &mut ctx.accounts.round,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.cash_vault,
            &ctx.accounts.round_vault,
            &ctx.accounts.fee_vault,
            &ctx.accounts.cashier,
            &ctx.accounts.token_program,
            gross_usdc,
            ctx.accounts.position_lot.last_transfer_at,
            now,
        )?;

        let lot = &mut ctx.accounts.position_lot;
        lot.current_owner = args.buyer_wallet;
        lot.listed = false;
        lot.listed_price = 0;
        lot.last_transfer_at = now;
        Ok(())
    }

    pub fn sell_lot_into_bid_from_vault(
        ctx: Context<SellLotIntoBidFromVault>,
        args: SellLotIntoBidFromVaultArgs,
    ) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.cashier)?;
        require_not_paused(&ctx.accounts.global_config)?;
        require_round_tradeable(&ctx.accounts.round)?;
        require!(
            ctx.accounts.seller_lot.round == ctx.accounts.round.key(),
            BasingamarketError::InvalidLotRound
        );
        require!(
            ctx.accounts.seller_lot.current_owner == args.seller_wallet,
            BasingamarketError::Unauthorized
        );
        require!(
            !ctx.accounts.seller_lot.claimed,
            BasingamarketError::AlreadyClaimed
        );
        require!(
            args.buyer_wallet != args.seller_wallet,
            BasingamarketError::SelfBuy
        );
        require!(args.gross_usdc > 0, BasingamarketError::ZeroAmount);
        require!(
            args.tickets_to_sell > 0
                && args.tickets_to_sell <= ctx.accounts.seller_lot.ticket_amount,
            BasingamarketError::ZeroTicketAmount
        );

        let now = Clock::get()?.unix_timestamp;
        execute_secondary_fee_transfers(
            &mut ctx.accounts.global_config,
            &mut ctx.accounts.round,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.cash_vault,
            &ctx.accounts.round_vault,
            &ctx.accounts.fee_vault,
            &ctx.accounts.cashier,
            &ctx.accounts.token_program,
            args.gross_usdc,
            ctx.accounts.seller_lot.last_transfer_at,
            now,
        )?;

        let sold_all = args.tickets_to_sell == ctx.accounts.seller_lot.ticket_amount;
        if sold_all {
            let lot = &mut ctx.accounts.seller_lot;
            lot.current_owner = args.buyer_wallet;
            lot.listed = false;
            lot.listed_price = 0;
            lot.last_transfer_at = now;
            return Ok(());
        }

        create_split_lot(&ctx, &args, now)?;

        let lot = &mut ctx.accounts.seller_lot;
        let old_tickets = lot.ticket_amount;
        let sold_usdc_in = mul_div(lot.usdc_in, args.tickets_to_sell, old_tickets)?;
        lot.ticket_amount = checked_sub(lot.ticket_amount, args.tickets_to_sell)?;
        lot.usdc_in = checked_sub(lot.usdc_in, sold_usdc_in)?;
        lot.avg_entry_price = if lot.ticket_amount == 0 {
            0
        } else {
            mul_div(lot.usdc_in, SCALE as u64, lot.ticket_amount)?
        };
        lot.listed = false;
        lot.listed_price = 0;
        Ok(())
    }

    pub fn close_round(ctx: Context<CloseRound>) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.authority)?;
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.round.end_at,
            BasingamarketError::RoundStillOpen
        );
        ctx.accounts.round.status = RoundStatus::Closed;
        Ok(())
    }

    pub fn resolve_round(ctx: Context<ResolveRound>, args: ResolveRoundArgs) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.authority)?;
        require!(
            matches!(
                ctx.accounts.round.status,
                RoundStatus::Open | RoundStatus::Closed
            ),
            BasingamarketError::RoundNotOpen
        );
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.round.end_at,
            BasingamarketError::RoundStillOpen
        );
        require!(
            args.binance_symbol == ctx.accounts.round.binance_symbol
                && args.binance_interval == ctx.accounts.round.binance_interval
                && args.binance_open_time_ms == ctx.accounts.round.binance_open_time_ms
                && args.binance_close_time_ms == expected_close_time_ms(ctx.accounts.round.end_at)?,
            BasingamarketError::InvalidBinanceSnapshot
        );

        let round = &mut ctx.accounts.round;
        round.end_price = args.end_price;
        round.binance_close_time_ms = args.binance_close_time_ms;
        apply_round_resolution(round, &mut ctx.accounts.global_config, args.end_price)
    }

    pub fn void_round(ctx: Context<ResolveRound>, args: ResolveRoundArgs) -> Result<()> {
        require_settlement_actor(&ctx.accounts.global_config, &ctx.accounts.authority)?;
        require!(
            args.binance_symbol == ctx.accounts.round.binance_symbol
                && args.binance_interval == ctx.accounts.round.binance_interval,
            BasingamarketError::InvalidBinanceSnapshot
        );
        let round = &mut ctx.accounts.round;
        round.end_price = args.end_price;
        round.binance_close_time_ms = args.binance_close_time_ms;
        round.status = RoundStatus::Voided;
        round.winning_side = RoundOutcome::Void;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        Ok(())
    }

    pub fn claim_winning_lot(ctx: Context<ClaimLot>) -> Result<()> {
        require_lot_owner(&ctx.accounts.position_lot, &ctx.accounts.owner)?;
        require!(
            ctx.accounts.round.status == RoundStatus::Resolved,
            BasingamarketError::RoundNotResolved
        );
        require!(
            !ctx.accounts.position_lot.claimed,
            BasingamarketError::AlreadyClaimed
        );
        require!(
            ctx.accounts.round.winning_side == ctx.accounts.position_lot.side.into(),
            BasingamarketError::LosingLot
        );

        let _payout = mul_div(
            ctx.accounts.position_lot.ticket_amount,
            ctx.accounts.round.payout_per_ticket,
            SCALE as u64,
        )?;
        ctx.accounts.position_lot.claimed = true;
        Ok(())
    }

    pub fn claim_void_lot(ctx: Context<ClaimLot>) -> Result<()> {
        require_lot_owner(&ctx.accounts.position_lot, &ctx.accounts.owner)?;
        require!(
            ctx.accounts.round.status == RoundStatus::Voided,
            BasingamarketError::RoundNotVoided
        );
        require!(
            !ctx.accounts.position_lot.claimed,
            BasingamarketError::AlreadyClaimed
        );

        let curve = curve_for_side(&ctx.accounts.round, ctx.accounts.position_lot.side);
        require!(
            curve.ticket_supply > 0,
            BasingamarketError::ZeroTicketAmount
        );
        let _refund = mul_div(
            ctx.accounts.position_lot.ticket_amount,
            curve.real_usdc,
            curve.ticket_supply,
        )?;
        ctx.accounts.position_lot.claimed = true;
        Ok(())
    }

    pub fn withdraw_protocol_fees(ctx: Context<WithdrawProtocolFees>) -> Result<()> {
        require_admin(&ctx.accounts.global_config, &ctx.accounts.admin)?;
        ctx.accounts.global_config.protocol_fee_accrued_usdc = 0;
        Ok(())
    }
}

mod contexts;
use contexts::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub protocol_treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub trusted_settlement_actor: Pubkey,
    pub buy_fee_bps: u16,
    pub resale_fee_bps: u16,
    pub settlement_fee_bps: u16,
    pub min_side_real_usdc: u64,
    pub protocol_fee_accrued_usdc: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub market_id: u64,
    pub asset: Asset,
    pub duration_seconds: u64,
    pub binance_symbol: [u8; 16],
    pub binance_interval: [u8; 8],
    pub virtual_usdc_start: u64,
    pub virtual_ticket_start: u64,
    pub opening_batch_seconds: u16,
    pub opening_wallet_side_cap_usdc: u64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub market: Pubkey,
    pub round_id: u64,
    pub start_at: i64,
    pub batch_until: i64,
    pub end_at: i64,
    pub start_price: u64,
    pub end_price: u64,
    pub status: RoundStatus,
    pub winning_side: RoundOutcome,
    pub up: Curve,
    pub down: Curve,
    pub round_bonus_usdc: u64,
    pub payout_per_ticket: u64,
    pub settlement_vault: u64,
    pub protocol_vault_amount: u64,
    pub binance_symbol: [u8; 16],
    pub binance_interval: [u8; 8],
    pub binance_open_time_ms: i64,
    pub binance_close_time_ms: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct OpeningOrder {
    pub round: Pubkey,
    pub user: Pubkey,
    pub side: Side,
    pub net_usdc: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct OpeningAggregate {
    pub round: Pubkey,
    pub side: Side,
    pub total_net_usdc: u64,
    pub total_tickets_out: u64,
    pub finalized: bool,
}

#[account]
#[derive(InitSpace)]
pub struct PositionLot {
    pub lot_id: u64,
    pub round: Pubkey,
    pub side: Side,
    pub current_owner: Pubkey,
    pub original_buyer: Pubkey,
    pub ticket_amount: u64,
    pub usdc_in: u64,
    pub avg_entry_price: u64,
    pub listed: bool,
    pub listed_price: u64,
    pub created_at: i64,
    pub last_transfer_at: i64,
    pub claimed: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct Curve {
    pub virtual_usdc: u64,
    pub virtual_ticket: u64,
    pub real_usdc: u64,
    pub ticket_supply: u64,
}

impl Curve {
    pub fn new(virtual_usdc: u64, virtual_ticket: u64) -> Self {
        Self {
            virtual_usdc,
            virtual_ticket,
            real_usdc: 0,
            ticket_supply: 0,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Asset {
    Btc,
    Eth,
    Sol,
    Xrp,
    Doge,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Side {
    Up,
    Down,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum RoundOutcome {
    None,
    Up,
    Down,
    Void,
}

impl From<Side> for RoundOutcome {
    fn from(value: Side) -> Self {
        match value {
            Side::Up => Self::Up,
            Side::Down => Self::Down,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum RoundStatus {
    Open,
    Closed,
    Resolved,
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeGlobalConfigArgs {
    pub protocol_treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub trusted_settlement_actor: Pubkey,
    pub buy_fee_bps: u16,
    pub resale_fee_bps: u16,
    pub settlement_fee_bps: u16,
    pub min_side_real_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetCashMintArgs {
    pub usdc_mint: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMarketConfigArgs {
    pub market_id: u64,
    pub asset: Asset,
    pub duration_seconds: u64,
    pub binance_symbol: [u8; 16],
    pub binance_interval: [u8; 8],
    pub virtual_usdc_start: u64,
    pub virtual_ticket_start: u64,
    pub opening_batch_seconds: u16,
    pub opening_wallet_side_cap_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenRoundArgs {
    pub round_id: u64,
    pub start_at: i64,
    pub batch_until: i64,
    pub end_at: i64,
    pub start_price: u64,
    pub binance_symbol: [u8; 16],
    pub binance_interval: [u8; 8],
    pub binance_open_time_ms: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitOpeningOrderArgs {
    pub side: Side,
    pub net_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimOpeningOrderArgs {
    pub lot_id: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuyFreshArgs {
    pub lot_id: u64,
    pub side: Side,
    pub usdc_in: u64,
    pub min_tickets_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuyFreshFromVaultArgs {
    pub lot_id: u64,
    pub side: Side,
    pub position_owner: Pubkey,
    pub usdc_in: u64,
    pub min_tickets_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ListTicketFromCashierArgs {
    pub seller_wallet: Pubkey,
    pub price_per_ticket: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CancelListingFromCashierArgs {
    pub seller_wallet: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuyListingFromVaultArgs {
    pub buyer_wallet: Pubkey,
    pub max_price_per_ticket: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SellLotIntoBidFromVaultArgs {
    pub seller_wallet: Pubkey,
    pub buyer_wallet: Pubkey,
    pub buyer_lot_id: u64,
    pub tickets_to_sell: u64,
    pub gross_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveRoundArgs {
    pub end_price: u64,
    pub binance_symbol: [u8; 16],
    pub binance_interval: [u8; 8],
    pub binance_open_time_ms: i64,
    pub binance_close_time_ms: i64,
}

#[error_code]
pub enum BasingamarketError {
    #[msg("admin authority is required")]
    Unauthorized,
    #[msg("market or global config is paused")]
    Paused,
    #[msg("round is not open")]
    RoundNotOpen,
    #[msg("round is not resolved")]
    RoundNotResolved,
    #[msg("round is not voided")]
    RoundNotVoided,
    #[msg("round is still open")]
    RoundStillOpen,
    #[msg("round is outside live trading time")]
    NotLiveTrading,
    #[msg("opening batch is still open")]
    BatchStillOpen,
    #[msg("opening batch is closed")]
    BatchClosed,
    #[msg("opening wallet cap exceeded")]
    OpeningWalletCapExceeded,
    #[msg("invalid opening aggregate")]
    InvalidOpeningAggregate,
    #[msg("invalid round window")]
    InvalidRoundWindow,
    #[msg("invalid duration")]
    InvalidDuration,
    #[msg("invalid virtual reserves")]
    InvalidVirtualReserves,
    #[msg("invalid Binance snapshot")]
    InvalidBinanceSnapshot,
    #[msg("slippage check failed")]
    Slippage,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("ticket amount must be greater than zero")]
    ZeroTicketAmount,
    #[msg("listing is not active")]
    ListingNotActive,
    #[msg("buyer cannot buy their own lot")]
    SelfBuy,
    #[msg("lot is already claimed")]
    AlreadyClaimed,
    #[msg("lot is on the losing side")]
    LosingLot,
    #[msg("lot does not belong to this round")]
    InvalidLotRound,
    #[msg("lot PDA is invalid")]
    InvalidLotPda,
    #[msg("lot account is already initialized")]
    LotAlreadyInitialized,
    #[msg("USDC mint must be the configured 6 decimal SPL mint")]
    InvalidUsdcMint,
    #[msg("token account mint or authority is invalid")]
    InvalidTokenAccount,
    #[msg("arithmetic overflow")]
    Overflow,
}

pub(crate) fn require_admin(config: &GlobalConfig, signer: &Signer<'_>) -> Result<()> {
    require!(
        config.admin == signer.key(),
        BasingamarketError::Unauthorized
    );
    Ok(())
}

pub(crate) fn require_settlement_actor(config: &GlobalConfig, signer: &Signer<'_>) -> Result<()> {
    require!(
        config.admin == signer.key() || config.trusted_settlement_actor == signer.key(),
        BasingamarketError::Unauthorized
    );
    Ok(())
}

pub(crate) fn require_not_paused(config: &GlobalConfig) -> Result<()> {
    require!(!config.paused, BasingamarketError::Paused);
    Ok(())
}

pub(crate) fn require_lot_owner(lot: &PositionLot, owner: &Signer<'_>) -> Result<()> {
    require!(
        lot.current_owner == owner.key(),
        BasingamarketError::Unauthorized
    );
    Ok(())
}

pub(crate) fn require_opening_batch(round: &Round) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        round.status == RoundStatus::Open,
        BasingamarketError::RoundNotOpen
    );
    require!(now <= round.batch_until, BasingamarketError::BatchClosed);
    Ok(())
}

pub(crate) fn require_live_trading(round: &Round) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        round.status == RoundStatus::Open,
        BasingamarketError::RoundNotOpen
    );
    require!(
        now > round.batch_until && now < round.end_at,
        BasingamarketError::NotLiveTrading
    );
    Ok(())
}

pub(crate) fn require_round_tradeable(round: &Round) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        round.status == RoundStatus::Open,
        BasingamarketError::RoundNotOpen
    );
    require!(now < round.end_at, BasingamarketError::NotLiveTrading);
    Ok(())
}

pub(crate) fn apply_round_resolution(
    round: &mut Round,
    global_config: &mut GlobalConfig,
    end_price: u64,
) -> Result<()> {
    if end_price == round.start_price {
        round.status = RoundStatus::Voided;
        round.winning_side = RoundOutcome::Void;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        return Ok(());
    }

    let winning_side = if end_price > round.start_price {
        Side::Up
    } else {
        Side::Down
    };
    let gross_vault = checked_add(
        checked_add(round.up.real_usdc, round.down.real_usdc)?,
        round.round_bonus_usdc,
    )?;
    let winning_supply = curve_for_side(round, winning_side).ticket_supply;
    if winning_supply == 0 {
        round.status = RoundStatus::Resolved;
        round.winning_side = winning_side.into();
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = gross_vault;
        global_config.protocol_fee_accrued_usdc =
            checked_add(global_config.protocol_fee_accrued_usdc, gross_vault)?;
        return Ok(());
    }

    if round.up.real_usdc < global_config.min_side_real_usdc
        || round.down.real_usdc < global_config.min_side_real_usdc
    {
        round.status = RoundStatus::Voided;
        round.winning_side = RoundOutcome::Void;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        return Ok(());
    }

    let settlement_fee = fee_amount(gross_vault, global_config.settlement_fee_bps)?;
    let settlement_vault = checked_sub(gross_vault, settlement_fee)?;

    round.status = RoundStatus::Resolved;
    round.winning_side = winning_side.into();
    round.settlement_vault = settlement_vault;
    round.payout_per_ticket = mul_div(settlement_vault, SCALE as u64, winning_supply)?;
    round.protocol_vault_amount = settlement_fee;
    global_config.protocol_fee_accrued_usdc =
        checked_add(global_config.protocol_fee_accrued_usdc, settlement_fee)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_global_cash_mint_for_test(
        config: &mut GlobalConfig,
        signer: Pubkey,
        usdc_mint: Pubkey,
    ) -> Result<()> {
        require!(config.admin == signer, BasingamarketError::Unauthorized);
        config.usdc_mint = usdc_mint;
        Ok(())
    }

    fn global_config(admin: Pubkey, usdc_mint: Pubkey) -> GlobalConfig {
        GlobalConfig {
            admin,
            protocol_treasury: Pubkey::new_unique(),
            usdc_mint,
            trusted_settlement_actor: Pubkey::new_unique(),
            buy_fee_bps: 50,
            resale_fee_bps: 50,
            settlement_fee_bps: 0,
            min_side_real_usdc: 10_000_000,
            protocol_fee_accrued_usdc: 0,
            paused: false,
            bump: 255,
        }
    }

    fn round_with_side_liquidity(side: Side, real_usdc: u64, ticket_supply: u64) -> Round {
        let mut round = Round {
            market: Pubkey::new_unique(),
            round_id: 1,
            start_at: 100,
            batch_until: 110,
            end_at: 200,
            start_price: 2_000_000_000,
            end_price: 0,
            status: RoundStatus::Closed,
            winning_side: RoundOutcome::None,
            up: Curve::new(50_000_000_000, 100_000_000_000),
            down: Curve::new(50_000_000_000, 100_000_000_000),
            round_bonus_usdc: 0,
            payout_per_ticket: 0,
            settlement_vault: 0,
            protocol_vault_amount: 0,
            binance_symbol: [0; 16],
            binance_interval: [0; 8],
            binance_open_time_ms: 0,
            binance_close_time_ms: 0,
            bump: 255,
        };
        match side {
            Side::Up => {
                round.up.real_usdc = real_usdc;
                round.up.ticket_supply = ticket_supply;
            }
            Side::Down => {
                round.down.real_usdc = real_usdc;
                round.down.ticket_supply = ticket_supply;
            }
        }
        round
    }

    #[test]
    fn set_global_cash_mint_allows_admin() {
        let admin = Pubkey::new_unique();
        let old_mint = Pubkey::new_unique();
        let new_mint = Pubkey::new_unique();
        let mut config = global_config(admin, old_mint);

        set_global_cash_mint_for_test(&mut config, admin, new_mint).unwrap();

        assert_eq!(config.usdc_mint, new_mint);
    }

    #[test]
    fn set_global_cash_mint_rejects_non_admin() {
        let admin = Pubkey::new_unique();
        let old_mint = Pubkey::new_unique();
        let new_mint = Pubkey::new_unique();
        let mut config = global_config(admin, old_mint);

        assert!(
            set_global_cash_mint_for_test(&mut config, Pubkey::new_unique(), new_mint).is_err()
        );
        assert_eq!(config.usdc_mint, old_mint);
    }

    #[test]
    fn no_winner_resolution_accrues_round_vault_to_protocol() {
        let admin = Pubkey::new_unique();
        let mut config = global_config(admin, Pubkey::new_unique());
        let mut round = round_with_side_liquidity(Side::Down, 25_000_000, 50_000_000);

        apply_round_resolution(&mut round, &mut config, 2_001_000_000).unwrap();

        assert_eq!(round.status, RoundStatus::Resolved);
        assert_eq!(round.winning_side, RoundOutcome::Up);
        assert_eq!(round.settlement_vault, 0);
        assert_eq!(round.payout_per_ticket, 0);
        assert_eq!(round.protocol_vault_amount, 25_000_000);
        assert_eq!(config.protocol_fee_accrued_usdc, 25_000_000);
    }

    #[test]
    fn single_side_winner_still_voids_as_inactive() {
        let admin = Pubkey::new_unique();
        let mut config = global_config(admin, Pubkey::new_unique());
        let mut round = round_with_side_liquidity(Side::Up, 25_000_000, 50_000_000);

        apply_round_resolution(&mut round, &mut config, 2_001_000_000).unwrap();

        assert_eq!(round.status, RoundStatus::Voided);
        assert_eq!(round.protocol_vault_amount, 0);
        assert_eq!(config.protocol_fee_accrued_usdc, 0);
    }
}
