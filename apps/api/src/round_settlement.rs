use std::collections::BTreeMap;

use basingamarket_db::{MarketRow, TicketRow};
use basingamarket_domain::{crypto_rounds::MarketStreamConfig, TicketStatus, SCALE};

use crate::{crypto_projection, ApiError, AppState, MarketPriceHeaderResponse};

#[derive(Debug, Clone, Copy, Default)]
struct RoundSideSettlement {
    real_usdc: u128,
    ticket_supply: u128,
}

#[derive(Debug)]
struct RoundSettlementQuote {
    winning_outcome: Option<u8>,
    payout_per_ticket: Option<u128>,
    refund_per_ticket_by_outcome: BTreeMap<u8, u128>,
}

pub(crate) async fn settle_market_round_if_ready(
    state: &AppState,
    market: &MarketRow,
    round_id: u64,
    price_header: Option<&MarketPriceHeaderResponse>,
) -> Result<bool, ApiError> {
    let Some(header) = price_header else {
        return Ok(false);
    };
    if header.price_display_state != "closed" {
        return Ok(false);
    }
    if header.round_id.parse::<u64>().ok() != Some(round_id) {
        return Ok(false);
    }
    let Some(stream) = crypto_projection::phase_one_stream_for_market_id(market.market_id) else {
        return Ok(false);
    };
    let tickets: Vec<_> = state
        .store
        .get_tickets_for_market(market.market_id)
        .await
        .into_iter()
        .filter(|ticket| ticket.round_id == round_id)
        .collect();
    if tickets.is_empty() {
        return Ok(false);
    }
    let quote =
        round_settlement_quote(state, market.market_id, round_id, &tickets, &stream, header)
            .await?;
    let updated = state
        .store
        .settle_round_tickets(
            market.market_id,
            round_id,
            quote.winning_outcome,
            quote.payout_per_ticket,
            quote.refund_per_ticket_by_outcome,
            chrono::Utc::now(),
        )
        .await
        .map_err(ApiError::internal)?;

    Ok(updated > 0)
}

async fn round_settlement_quote(
    state: &AppState,
    market_id: u64,
    round_id: u64,
    tickets: &[TicketRow],
    stream: &MarketStreamConfig,
    price_header: &MarketPriceHeaderResponse,
) -> Result<RoundSettlementQuote, ApiError> {
    let mut sides = round_side_settlement_from_tickets(tickets);
    let cash_up = state
        .store
        .cash_trade_side_volume(market_id, round_id, "UP")
        .await;
    let cash_down = state
        .store
        .cash_trade_side_volume(market_id, round_id, "DOWN")
        .await;
    if cash_up > 0 || cash_down > 0 {
        if let Some(up) = sides.get_mut(&0) {
            up.real_usdc = cash_up;
        }
        if let Some(down) = sides.get_mut(&1) {
            down.real_usdc = cash_down;
        }
    }

    let winning_outcome = winning_outcome_from_header(price_header)?;
    let round_is_active = sides
        .get(&0)
        .map(|side| side.real_usdc >= stream.min_side_real_usdc)
        .unwrap_or(false)
        && sides
            .get(&1)
            .map(|side| side.real_usdc >= stream.min_side_real_usdc)
            .unwrap_or(false);

    if winning_outcome.is_none() || !round_is_active {
        return Ok(RoundSettlementQuote {
            winning_outcome: None,
            payout_per_ticket: None,
            refund_per_ticket_by_outcome: refund_per_ticket_by_outcome(&sides)?,
        });
    }

    let winning_outcome = winning_outcome.unwrap_or(0);
    let winning_supply = sides
        .get(&winning_outcome)
        .map(|side| side.ticket_supply)
        .unwrap_or(0);
    let payout_per_ticket = if winning_supply == 0 {
        Some(0)
    } else {
        Some(checked_mul_div(
            total_real_usdc(&sides)?,
            SCALE,
            winning_supply,
        )?)
    };

    Ok(RoundSettlementQuote {
        winning_outcome: Some(winning_outcome),
        payout_per_ticket,
        refund_per_ticket_by_outcome: BTreeMap::new(),
    })
}

fn round_side_settlement_from_tickets(tickets: &[TicketRow]) -> BTreeMap<u8, RoundSideSettlement> {
    let mut sides = BTreeMap::from([
        (0, RoundSideSettlement::default()),
        (1, RoundSideSettlement::default()),
    ]);
    for ticket in tickets {
        if matches!(ticket.status, TicketStatus::Cancelled) {
            continue;
        }
        let side = sides.entry(ticket.outcome_id).or_default();
        side.real_usdc = side.real_usdc.saturating_add(ticket.cost_basis_usdc);
        side.ticket_supply = side.ticket_supply.saturating_add(ticket.reward_shares);
    }
    sides
}

fn winning_outcome_from_header(
    price_header: &MarketPriceHeaderResponse,
) -> Result<Option<u8>, ApiError> {
    let open_price = price_header
        .open_price
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("settlement_unavailable", "Open price yok."))?
        .parse::<u128>()
        .map_err(ApiError::internal)?;
    let close_price = price_header
        .close_price
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("settlement_unavailable", "Close price yok."))?
        .parse::<u128>()
        .map_err(ApiError::internal)?;

    Ok(match close_price.cmp(&open_price) {
        std::cmp::Ordering::Greater => Some(0),
        std::cmp::Ordering::Less => Some(1),
        std::cmp::Ordering::Equal => None,
    })
}

fn refund_per_ticket_by_outcome(
    sides: &BTreeMap<u8, RoundSideSettlement>,
) -> Result<BTreeMap<u8, u128>, ApiError> {
    let mut refunds = BTreeMap::new();
    for (outcome_id, side) in sides {
        let refund = if side.ticket_supply == 0 {
            0
        } else {
            checked_mul_div(side.real_usdc, SCALE, side.ticket_supply)?
        };
        refunds.insert(*outcome_id, refund);
    }
    Ok(refunds)
}

fn total_real_usdc(sides: &BTreeMap<u8, RoundSideSettlement>) -> Result<u128, ApiError> {
    sides.values().try_fold(0_u128, |sum, side| {
        sum.checked_add(side.real_usdc).ok_or_else(|| {
            ApiError::bad_request("settlement_overflow", "Settlement amount gecersiz.")
        })
    })
}

fn checked_mul_div(left: u128, right: u128, divisor: u128) -> Result<u128, ApiError> {
    if divisor == 0 {
        return Err(ApiError::bad_request(
            "settlement_divide_by_zero",
            "Settlement supply gecersiz.",
        ));
    }
    left.checked_mul(right)
        .and_then(|value| value.checked_div(divisor))
        .ok_or_else(|| ApiError::bad_request("settlement_overflow", "Settlement amount gecersiz."))
}
