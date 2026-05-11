use super::*;

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(init, payer = admin, space = 8 + GlobalConfig::INIT_SPACE, seeds = [b"global"], bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreateMarketConfigArgs)]
pub struct CreateMarketConfig<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [b"market", args.market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market_config: Account<'info, MarketConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCashMint<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetMarketActive<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"market", market_config.market_id.to_le_bytes().as_ref()], bump = market_config.bump)]
    pub market_config: Account<'info, MarketConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: OpenRoundArgs)]
pub struct OpenRound<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(seeds = [b"market", market_config.market_id.to_le_bytes().as_ref()], bump = market_config.bump)]
    pub market_config: Account<'info, MarketConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + Round::INIT_SPACE,
        seeds = [b"round", market_config.key().as_ref(), args.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = authority,
        space = 8 + OpeningAggregate::INIT_SPACE,
        seeds = [b"opening_aggregate", round.key().as_ref(), b"up"],
        bump
    )]
    pub up_aggregate: Account<'info, OpeningAggregate>,
    #[account(
        init,
        payer = authority,
        space = 8 + OpeningAggregate::INIT_SPACE,
        seeds = [b"opening_aggregate", round.key().as_ref(), b"down"],
        bump
    )]
    pub down_aggregate: Account<'info, OpeningAggregate>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitOpeningOrder<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(seeds = [b"market", market_config.market_id.to_le_bytes().as_ref()], bump = market_config.bump)]
    pub market_config: Account<'info, MarketConfig>,
    #[account(seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub aggregate: Account<'info, OpeningAggregate>,
    #[account(init, payer = user, space = 8 + OpeningOrder::INIT_SPACE)]
    pub opening_order: Account<'info, OpeningOrder>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeOpeningSide<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub aggregate: Account<'info, OpeningAggregate>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: ClaimOpeningOrderArgs)]
pub struct ClaimOpeningOrder<'info> {
    #[account(seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    pub aggregate: Account<'info, OpeningAggregate>,
    #[account(mut)]
    pub opening_order: Account<'info, OpeningOrder>,
    #[account(
        init,
        payer = user,
        space = 8 + PositionLot::INIT_SPACE,
        seeds = [b"lot", round.key().as_ref(), args.lot_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position_lot: Account<'info, PositionLot>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: BuyFreshArgs)]
pub struct BuyFresh<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + PositionLot::INIT_SPACE,
        seeds = [b"lot", round.key().as_ref(), args.lot_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position_lot: Box<Account<'info, PositionLot>>,
    #[account(address = global_config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub buyer_usdc_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub round_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: BuyFreshFromVaultArgs)]
pub struct BuyFreshFromVault<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(
        init,
        payer = cashier,
        space = 8 + PositionLot::INIT_SPACE,
        seeds = [b"lot", round.key().as_ref(), args.lot_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position_lot: Box<Account<'info, PositionLot>>,
    #[account(address = global_config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub cash_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub round_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub cashier: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ListTicketFromCashier<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub position_lot: Account<'info, PositionLot>,
    pub cashier: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelListingFromCashier<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub position_lot: Account<'info, PositionLot>,
    pub cashier: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyListingFromVault<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut)]
    pub position_lot: Box<Account<'info, PositionLot>>,
    #[account(address = global_config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub cash_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub round_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub cashier: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SellLotIntoBidFromVault<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut)]
    pub seller_lot: Box<Account<'info, PositionLot>>,
    #[account(mut)]
    pub buyer_lot: UncheckedAccount<'info>,
    #[account(address = global_config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub cash_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub round_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub cashier: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseRound<'info> {
    #[account(seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveRound<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimLot<'info> {
    #[account(seeds = [b"round", round.market.as_ref(), round.round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub position_lot: Account<'info, PositionLot>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawProtocolFees<'info> {
    #[account(mut, seeds = [b"global"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}
