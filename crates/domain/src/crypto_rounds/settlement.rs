use super::types::*;
use crate::{Amount, SCALE};

pub fn resolve_outcome(start_price: Amount, end_price: Amount) -> Option<Side> {
    match end_price.cmp(&start_price) {
        std::cmp::Ordering::Greater => Some(Side::Up),
        std::cmp::Ordering::Less => Some(Side::Down),
        std::cmp::Ordering::Equal => None,
    }
}

pub fn resolve_round(
    round: &mut RoundState,
    end_price: Amount,
    config: &MarketStreamConfig,
) -> Result<Option<Side>, CryptoRoundError> {
    if !matches!(round.status, RoundStatus::Open | RoundStatus::Closed) {
        return Err(CryptoRoundError::RoundNotOpen);
    }

    let start_price = round
        .start_price
        .ok_or(CryptoRoundError::MissingBinanceSnapshot)?;
    round.end_price = Some(end_price);

    let Some(winning_side) = resolve_outcome(start_price, end_price) else {
        round.status = RoundStatus::Voided;
        round.winning_side = None;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        return Ok(None);
    };

    let gross_vault = round
        .up_curve
        .real_usdc
        .checked_add(round.down_curve.real_usdc)
        .and_then(|amount| amount.checked_add(round.round_bonus_usdc))
        .ok_or(CryptoRoundError::Overflow)?;
    let winning_supply = round.curve(winning_side).ticket_supply;
    if winning_supply == 0 {
        round.status = RoundStatus::Resolved;
        round.winning_side = Some(winning_side);
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = gross_vault;
        return Ok(Some(winning_side));
    }

    if let Err(CryptoRoundError::RoundNotActive { .. }) = ensure_round_active(round, config) {
        round.status = RoundStatus::Voided;
        round.winning_side = None;
        round.settlement_vault = 0;
        round.payout_per_ticket = 0;
        round.protocol_vault_amount = 0;
        return Ok(None);
    }

    let settlement_fee = calculate_fee(gross_vault, config.settlement_fee_bps)?;
    let settlement_vault = gross_vault
        .checked_sub(settlement_fee)
        .ok_or(CryptoRoundError::Overflow)?;

    round.status = RoundStatus::Resolved;
    round.winning_side = Some(winning_side);
    round.settlement_vault = settlement_vault;
    round.payout_per_ticket = checked_mul_div(settlement_vault, SCALE, winning_supply)?;
    round.protocol_vault_amount = settlement_fee;
    Ok(Some(winning_side))
}

pub fn quote_claim(round: &RoundState, lot: &PositionLot) -> Result<ClaimQuote, CryptoRoundError> {
    validate_lot_for_round(round, lot)?;
    if round.status != RoundStatus::Resolved {
        return Err(CryptoRoundError::RoundNotResolved);
    }
    if lot.claimed {
        return Err(CryptoRoundError::LotAlreadyClaimed);
    }
    let winning_side = round
        .winning_side
        .ok_or(CryptoRoundError::RoundNotResolved)?;
    if lot.side != winning_side {
        return Err(CryptoRoundError::LosingLot);
    }
    if round.curve(winning_side).ticket_supply == 0 {
        return Err(CryptoRoundError::ZeroTicketSupply);
    }
    let amount = checked_mul_div(lot.ticket_amount, round.payout_per_ticket, SCALE)?;
    Ok(ClaimQuote {
        side: lot.side,
        ticket_amount: lot.ticket_amount,
        payout_per_ticket: round.payout_per_ticket,
        amount,
    })
}

pub fn quote_void_refund(
    round: &RoundState,
    lot: &PositionLot,
) -> Result<VoidRefundQuote, CryptoRoundError> {
    validate_lot_for_round(round, lot)?;
    if round.status != RoundStatus::Voided {
        return Err(CryptoRoundError::RoundNotVoided);
    }
    if lot.claimed {
        return Err(CryptoRoundError::LotAlreadyClaimed);
    }
    let curve = round.curve(lot.side);
    if curve.ticket_supply == 0 {
        return Err(CryptoRoundError::ZeroTicketSupply);
    }
    let refund_per_ticket = checked_mul_div(curve.real_usdc, SCALE, curve.ticket_supply)?;
    let amount = checked_mul_div(lot.ticket_amount, refund_per_ticket, SCALE)?;
    Ok(VoidRefundQuote {
        side: lot.side,
        ticket_amount: lot.ticket_amount,
        refund_per_ticket,
        amount,
    })
}

pub fn mark_lot_claimed(lot: &mut PositionLot) -> Result<(), CryptoRoundError> {
    if lot.claimed {
        return Err(CryptoRoundError::LotAlreadyClaimed);
    }
    lot.claimed = true;
    Ok(())
}

pub fn validate_live_fresh_buy(round: &RoundState, now_ts: i64) -> Result<(), CryptoRoundError> {
    validate_open_round(round, now_ts)?;
    if now_ts <= round.batch_until {
        return Err(CryptoRoundError::OpeningBatchActive {
            now_ts,
            batch_until: round.batch_until,
        });
    }
    Ok(())
}

pub fn validate_opening_order_time(
    round: &RoundState,
    now_ts: i64,
) -> Result<(), CryptoRoundError> {
    if now_ts < round.start_at {
        return Err(CryptoRoundError::RoundOpenWindowNotStarted {
            now_ts,
            start_at: round.start_at,
        });
    }
    if now_ts > round.batch_until {
        return Err(CryptoRoundError::OpeningBatchClosed {
            now_ts,
            batch_until: round.batch_until,
        });
    }
    Ok(())
}

pub fn validate_open_round(round: &RoundState, now_ts: i64) -> Result<(), CryptoRoundError> {
    if round.status != RoundStatus::Open {
        return Err(CryptoRoundError::RoundNotOpen);
    }
    if now_ts >= round.end_at {
        return Err(CryptoRoundError::RoundClosed);
    }
    Ok(())
}

pub fn validate_binance_snapshot_time(
    open_time_ms: i64,
    expected_start_at: i64,
) -> Result<(), CryptoRoundError> {
    let expected_open_time_ms = expected_start_at
        .checked_mul(1_000)
        .ok_or(CryptoRoundError::Overflow)?;
    if open_time_ms != expected_open_time_ms {
        return Err(CryptoRoundError::InvalidBinanceSnapshotTime {
            open_time_ms,
            expected_open_time_ms,
        });
    }
    Ok(())
}

pub fn ensure_round_active(
    round: &RoundState,
    config: &MarketStreamConfig,
) -> Result<(), CryptoRoundError> {
    if round.up_curve.real_usdc < config.min_side_real_usdc
        || round.down_curve.real_usdc < config.min_side_real_usdc
    {
        return Err(CryptoRoundError::RoundNotActive {
            up_real_usdc: round.up_curve.real_usdc,
            down_real_usdc: round.down_curve.real_usdc,
            minimum: config.min_side_real_usdc,
        });
    }
    Ok(())
}
