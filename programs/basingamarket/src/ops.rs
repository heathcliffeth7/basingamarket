use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, system_instruction},
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::math::{checked_add, checked_sub, early_flip_fee, fee_amount, mul_div};
use crate::{
    BasingamarketError, Curve, GlobalConfig, PositionLot, Round, SellLotIntoBidFromVault,
    SellLotIntoBidFromVaultArgs, Side, SCALE,
};

pub(crate) struct FreshBuyExecution<'a, 'info> {
    pub(crate) global_config: &'a mut Account<'info, GlobalConfig>,
    pub(crate) round: &'a mut Account<'info, Round>,
    pub(crate) position_lot: &'a mut Account<'info, PositionLot>,
    pub(crate) usdc_mint: &'a Account<'info, Mint>,
    pub(crate) source_usdc_account: &'a Account<'info, TokenAccount>,
    pub(crate) round_vault: &'a Account<'info, TokenAccount>,
    pub(crate) fee_vault: &'a Account<'info, TokenAccount>,
    pub(crate) source_authority: &'a Signer<'info>,
    pub(crate) token_program: &'a Program<'info, Token>,
    pub(crate) position_owner: Pubkey,
    pub(crate) lot_id: u64,
    pub(crate) side: Side,
    pub(crate) usdc_in: u64,
    pub(crate) min_tickets_out: u64,
}

pub(crate) fn execute_fresh_buy(ctx: FreshBuyExecution<'_, '_>) -> Result<()> {
    crate::require_not_paused(ctx.global_config)?;
    crate::require_live_trading(ctx.round)?;
    require!(ctx.usdc_in > 0, BasingamarketError::ZeroAmount);

    let fee = fee_amount(ctx.usdc_in, ctx.global_config.buy_fee_bps)?;
    let net_usdc = checked_sub(ctx.usdc_in, fee)?;
    let tickets_out = quote_buy(curve_for_side_mut(ctx.round, ctx.side), net_usdc)?;
    require!(
        tickets_out >= ctx.min_tickets_out,
        BasingamarketError::Slippage
    );
    require!(
        ctx.usdc_mint.decimals == 6,
        BasingamarketError::InvalidUsdcMint
    );
    require_token_account(
        ctx.source_usdc_account,
        ctx.usdc_mint.key(),
        ctx.source_authority.key(),
    )?;
    require_token_account(ctx.round_vault, ctx.usdc_mint.key(), ctx.round.key())?;
    require_token_account(ctx.fee_vault, ctx.usdc_mint.key(), ctx.global_config.key())?;

    transfer_checked(
        ctx.source_usdc_account,
        ctx.usdc_mint,
        ctx.round_vault,
        ctx.source_authority,
        ctx.token_program,
        net_usdc,
    )?;
    if fee > 0 {
        transfer_checked(
            ctx.source_usdc_account,
            ctx.usdc_mint,
            ctx.fee_vault,
            ctx.source_authority,
            ctx.token_program,
            fee,
        )?;
    }
    apply_buy(
        curve_for_side_mut(ctx.round, ctx.side),
        net_usdc,
        tickets_out,
    )?;
    ctx.global_config.protocol_fee_accrued_usdc =
        checked_add(ctx.global_config.protocol_fee_accrued_usdc, fee)?;

    init_lot(
        ctx.position_lot,
        ctx.lot_id,
        ctx.round.key(),
        ctx.side,
        ctx.position_owner,
        tickets_out,
        net_usdc,
        Clock::get()?.unix_timestamp,
    )
}

pub(crate) fn init_aggregate(
    aggregate: &mut crate::OpeningAggregate,
    round: Pubkey,
    side: Side,
) -> Result<()> {
    aggregate.round = round;
    aggregate.side = side;
    aggregate.total_net_usdc = 0;
    aggregate.total_tickets_out = 0;
    aggregate.finalized = false;
    Ok(())
}

pub(crate) fn init_lot(
    lot: &mut PositionLot,
    lot_id: u64,
    round: Pubkey,
    side: Side,
    owner: Pubkey,
    ticket_amount: u64,
    usdc_in: u64,
    now: i64,
) -> Result<()> {
    lot.lot_id = lot_id;
    lot.round = round;
    lot.side = side;
    lot.current_owner = owner;
    lot.original_buyer = owner;
    lot.ticket_amount = ticket_amount;
    lot.usdc_in = usdc_in;
    lot.avg_entry_price = mul_div(usdc_in, SCALE as u64, ticket_amount)?;
    lot.listed = false;
    lot.listed_price = 0;
    lot.created_at = now;
    lot.last_transfer_at = now;
    lot.claimed = false;
    Ok(())
}

pub(crate) fn curve_for_side(round: &Round, side: Side) -> &Curve {
    match side {
        Side::Up => &round.up,
        Side::Down => &round.down,
    }
}

pub(crate) fn curve_for_side_mut(round: &mut Round, side: Side) -> &mut Curve {
    match side {
        Side::Up => &mut round.up,
        Side::Down => &mut round.down,
    }
}

pub(crate) fn quote_buy(curve: &mut Curve, net_usdc: u64) -> Result<u64> {
    require!(net_usdc > 0, BasingamarketError::ZeroAmount);
    let k = (curve.virtual_usdc as u128)
        .checked_mul(curve.virtual_ticket as u128)
        .ok_or(BasingamarketError::Overflow)?;
    let new_virtual_usdc = checked_add(curve.virtual_usdc, net_usdc)?;
    let new_virtual_ticket_u128 = k
        .checked_div(new_virtual_usdc as u128)
        .ok_or(BasingamarketError::Overflow)?;
    let new_virtual_ticket =
        u64::try_from(new_virtual_ticket_u128).map_err(|_| BasingamarketError::Overflow)?;
    checked_sub(curve.virtual_ticket, new_virtual_ticket)
}

pub(crate) fn apply_buy(curve: &mut Curve, net_usdc: u64, tickets_out: u64) -> Result<()> {
    let k = (curve.virtual_usdc as u128)
        .checked_mul(curve.virtual_ticket as u128)
        .ok_or(BasingamarketError::Overflow)?;
    curve.virtual_usdc = checked_add(curve.virtual_usdc, net_usdc)?;
    let new_virtual_ticket_u128 = k
        .checked_div(curve.virtual_usdc as u128)
        .ok_or(BasingamarketError::Overflow)?;
    curve.virtual_ticket =
        u64::try_from(new_virtual_ticket_u128).map_err(|_| BasingamarketError::Overflow)?;
    curve.real_usdc = checked_add(curve.real_usdc, net_usdc)?;
    curve.ticket_supply = checked_add(curve.ticket_supply, tickets_out)?;
    Ok(())
}

pub(crate) fn listing_total_price(lot: &PositionLot) -> Result<u64> {
    require!(lot.ticket_amount > 0, BasingamarketError::ZeroTicketAmount);
    require!(lot.listed_price > 0, BasingamarketError::ZeroAmount);
    mul_div(lot.ticket_amount, lot.listed_price, SCALE as u64)
}

pub(crate) fn execute_secondary_fee_transfers<'info>(
    global_config: &mut Account<'info, GlobalConfig>,
    round: &mut Account<'info, Round>,
    usdc_mint: &Account<'info, Mint>,
    cash_vault: &Account<'info, TokenAccount>,
    round_vault: &Account<'info, TokenAccount>,
    fee_vault: &Account<'info, TokenAccount>,
    cashier: &Signer<'info>,
    token_program: &Program<'info, Token>,
    gross_usdc: u64,
    last_transfer_at: i64,
    now: i64,
) -> Result<()> {
    require!(gross_usdc > 0, BasingamarketError::ZeroAmount);
    require!(usdc_mint.decimals == 6, BasingamarketError::InvalidUsdcMint);
    require_token_account(cash_vault, usdc_mint.key(), cashier.key())?;
    require_token_account(round_vault, usdc_mint.key(), round.key())?;
    require_token_account(fee_vault, usdc_mint.key(), global_config.key())?;

    let resale_fee = fee_amount(gross_usdc, global_config.resale_fee_bps)?;
    let early_fee = early_flip_fee(gross_usdc, now.saturating_sub(last_transfer_at))?;
    let _seller_receives = checked_sub(checked_sub(gross_usdc, resale_fee)?, early_fee)?;

    if resale_fee > 0 {
        transfer_checked(
            cash_vault,
            usdc_mint,
            fee_vault,
            cashier,
            token_program,
            resale_fee,
        )?;
    }
    if early_fee > 0 {
        transfer_checked(
            cash_vault,
            usdc_mint,
            round_vault,
            cashier,
            token_program,
            early_fee,
        )?;
    }

    global_config.protocol_fee_accrued_usdc =
        checked_add(global_config.protocol_fee_accrued_usdc, resale_fee)?;
    round.round_bonus_usdc = checked_add(round.round_bonus_usdc, early_fee)?;
    Ok(())
}

pub(crate) fn create_split_lot(
    ctx: &Context<SellLotIntoBidFromVault>,
    args: &SellLotIntoBidFromVaultArgs,
    now: i64,
) -> Result<()> {
    let round_key = ctx.accounts.round.key();
    let lot_id_bytes = args.buyer_lot_id.to_le_bytes();
    let (expected_lot, bump) = Pubkey::find_program_address(
        &[b"lot", round_key.as_ref(), lot_id_bytes.as_ref()],
        &crate::ID,
    );
    require!(
        expected_lot == ctx.accounts.buyer_lot.key(),
        BasingamarketError::InvalidLotPda
    );
    require!(
        ctx.accounts.buyer_lot.lamports() == 0 && ctx.accounts.buyer_lot.data_is_empty(),
        BasingamarketError::LotAlreadyInitialized
    );

    let space = 8 + PositionLot::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(space);
    let bump_seed = [bump];
    let signer_seeds = &[
        b"lot",
        round_key.as_ref(),
        lot_id_bytes.as_ref(),
        bump_seed.as_ref(),
    ];
    invoke_signed(
        &system_instruction::create_account(
            &ctx.accounts.cashier.key(),
            &ctx.accounts.buyer_lot.key(),
            rent,
            space as u64,
            &crate::ID,
        ),
        &[
            ctx.accounts.cashier.to_account_info(),
            ctx.accounts.buyer_lot.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    let seller = &ctx.accounts.seller_lot;
    let buyer_lot = PositionLot {
        lot_id: args.buyer_lot_id,
        round: round_key,
        side: seller.side,
        current_owner: args.buyer_wallet,
        original_buyer: seller.original_buyer,
        ticket_amount: args.tickets_to_sell,
        usdc_in: args.gross_usdc,
        avg_entry_price: mul_div(args.gross_usdc, SCALE as u64, args.tickets_to_sell)?,
        listed: false,
        listed_price: 0,
        created_at: now,
        last_transfer_at: now,
        claimed: false,
    };
    let mut data = ctx.accounts.buyer_lot.try_borrow_mut_data()?;
    buyer_lot.try_serialize(&mut data.as_mut())?;
    Ok(())
}

pub(crate) fn require_token_account(
    account: &Account<'_, TokenAccount>,
    mint: Pubkey,
    authority: Pubkey,
) -> Result<()> {
    require!(
        account.mint == mint && account.owner == authority,
        BasingamarketError::InvalidTokenAccount
    );
    Ok(())
}

pub(crate) fn transfer_checked<'info>(
    source: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    token::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}
