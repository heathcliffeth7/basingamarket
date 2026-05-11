use std::collections::HashSet;

use super::*;
use crate::Amount;

const USDC: Amount = USDC_BASE_UNITS;

fn phase_one_eth_round() -> (MarketStreamConfig, RoundState) {
    let config = protocol_stream_configs_for_phase(1).unwrap()[1].clone();
    let mut round = RoundState::new(&config, 100, 30_000, 30_300);
    round.start_price = Some(2_000 * USDC);
    (config, round)
}

fn fresh_lot(
    round: &mut RoundState,
    side: Side,
    config: &MarketStreamConfig,
    lot_id: u64,
    owner: &str,
    usdc: Amount,
) -> PositionLot {
    let quote = quote_buy(round.curve(side), usdc, config.buy_fee_bps, 1).unwrap();
    let buy_ts = round.batch_until + 1;
    apply_fresh_buy(round, side, quote, lot_id, owner.to_owned(), buy_ts).unwrap()
}

fn active_round_with_lots() -> (MarketStreamConfig, RoundState, PositionLot, PositionLot) {
    let (config, mut round) = phase_one_eth_round();
    let up = fresh_lot(&mut round, Side::Up, &config, 1, "alice", 100 * USDC);
    let down = fresh_lot(&mut round, Side::Down, &config, 2, "bob", 60 * USDC);
    (config, round, up, down)
}

#[test]
fn fresh_buy_updates_curve_and_creates_lot() {
    let (config, mut round) = phase_one_eth_round();
    let quote = quote_buy(&round.up_curve, 100 * USDC, config.buy_fee_bps, 1).unwrap();
    let price_before = round.up_curve.fresh_price().unwrap();
    let now_ts = round.batch_until + 1;

    let lot = apply_fresh_buy(&mut round, Side::Up, quote, 1, "alice".to_owned(), now_ts).unwrap();

    assert_eq!(quote.fee, 500_000);
    assert_eq!(round.up_curve.real_usdc, 99_500_000);
    assert_eq!(round.up_curve.ticket_supply, quote.tickets_out);
    assert_eq!(lot.ticket_amount, quote.tickets_out);
    assert!(round.up_curve.fresh_price().unwrap() > price_before);
}

#[test]
fn multiple_up_buys_make_later_entry_more_expensive() {
    let (config, mut round) = phase_one_eth_round();
    let first = quote_buy(&round.up_curve, 100 * USDC, config.buy_fee_bps, 1).unwrap();
    let now_ts = round.batch_until + 1;
    apply_fresh_buy(&mut round, Side::Up, first, 1, "alice".to_owned(), now_ts).unwrap();
    let second = quote_buy(&round.up_curve, 100 * USDC, config.buy_fee_bps, 1).unwrap();

    assert!(second.tickets_out < first.tickets_out);
}

#[test]
fn opening_batch_distributes_same_average_entry_prorata() {
    let (config, mut round) = phase_one_eth_round();
    let mut aggregate = OpeningAggregate::new(round.round_id, Side::Up);
    let mut alice = submit_opening_order(
        &mut aggregate,
        "alice".to_owned(),
        100 * USDC,
        config.opening_batch_wallet_cap_usdc,
    )
    .unwrap();
    let mut bob = submit_opening_order(
        &mut aggregate,
        "bob".to_owned(),
        200 * USDC,
        config.opening_batch_wallet_cap_usdc,
    )
    .unwrap();

    let batch_until = round.batch_until;
    finalize_opening_side(&mut round, &mut aggregate, 1, batch_until).unwrap();
    let alice_lot = claim_opening_order(&round, &aggregate, &mut alice, 1, batch_until).unwrap();
    let bob_lot = claim_opening_order(&round, &aggregate, &mut bob, 2, batch_until).unwrap();

    assert_eq!(alice_lot.ticket_amount * 2, bob_lot.ticket_amount);
    assert_eq!(alice_lot.avg_entry_price, bob_lot.avg_entry_price);
    let claimed_tickets = alice_lot.ticket_amount + bob_lot.ticket_amount;
    assert!(claimed_tickets <= aggregate.total_tickets_out);
    assert!(aggregate.total_tickets_out - claimed_tickets <= 1);
}

#[test]
fn opening_wallet_cap_is_enforced() {
    let (config, round) = phase_one_eth_round();
    let mut aggregate = OpeningAggregate::new(round.round_id, Side::Up);
    let err = submit_opening_order(
        &mut aggregate,
        "bot".to_owned(),
        config.opening_batch_wallet_cap_usdc + 1,
        config.opening_batch_wallet_cap_usdc,
    )
    .unwrap_err();

    assert!(matches!(
        err,
        CryptoRoundError::OpeningWalletCapExceeded { .. }
    ));
}

#[test]
fn listing_transfer_does_not_change_round_vault_or_curve() {
    let (config, mut round, mut lot, _) = active_round_with_lots();
    let vault_before = round.up_curve.real_usdc + round.down_curve.real_usdc;
    let supply_before = round.up_curve.ticket_supply;
    list_lot(&round, &mut lot, 80 * USDC, round.batch_until + 2).unwrap();
    let now_ts = round.batch_until + 3;
    let quote = quote_listing_buy(&lot, now_ts, config.resale_fee_bps, 80 * USDC).unwrap();

    buy_listing(&mut round, &mut lot, "carol".to_owned(), quote, now_ts).unwrap();

    assert_eq!(lot.current_owner, "carol");
    assert!(!lot.listed);
    assert_eq!(
        round.up_curve.real_usdc + round.down_curve.real_usdc,
        vault_before
    );
    assert_eq!(round.up_curve.ticket_supply, supply_before);
    assert!(round.round_bonus_usdc > 0);
}

#[test]
fn listed_but_unsold_lot_stays_with_seller_after_close() {
    let (_, round, mut lot, _) = active_round_with_lots();
    list_lot(&round, &mut lot, 80 * USDC, round.batch_until + 2).unwrap();

    assert_eq!(lot.current_owner, "alice");
    assert!(lot.listed);
}

#[test]
fn current_owner_gets_winning_claim_after_resale() {
    let (config, mut round, mut up, _) = active_round_with_lots();
    list_lot(&round, &mut up, 80 * USDC, round.batch_until + 2).unwrap();
    let now_ts = round.batch_until + 70;
    let quote = quote_listing_buy(&up, now_ts, config.resale_fee_bps, 80 * USDC).unwrap();
    buy_listing(&mut round, &mut up, "carol".to_owned(), quote, now_ts).unwrap();

    resolve_round(&mut round, 2_010 * USDC, &config).unwrap();
    let claim = quote_claim(&round, &up).unwrap();

    assert_eq!(up.current_owner, "carol");
    assert!(claim.amount > 0);
}

#[test]
fn losing_side_cannot_claim() {
    let (config, mut round, _, down) = active_round_with_lots();
    resolve_round(&mut round, 2_010 * USDC, &config).unwrap();

    assert_eq!(
        quote_claim(&round, &down).unwrap_err(),
        CryptoRoundError::LosingLot
    );
}

#[test]
fn inactive_single_side_round_voids() {
    let (config, mut round) = phase_one_eth_round();
    fresh_lot(&mut round, Side::Up, &config, 1, "alice", 100 * USDC);

    assert_eq!(
        resolve_round(&mut round, 2_010 * USDC, &config).unwrap(),
        None
    );
    assert_eq!(round.status, RoundStatus::Voided);
}

#[test]
fn losing_only_round_sends_vault_to_protocol_when_winning_side_empty() {
    let (config, mut round) = phase_one_eth_round();
    let down = fresh_lot(&mut round, Side::Down, &config, 1, "alice", 100 * USDC);
    let gross_vault = round.down_curve.real_usdc + round.round_bonus_usdc;

    assert_eq!(
        resolve_round(&mut round, 2_010 * USDC, &config).unwrap(),
        Some(Side::Up)
    );
    assert_eq!(round.status, RoundStatus::Resolved);
    assert_eq!(round.winning_side, Some(Side::Up));
    assert_eq!(round.settlement_vault, 0);
    assert_eq!(round.payout_per_ticket, 0);
    assert_eq!(round.protocol_vault_amount, gross_vault);
    assert_eq!(
        quote_claim(&round, &down).unwrap_err(),
        CryptoRoundError::LosingLot
    );
}

#[test]
fn tie_void_refund_is_side_reserve_prorata() {
    let (config, mut round, up, down) = active_round_with_lots();

    assert_eq!(
        resolve_round(&mut round, 2_000 * USDC, &config).unwrap(),
        None
    );
    let up_refund = quote_void_refund(&round, &up).unwrap();
    let down_refund = quote_void_refund(&round, &down).unwrap();

    assert!(up_refund.amount <= round.up_curve.real_usdc);
    assert!(down_refund.amount <= round.down_curve.real_usdc);
    assert_eq!(
        quote_claim(&round, &up).unwrap_err(),
        CryptoRoundError::RoundNotResolved
    );
}

#[test]
fn double_claim_fails() {
    let (config, mut round, mut up, _) = active_round_with_lots();
    resolve_round(&mut round, 2_010 * USDC, &config).unwrap();
    mark_lot_claimed(&mut up).unwrap();

    assert_eq!(
        quote_claim(&round, &up).unwrap_err(),
        CryptoRoundError::LotAlreadyClaimed
    );
}

#[test]
fn payout_total_does_not_exceed_vault() {
    let (config, mut round) = phase_one_eth_round();
    let first = fresh_lot(&mut round, Side::Up, &config, 1, "alice", 100 * USDC);
    let second = fresh_lot(&mut round, Side::Up, &config, 2, "ben", 30 * USDC);
    fresh_lot(&mut round, Side::Down, &config, 3, "dina", 90 * USDC);
    resolve_round(&mut round, 2_010 * USDC, &config).unwrap();

    let total_claim =
        quote_claim(&round, &first).unwrap().amount + quote_claim(&round, &second).unwrap().amount;

    assert!(total_claim <= round.settlement_vault);
}

#[test]
fn end_at_after_fresh_buy_fails() {
    let (config, mut round) = phase_one_eth_round();
    let quote = quote_buy(&round.up_curve, 100 * USDC, config.buy_fee_bps, 1).unwrap();
    let end_at = round.end_at;

    assert_eq!(
        apply_fresh_buy(&mut round, Side::Up, quote, 1, "alice".to_owned(), end_at).unwrap_err(),
        CryptoRoundError::RoundClosed
    );
}

#[test]
fn end_at_after_listing_buy_fails() {
    let (config, mut round, mut lot, _) = active_round_with_lots();
    list_lot(&round, &mut lot, 80 * USDC, round.batch_until + 2).unwrap();
    let quote_ts = round.batch_until + 70;
    let end_at = round.end_at;
    let quote = quote_listing_buy(&lot, quote_ts, config.resale_fee_bps, 80 * USDC).unwrap();

    assert_eq!(
        buy_listing(&mut round, &mut lot, "carol".to_owned(), quote, end_at).unwrap_err(),
        CryptoRoundError::RoundClosed
    );
}

#[test]
fn binance_snapshot_time_must_match_round_start() {
    assert_eq!(validate_binance_snapshot_time(30_000_000, 30_000), Ok(()));
    assert!(matches!(
        validate_binance_snapshot_time(30_001_000, 30_000),
        Err(CryptoRoundError::InvalidBinanceSnapshotTime { .. })
    ));
}

#[test]
fn buy_slippage_min_tickets_fail() {
    let curve = CurveState::default_depth();
    let err = quote_buy(&curve, USDC, DEFAULT_BUY_FEE_BPS, Amount::MAX).unwrap_err();

    assert!(matches!(err, CryptoRoundError::SlippageExceeded { .. }));
}

#[test]
fn default_phase_one_streams_are_btc_eth_sol_5m_and_1m() {
    let streams = protocol_streams_for_phase(1).unwrap();

    assert_eq!(streams.len(), 6);
    assert_eq!(streams[0].asset, Asset::Btc);
    assert_eq!(streams[1].asset, Asset::Eth);
    assert_eq!(streams[2].asset, Asset::Sol);
    assert_eq!(streams[3].asset, Asset::Btc);
    assert_eq!(streams[4].asset, Asset::Eth);
    assert_eq!(streams[5].asset, Asset::Sol);
    assert!(streams[..3]
        .iter()
        .all(|stream| stream.duration_seconds == DURATION_5M_SECONDS));
    assert!(streams[3..]
        .iter()
        .all(|stream| stream.duration_seconds == DURATION_1M_SECONDS));
    assert_eq!(
        streams[0].settlement_source.to_string(),
        "Binance Spot BTCUSDT 5m"
    );
    assert_eq!(
        streams[3].settlement_source.to_string(),
        "Binance Spot BTCUSDT 1m"
    );
}

#[test]
fn all_phases_include_thirteen_streams() {
    let streams = default_protocol_streams();

    assert_eq!(streams.len(), 13);
    assert_eq!(streams[12].market_id, 10);
    assert_eq!(streams[12].asset, Asset::Doge);
    assert_eq!(streams[12].duration_seconds, DURATION_15M_SECONDS);
}

#[test]
fn round_id_and_window_are_deterministic() {
    let now_ts = 1_700_000_123;
    let round_id = current_round_id(now_ts, DURATION_5M_SECONDS).unwrap();
    let (start_at, end_at) = round_window(round_id, DURATION_5M_SECONDS).unwrap();

    assert_eq!(round_id, 5_666_667);
    assert!(start_at <= now_ts);
    assert_eq!(end_at - start_at, DURATION_5M_SECONDS as i64);
}

#[test]
fn existing_round_is_not_planned_again() {
    let streams = protocol_stream_configs_for_phase(1).unwrap();
    let round_id = current_round_id(1_700_000_123, DURATION_5M_SECONDS).unwrap();
    let existing = HashSet::from([(1, round_id)]);

    let plans = plan_round_openings(&streams, &existing, 1_700_000_123).unwrap();

    assert_eq!(plans.len(), 5);
    assert!(plans.iter().all(|plan| plan.market_id != 1));
}

#[test]
fn missing_current_rounds_get_open_plans() {
    let streams = protocol_stream_configs_for_phase(1).unwrap();
    let plans = plan_round_openings(&streams, &HashSet::new(), 1_700_000_123).unwrap();

    assert_eq!(plans.len(), 6);
    assert_eq!(plans[0].market_id, 1);
    assert_eq!(plans[0].asset, Asset::Btc);
    assert_eq!(
        plans[0].batch_until - plans[0].start_at,
        DEFAULT_OPENING_BATCH_SECONDS
    );
}

#[test]
fn lazy_open_allows_first_buy_inside_grace_window() {
    let streams = protocol_stream_configs_for_phase(1).unwrap();
    let plan = plan_lazy_round_opening(
        &streams[0],
        &HashSet::new(),
        1_700_000_123,
        DEFAULT_ACTIVATION_GRACE_SECONDS,
    )
    .unwrap()
    .unwrap();

    assert_eq!(plan.start_at, 1_700_000_100);
    assert_eq!(plan.end_at, 1_700_000_400);
}

#[test]
fn lazy_open_rejects_first_buy_after_grace_window() {
    let streams = protocol_stream_configs_for_phase(1).unwrap();
    let err = plan_lazy_round_opening(
        &streams[0],
        &HashSet::new(),
        1_700_000_131,
        DEFAULT_ACTIVATION_GRACE_SECONDS,
    )
    .unwrap_err();

    assert!(matches!(
        err,
        CryptoRoundError::RoundOpenWindowExpired { .. }
    ));
}

#[test]
fn resolve_time_requires_close_lag() {
    let end_at = 1_700_000_400;
    let err = validate_resolve_time(end_at + 1, end_at, DEFAULT_CLOSE_LAG_SECONDS).unwrap_err();

    assert!(matches!(err, CryptoRoundError::ResolveTooEarly { .. }));
    assert!(validate_resolve_time(end_at + 2, end_at, DEFAULT_CLOSE_LAG_SECONDS).is_ok());
}
