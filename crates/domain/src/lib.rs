//! Pure domain rules for basingamarket.
//!
//! This crate intentionally has no database, RPC, Redis, NATS, or HTTP
//! dependencies. Contract, indexer, API, and renderer code can all depend on
//! these types without pulling infrastructure into the financial rules.

pub mod crypto_rounds;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type Amount = u128;

pub const SCALE: Amount = 1_000_000;
pub const BPS_DENOMINATOR: Amount = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketStatus {
    Scheduled,
    Open,
    Closed,
    Resolved,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
    Active,
    Listed,
    Claimable,
    Claimed,
    Lost,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomePool {
    pub outcome_id: u8,
    pub label: String,
    pub total_stake: Amount,
    pub total_reward_shares: Amount,
    pub current_odds: Amount,
}

impl OutcomePool {
    pub fn new(outcome_id: u8, label: impl Into<String>) -> Self {
        Self {
            outcome_id,
            label: label.into(),
            total_stake: 0,
            total_reward_shares: 0,
            current_odds: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketState {
    pub market_id: u64,
    pub status: MarketStatus,
    pub outcomes: Vec<OutcomePool>,
    pub platform_fee_bps: u16,
    pub min_stake: Amount,
    pub winning_outcome: Option<u8>,
}

impl MarketState {
    pub fn new(
        market_id: u64,
        outcome_count: u8,
        platform_fee_bps: u16,
        min_stake: Amount,
    ) -> Self {
        let outcomes = (0..outcome_count)
            .map(|outcome_id| OutcomePool::new(outcome_id, format!("Outcome {outcome_id}")))
            .collect();

        Self {
            market_id,
            status: MarketStatus::Open,
            outcomes,
            platform_fee_bps,
            min_stake,
            winning_outcome: None,
        }
    }

    pub fn total_pool(&self) -> Result<Amount, MarketMathError> {
        self.outcomes.iter().try_fold(0_u128, |acc, outcome| {
            acc.checked_add(outcome.total_stake)
                .ok_or(MarketMathError::Overflow)
        })
    }

    pub fn outcome(&self, outcome_id: u8) -> Result<&OutcomePool, MarketMathError> {
        self.outcomes
            .iter()
            .find(|outcome| outcome.outcome_id == outcome_id)
            .ok_or(MarketMathError::InvalidOutcome { outcome_id })
    }

    pub fn outcome_mut(&mut self, outcome_id: u8) -> Result<&mut OutcomePool, MarketMathError> {
        self.outcomes
            .iter_mut()
            .find(|outcome| outcome.outcome_id == outcome_id)
            .ok_or(MarketMathError::InvalidOutcome { outcome_id })
    }

    pub fn record_stake(
        &mut self,
        outcome_id: u8,
        stake: Amount,
    ) -> Result<MintQuote, MarketMathError> {
        let quote = quote_mint(self, outcome_id, stake)?;
        let total_pool_after = self
            .total_pool()?
            .checked_add(stake)
            .ok_or(MarketMathError::Overflow)?;

        let outcome = self.outcome_mut(outcome_id)?;
        outcome.total_stake = outcome
            .total_stake
            .checked_add(stake)
            .ok_or(MarketMathError::Overflow)?;
        outcome.total_reward_shares = outcome
            .total_reward_shares
            .checked_add(quote.reward_shares)
            .ok_or(MarketMathError::Overflow)?;
        outcome.current_odds = checked_mul_div(total_pool_after, SCALE, outcome.total_stake)?;

        Ok(quote)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ticket {
    pub ticket_id: u64,
    pub market_id: u64,
    pub outcome_id: u8,
    pub original_caller: String,
    pub current_owner: String,
    pub stake_amount: Amount,
    pub reward_shares: Amount,
    pub entry_odds: Amount,
    pub claimed: bool,
    pub status: TicketStatus,
}

impl Ticket {
    pub fn transfer_payout_right_to(&mut self, new_owner: impl Into<String>) {
        self.current_owner = new_owner.into();
        if self.status == TicketStatus::Listed {
            self.status = TicketStatus::Active;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MintQuote {
    pub stake_amount: Amount,
    pub reward_shares: Amount,
    pub entry_odds: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayoutQuote {
    pub gross_pool: Amount,
    pub platform_fee: Amount,
    pub distributable_pool: Amount,
    pub payout_amount: Amount,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum MarketMathError {
    #[error("market is not open for trading")]
    MarketNotOpen,
    #[error("market has not been resolved")]
    MarketNotResolved,
    #[error("market has no winning outcome")]
    MissingWinningOutcome,
    #[error("outcome {outcome_id} does not exist")]
    InvalidOutcome { outcome_id: u8 },
    #[error("stake is zero")]
    ZeroStake,
    #[error("stake {stake} is below minimum {min_stake}")]
    StakeBelowMinimum { stake: Amount, min_stake: Amount },
    #[error("winning outcome has no reward shares")]
    NoWinningShares,
    #[error("ticket is not on the winning outcome")]
    LosingTicket,
    #[error("ticket was already claimed")]
    AlreadyClaimed,
    #[error("arithmetic overflow")]
    Overflow,
}

pub fn validate_market_can_trade(
    market: &MarketState,
    outcome_id: u8,
    stake: Amount,
) -> Result<(), MarketMathError> {
    if market.status != MarketStatus::Open {
        return Err(MarketMathError::MarketNotOpen);
    }

    if stake == 0 {
        return Err(MarketMathError::ZeroStake);
    }

    if stake < market.min_stake {
        return Err(MarketMathError::StakeBelowMinimum {
            stake,
            min_stake: market.min_stake,
        });
    }

    market.outcome(outcome_id)?;
    Ok(())
}

pub fn calculate_entry_odds(
    market: &MarketState,
    outcome_id: u8,
    stake: Amount,
) -> Result<Amount, MarketMathError> {
    validate_market_can_trade(market, outcome_id, stake)?;

    let selected_pool_after = market
        .outcome(outcome_id)?
        .total_stake
        .checked_add(stake)
        .ok_or(MarketMathError::Overflow)?;
    let total_pool_after = market
        .total_pool()?
        .checked_add(stake)
        .ok_or(MarketMathError::Overflow)?;

    checked_mul_div(total_pool_after, SCALE, selected_pool_after)
}

pub fn calculate_reward_shares(
    market: &MarketState,
    outcome_id: u8,
    stake: Amount,
) -> Result<Amount, MarketMathError> {
    validate_market_can_trade(market, outcome_id, stake)?;
    let outcome = market.outcome(outcome_id)?;

    if outcome.total_stake == 0 || outcome.total_reward_shares == 0 {
        return Ok(stake);
    }

    checked_mul_div(stake, outcome.total_reward_shares, outcome.total_stake)
}

pub fn quote_mint(
    market: &MarketState,
    outcome_id: u8,
    stake: Amount,
) -> Result<MintQuote, MarketMathError> {
    Ok(MintQuote {
        stake_amount: stake,
        reward_shares: calculate_reward_shares(market, outcome_id, stake)?,
        entry_odds: calculate_entry_odds(market, outcome_id, stake)?,
    })
}

pub fn calculate_platform_fee(total_pool: Amount, fee_bps: u16) -> Result<Amount, MarketMathError> {
    checked_mul_div(total_pool, Amount::from(fee_bps), BPS_DENOMINATOR)
}

pub fn validate_ticket_can_claim(
    ticket: &Ticket,
    market: &MarketState,
) -> Result<u8, MarketMathError> {
    if ticket.claimed {
        return Err(MarketMathError::AlreadyClaimed);
    }
    if market.status != MarketStatus::Resolved {
        return Err(MarketMathError::MarketNotResolved);
    }
    let winning_outcome = market
        .winning_outcome
        .ok_or(MarketMathError::MissingWinningOutcome)?;
    if ticket.outcome_id != winning_outcome {
        return Err(MarketMathError::LosingTicket);
    }
    Ok(winning_outcome)
}

pub fn calculate_payout(
    ticket: &Ticket,
    market: &MarketState,
) -> Result<PayoutQuote, MarketMathError> {
    let winning_outcome = validate_ticket_can_claim(ticket, market)?;
    let winning_pool = market.outcome(winning_outcome)?;

    if winning_pool.total_reward_shares == 0 {
        return Err(MarketMathError::NoWinningShares);
    }

    let gross_pool = market.total_pool()?;
    let platform_fee = calculate_platform_fee(gross_pool, market.platform_fee_bps)?;
    let distributable_pool = gross_pool
        .checked_sub(platform_fee)
        .ok_or(MarketMathError::Overflow)?;
    let payout_amount = checked_mul_div(
        distributable_pool,
        ticket.reward_shares,
        winning_pool.total_reward_shares,
    )?;

    Ok(PayoutQuote {
        gross_pool,
        platform_fee,
        distributable_pool,
        payout_amount,
    })
}

pub fn checked_mul_div(
    a: Amount,
    b: Amount,
    denominator: Amount,
) -> Result<Amount, MarketMathError> {
    if denominator == 0 {
        return Err(MarketMathError::Overflow);
    }
    a.checked_mul(b)
        .ok_or(MarketMathError::Overflow)?
        .checked_div(denominator)
        .ok_or(MarketMathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: Amount = 1_000_000;
    const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const TEST_BUYER: &str = "So11111111111111111111111111111111111111112";

    fn ticket(ticket_id: u64, outcome_id: u8, quote: MintQuote) -> Ticket {
        Ticket {
            ticket_id,
            market_id: 1,
            outcome_id,
            original_caller: TEST_OWNER.to_owned(),
            current_owner: TEST_OWNER.to_owned(),
            stake_amount: quote.stake_amount,
            reward_shares: quote.reward_shares,
            entry_odds: quote.entry_odds,
            claimed: false,
            status: TicketStatus::Active,
        }
    }

    #[test]
    fn two_outcome_payout_does_not_exceed_distributable_pool() {
        let mut market = MarketState::new(1, 2, 250, USDC);
        let yes = market.record_stake(0, 60 * USDC).unwrap();
        let no = market.record_stake(1, 40 * USDC).unwrap();
        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(0);

        let payout = calculate_payout(&ticket(1, 0, yes), &market).unwrap();
        let losing = ticket(2, 1, no);

        assert_eq!(
            calculate_payout(&losing, &market),
            Err(MarketMathError::LosingTicket)
        );
        assert!(payout.payout_amount <= payout.distributable_pool);
        assert_eq!(payout.platform_fee, 2_500_000);
    }

    #[test]
    fn four_outcome_normal_distribution_has_scaled_entry_odds() {
        let mut market = MarketState::new(2, 4, 0, USDC);
        let first = market.record_stake(0, 10 * USDC).unwrap();
        let second = market.record_stake(1, 30 * USDC).unwrap();
        let third = market.record_stake(2, 60 * USDC).unwrap();
        let fourth = market.record_stake(3, 100 * USDC).unwrap();

        assert_eq!(first.entry_odds, SCALE);
        assert!(second.entry_odds > SCALE);
        assert!(third.entry_odds > SCALE);
        assert!(fourth.entry_odds > SCALE);
        assert_eq!(market.total_pool().unwrap(), 200 * USDC);
    }

    #[test]
    fn invalid_or_zero_stake_fails() {
        let market = MarketState::new(1, 2, 0, USDC);

        assert_eq!(quote_mint(&market, 0, 0), Err(MarketMathError::ZeroStake));
        assert_eq!(
            quote_mint(&market, 4, USDC),
            Err(MarketMathError::InvalidOutcome { outcome_id: 4 })
        );
    }

    #[test]
    fn market_closed_fails_trade_validation() {
        let mut market = MarketState::new(1, 2, 0, USDC);
        market.status = MarketStatus::Closed;

        assert_eq!(
            quote_mint(&market, 0, USDC),
            Err(MarketMathError::MarketNotOpen)
        );
    }

    #[test]
    fn zero_losing_pool_still_pays_winning_ticket_after_fee() {
        let mut market = MarketState::new(1, 2, 100, USDC);
        let quote = market.record_stake(0, 10 * USDC).unwrap();
        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(0);

        let payout = calculate_payout(&ticket(1, 0, quote), &market).unwrap();

        assert_eq!(payout.gross_pool, 10 * USDC);
        assert_eq!(payout.platform_fee, 100_000);
        assert_eq!(payout.payout_amount, 9_900_000);
    }

    #[test]
    fn no_winner_or_duplicate_claim_fails() {
        let mut market = MarketState::new(1, 2, 0, USDC);
        let quote = market.record_stake(0, USDC).unwrap();
        market.status = MarketStatus::Resolved;
        let mut claimed = ticket(1, 0, quote);
        claimed.claimed = true;

        assert_eq!(
            calculate_payout(&ticket(1, 0, quote), &market),
            Err(MarketMathError::MissingWinningOutcome)
        );
        market.winning_outcome = Some(0);
        assert_eq!(
            calculate_payout(&claimed, &market),
            Err(MarketMathError::AlreadyClaimed)
        );
    }

    #[test]
    fn resale_moves_payout_right_to_current_owner() {
        let mut market = MarketState::new(1, 2, 0, USDC);
        let quote = market.record_stake(0, USDC).unwrap();
        let mut sold = ticket(1, 0, quote);
        sold.transfer_payout_right_to(TEST_BUYER);
        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(0);

        let payout = calculate_payout(&sold, &market).unwrap();

        assert_eq!(sold.original_caller, TEST_OWNER);
        assert_eq!(sold.current_owner, TEST_BUYER);
        assert_eq!(payout.payout_amount, USDC);
    }

    #[test]
    fn fee_rounding_is_floor_deterministic() {
        assert_eq!(calculate_platform_fee(101, 250).unwrap(), 2);
        assert_eq!(calculate_platform_fee(100, 250).unwrap(), 2);
    }

    #[test]
    fn very_small_stake_respects_minimum() {
        let market = MarketState::new(1, 2, 0, USDC);

        assert_eq!(
            quote_mint(&market, 0, 1),
            Err(MarketMathError::StakeBelowMinimum {
                stake: 1,
                min_stake: USDC
            })
        );
    }

    #[test]
    fn very_large_stake_overflow_is_rejected() {
        let mut market = MarketState::new(1, 2, 0, 1);
        market.outcome_mut(0).unwrap().total_stake = Amount::MAX;

        assert_eq!(quote_mint(&market, 0, 1), Err(MarketMathError::Overflow));
    }
}
