use super::settlement::{validate_live_fresh_buy, validate_open_round};
use super::types::*;
use crate::Amount;

pub fn quote_buy(
    curve: &CurveState,
    usdc_in: Amount,
    buy_fee_bps: u16,
    min_tickets_out: Amount,
) -> Result<BuyQuote, CryptoRoundError> {
    validate_amount(usdc_in)?;
    validate_fee_bps(buy_fee_bps)?;

    let fee = calculate_fee(usdc_in, buy_fee_bps)?;
    let net_usdc_in = usdc_in.checked_sub(fee).ok_or(CryptoRoundError::Overflow)?;
    validate_amount(net_usdc_in)?;

    quote_buy_net(curve, usdc_in, fee, net_usdc_in, min_tickets_out)
}

fn quote_buy_net(
    curve: &CurveState,
    usdc_in: Amount,
    fee: Amount,
    net_usdc_in: Amount,
    min_tickets_out: Amount,
) -> Result<BuyQuote, CryptoRoundError> {
    let k = checked_mul(curve.virtual_usdc, curve.virtual_ticket)?;
    let new_virtual_usdc = curve
        .virtual_usdc
        .checked_add(net_usdc_in)
        .ok_or(CryptoRoundError::Overflow)?;
    let new_virtual_ticket = checked_div(k, new_virtual_usdc)?;
    let tickets_out = curve
        .virtual_ticket
        .checked_sub(new_virtual_ticket)
        .ok_or(CryptoRoundError::Overflow)?;

    if tickets_out < min_tickets_out {
        return Err(CryptoRoundError::SlippageExceeded {
            actual: tickets_out,
            minimum: min_tickets_out,
        });
    }

    Ok(BuyQuote {
        usdc_in,
        fee,
        net_usdc_in,
        tickets_out,
        old_virtual_usdc: curve.virtual_usdc,
        old_virtual_ticket: curve.virtual_ticket,
        new_virtual_usdc,
        new_virtual_ticket,
        price_after: price_from_reserves(new_virtual_usdc, new_virtual_ticket)?,
    })
}

pub fn apply_fresh_buy(
    round: &mut RoundState,
    side: Side,
    quote: BuyQuote,
    lot_id: u64,
    owner: String,
    now_ts: i64,
) -> Result<PositionLot, CryptoRoundError> {
    validate_live_fresh_buy(round, now_ts)?;
    let market_id = round.market_id;
    let round_id = round.round_id;
    let curve = round.curve_mut(side);
    apply_buy_to_curve(curve, quote)?;
    PositionLot::new(
        lot_id,
        round,
        side,
        owner,
        quote.tickets_out,
        quote.usdc_in,
        now_ts,
    )
    .map(|mut lot| {
        lot.market_id = market_id;
        lot.round_id = round_id;
        lot
    })
}

pub fn submit_opening_order(
    aggregate: &mut OpeningAggregate,
    user: String,
    net_usdc: Amount,
    wallet_cap: Amount,
) -> Result<OpeningOrder, CryptoRoundError> {
    validate_amount(net_usdc)?;
    if net_usdc > wallet_cap {
        return Err(CryptoRoundError::OpeningWalletCapExceeded {
            amount: net_usdc,
            cap: wallet_cap,
        });
    }
    if aggregate.finalized {
        return Err(CryptoRoundError::OpeningAggregateAlreadyFinalized);
    }
    aggregate.total_net_usdc = aggregate
        .total_net_usdc
        .checked_add(net_usdc)
        .ok_or(CryptoRoundError::Overflow)?;
    Ok(OpeningOrder {
        round_id: aggregate.round_id,
        user,
        side: aggregate.side,
        net_usdc,
        claimed: false,
    })
}

pub fn finalize_opening_side(
    round: &mut RoundState,
    aggregate: &mut OpeningAggregate,
    min_tickets_out: Amount,
    now_ts: i64,
) -> Result<BuyQuote, CryptoRoundError> {
    if now_ts < round.batch_until {
        return Err(CryptoRoundError::OpeningBatchActive {
            now_ts,
            batch_until: round.batch_until,
        });
    }
    if aggregate.finalized {
        return Err(CryptoRoundError::OpeningAggregateAlreadyFinalized);
    }
    validate_amount(aggregate.total_net_usdc)?;

    let curve = round.curve(aggregate.side);
    let quote = quote_buy_net(
        curve,
        aggregate.total_net_usdc,
        0,
        aggregate.total_net_usdc,
        min_tickets_out,
    )?;
    apply_buy_to_curve(round.curve_mut(aggregate.side), quote)?;
    aggregate.total_tickets_out = quote.tickets_out;
    aggregate.finalized = true;
    Ok(quote)
}

pub fn claim_opening_order(
    round: &RoundState,
    aggregate: &OpeningAggregate,
    order: &mut OpeningOrder,
    lot_id: u64,
    now_ts: i64,
) -> Result<PositionLot, CryptoRoundError> {
    if !aggregate.finalized {
        return Err(CryptoRoundError::OpeningAggregateNotFinalized);
    }
    if order.claimed {
        return Err(CryptoRoundError::OpeningOrderAlreadyClaimed);
    }
    if order.side != aggregate.side {
        return Err(CryptoRoundError::OpeningSideMismatch);
    }
    let ticket_amount = checked_mul_div(
        aggregate.total_tickets_out,
        order.net_usdc,
        aggregate.total_net_usdc,
    )?;
    order.claimed = true;
    PositionLot::new(
        lot_id,
        round,
        order.side,
        order.user.clone(),
        ticket_amount,
        order.net_usdc,
        now_ts,
    )
}

pub fn list_lot(
    round: &RoundState,
    lot: &mut PositionLot,
    listed_price: Amount,
    now_ts: i64,
) -> Result<(), CryptoRoundError> {
    validate_open_round(round, now_ts)?;
    validate_lot_for_round(round, lot)?;
    validate_amount(listed_price)?;
    if lot.claimed {
        return Err(CryptoRoundError::LotAlreadyClaimed);
    }
    if lot.listed {
        return Err(CryptoRoundError::LotAlreadyListed);
    }
    lot.listed = true;
    lot.listed_price = listed_price;
    Ok(())
}

pub fn cancel_listing(
    round: &RoundState,
    lot: &mut PositionLot,
    now_ts: i64,
) -> Result<(), CryptoRoundError> {
    validate_open_round(round, now_ts)?;
    validate_lot_for_round(round, lot)?;
    if !lot.listed {
        return Err(CryptoRoundError::LotNotListed);
    }
    lot.listed = false;
    lot.listed_price = 0;
    Ok(())
}

pub fn quote_listing_buy(
    lot: &PositionLot,
    now_ts: i64,
    resale_fee_bps: u16,
    max_price: Amount,
) -> Result<ListingQuote, CryptoRoundError> {
    if !lot.listed {
        return Err(CryptoRoundError::LotNotListed);
    }
    if lot.listed_price > max_price {
        return Err(CryptoRoundError::ListedPriceExceedsMax {
            listed_price: lot.listed_price,
            max_price,
        });
    }
    validate_fee_bps(resale_fee_bps)?;
    let resale_fee = calculate_fee(lot.listed_price, resale_fee_bps)?;
    let early_flip_fee = calculate_fee(lot.listed_price, early_flip_fee_bps(lot, now_ts))?;
    let seller_receives = lot
        .listed_price
        .checked_sub(resale_fee)
        .and_then(|amount| amount.checked_sub(early_flip_fee))
        .ok_or(CryptoRoundError::Overflow)?;
    Ok(ListingQuote {
        listed_price: lot.listed_price,
        resale_fee,
        early_flip_fee,
        seller_receives,
    })
}

pub fn buy_listing(
    round: &mut RoundState,
    lot: &mut PositionLot,
    buyer: String,
    quote: ListingQuote,
    now_ts: i64,
) -> Result<(), CryptoRoundError> {
    validate_open_round(round, now_ts)?;
    validate_lot_for_round(round, lot)?;
    if buyer == lot.current_owner {
        return Err(CryptoRoundError::BuyerIsSeller);
    }
    if !lot.listed {
        return Err(CryptoRoundError::LotNotListed);
    }
    if lot.listed_price != quote.listed_price {
        return Err(CryptoRoundError::QuoteStale);
    }

    round.round_bonus_usdc = round
        .round_bonus_usdc
        .checked_add(quote.early_flip_fee)
        .ok_or(CryptoRoundError::Overflow)?;
    lot.current_owner = buyer;
    lot.listed = false;
    lot.listed_price = 0;
    lot.last_transfer_at = now_ts;
    Ok(())
}

fn apply_buy_to_curve(curve: &mut CurveState, quote: BuyQuote) -> Result<(), CryptoRoundError> {
    ensure_quote_matches_buy(curve, quote)?;
    curve.virtual_usdc = quote.new_virtual_usdc;
    curve.virtual_ticket = quote.new_virtual_ticket;
    curve.real_usdc = curve
        .real_usdc
        .checked_add(quote.net_usdc_in)
        .ok_or(CryptoRoundError::Overflow)?;
    curve.ticket_supply = curve
        .ticket_supply
        .checked_add(quote.tickets_out)
        .ok_or(CryptoRoundError::Overflow)?;
    Ok(())
}

fn early_flip_fee_bps(lot: &PositionLot, now_ts: i64) -> u16 {
    let age = now_ts.saturating_sub(lot.created_at);
    if age < 10 {
        500
    } else if age < 30 {
        300
    } else if age < 60 {
        100
    } else {
        0
    }
}

fn ensure_quote_matches_buy(curve: &CurveState, quote: BuyQuote) -> Result<(), CryptoRoundError> {
    if curve.virtual_usdc != quote.old_virtual_usdc
        || curve.virtual_ticket != quote.old_virtual_ticket
    {
        return Err(CryptoRoundError::QuoteStale);
    }
    Ok(())
}
