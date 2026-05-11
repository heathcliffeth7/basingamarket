use basingamarket_db::{MarketRow, OutcomeRow};
use basingamarket_domain::{
    crypto_rounds::{
        current_round_id, protocol_stream_configs_for_phase, round_window, Asset,
        MarketStreamConfig, Side, DEFAULT_VIRTUAL_TICKET, DEFAULT_VIRTUAL_USDC,
    },
    Amount, MarketStatus, SCALE,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};

const CURVE_POINT_COUNT: u128 = 18;
const MAX_ROUND_HISTORY_LIMIT: usize = 24;

#[derive(Debug, Deserialize)]
pub struct CurveQuery {
    pub start_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct RoundHistoryQuery {
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CashCurveVolumes {
    pub up: Amount,
    pub down: Amount,
}

#[derive(Debug, Serialize)]
pub struct MarketCurveResponse {
    market_id: String,
    round_id: String,
    duration_seconds: u64,
    updated_at: String,
    sides: Vec<CurveSideResponse>,
    points: Vec<CurvePointResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CurveSideResponse {
    side: &'static str,
    price: String,
    best_entry_price: String,
    best_entry_source: &'static str,
    fresh_mint_price: String,
    listed_best_ask_price: Option<String>,
    last_trade_price: Option<String>,
    token_supply: String,
    market_cap: String,
    liquidity: String,
    volume: String,
    virtual_usdc: String,
    virtual_ticket: String,
}

#[derive(Debug, Serialize)]
pub struct CurvePointResponse {
    ts: i64,
    side: &'static str,
    price: String,
    market_cap: String,
    liquidity: String,
    volume: String,
}

#[derive(Debug, Serialize)]
pub struct RoundHistoryResponse {
    market_id: String,
    duration_seconds: u64,
    rounds: Vec<RoundHistoryItemResponse>,
}

#[derive(Debug, Serialize)]
pub struct RoundHistoryItemResponse {
    round_id: String,
    start_at: i64,
    end_at: i64,
    status: &'static str,
    asset: String,
    asset_image_url: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct CurveMetrics {
    price: Amount,
    token_supply: Amount,
    market_cap: Amount,
    liquidity: Amount,
    volume: Amount,
    virtual_usdc: Amount,
    virtual_ticket: Amount,
}

pub fn market_curve_response(
    market: &MarketRow,
    outcomes: &[OutcomeRow],
    now_ts: i64,
    selected_start_at: Option<i64>,
    cash_volumes: CashCurveVolumes,
) -> Option<MarketCurveResponse> {
    let stream = phase_one_stream_for_market_id(market.market_id)?;
    let live = market.status == MarketStatus::Open;
    let (round_id, start_at, end_at) =
        price_round_window(market, &stream, now_ts, live, selected_start_at)?;
    let up_volume = outcome_volume(outcomes, 0).saturating_add(cash_volumes.up);
    let down_volume = outcome_volume(outcomes, 1).saturating_add(cash_volumes.down);
    let up = side_response(Side::Up, up_volume);
    let down = side_response(Side::Down, down_volume);

    Some(MarketCurveResponse {
        market_id: market.market_id.to_string(),
        round_id: round_id.to_string(),
        duration_seconds: stream.duration_seconds,
        updated_at: Utc::now().to_rfc3339(),
        sides: vec![up.clone(), down.clone()],
        points: curve_points(Side::Up, up_volume, start_at, end_at)
            .into_iter()
            .chain(curve_points(Side::Down, down_volume, start_at, end_at))
            .collect(),
    })
}

pub fn market_curve_round_id(
    market: &MarketRow,
    now_ts: i64,
    selected_start_at: Option<i64>,
) -> Option<u64> {
    let stream = phase_one_stream_for_market_id(market.market_id)?;
    let live = market.status == MarketStatus::Open;
    let (round_id, _, _) = price_round_window(market, &stream, now_ts, live, selected_start_at)?;
    Some(round_id)
}

pub fn round_history_response(
    market: &MarketRow,
    limit: Option<usize>,
    now_ts: i64,
) -> Option<RoundHistoryResponse> {
    let stream = phase_one_stream_for_market_id(market.market_id)?;
    let current = current_round_id(now_ts, stream.duration_seconds).ok()?;
    let limit = limit.unwrap_or(6).clamp(1, MAX_ROUND_HISTORY_LIMIT);
    let first = current.saturating_sub((limit - 1) as u64);
    let mut rounds = Vec::with_capacity(limit);

    for round_id in first..=current {
        let (start_at, end_at) = round_window(round_id, stream.duration_seconds).ok()?;
        rounds.push(RoundHistoryItemResponse {
            round_id: round_id.to_string(),
            start_at,
            end_at,
            status: if round_id == current {
                "open"
            } else {
                "closed"
            },
            asset: stream.asset.to_string(),
            asset_image_url: asset_image_url(stream.asset),
        });
    }

    Some(RoundHistoryResponse {
        market_id: market.market_id.to_string(),
        duration_seconds: stream.duration_seconds,
        rounds,
    })
}

pub fn phase_one_stream_for_market_id(market_id: u64) -> Option<MarketStreamConfig> {
    protocol_stream_configs_for_phase(1)
        .ok()?
        .into_iter()
        .find(|stream| stream.market_id == market_id)
}

pub fn price_round_window(
    market: &MarketRow,
    stream: &MarketStreamConfig,
    now_ts: i64,
    live: bool,
    selected_start_at: Option<i64>,
) -> Option<(u64, i64, i64)> {
    let round_id = if let Some(start_at) = selected_start_at {
        current_round_id(start_at, stream.duration_seconds).ok()?
    } else if live {
        current_round_id(now_ts, stream.duration_seconds).ok()?
    } else {
        let start_at = i64::try_from(market.open_at).ok()?;
        current_round_id(start_at, stream.duration_seconds).ok()?
    };
    let (start_at, end_at) = round_window(round_id, stream.duration_seconds).ok()?;
    Some((round_id, start_at, end_at))
}

pub fn asset_image_url(asset: Asset) -> &'static str {
    match asset {
        Asset::Btc => "/visuals/crypto/btc.svg",
        Asset::Eth => "/visuals/crypto/eth.svg",
        Asset::Sol => "/visuals/crypto/sol.svg",
        Asset::Xrp => "/visuals/crypto/xrp.svg",
        Asset::Doge => "/visuals/crypto/doge.svg",
    }
}

fn side_response(side: Side, volume: Amount) -> CurveSideResponse {
    let metrics = curve_metrics(volume);
    let fresh_mint_price = metrics.price.to_string();
    CurveSideResponse {
        side: side_label(side),
        price: fresh_mint_price.clone(),
        best_entry_price: fresh_mint_price.clone(),
        best_entry_source: "fresh_curve",
        fresh_mint_price: fresh_mint_price.clone(),
        listed_best_ask_price: None,
        last_trade_price: None,
        token_supply: metrics.token_supply.to_string(),
        market_cap: metrics.market_cap.to_string(),
        liquidity: metrics.liquidity.to_string(),
        volume: metrics.volume.to_string(),
        virtual_usdc: metrics.virtual_usdc.to_string(),
        virtual_ticket: metrics.virtual_ticket.to_string(),
    }
}

fn curve_points(
    side: Side,
    final_volume: Amount,
    start_at: i64,
    end_at: i64,
) -> Vec<CurvePointResponse> {
    let span = end_at.saturating_sub(start_at).max(1);
    (0..CURVE_POINT_COUNT)
        .map(|index| {
            let volume = final_volume.saturating_mul(index) / (CURVE_POINT_COUNT - 1);
            let metrics = curve_metrics(volume);
            CurvePointResponse {
                ts: start_at + ((span as u128 * index) / (CURVE_POINT_COUNT - 1)) as i64,
                side: side_label(side),
                price: metrics.price.to_string(),
                market_cap: metrics.market_cap.to_string(),
                liquidity: metrics.liquidity.to_string(),
                volume: metrics.volume.to_string(),
            }
        })
        .collect()
}

fn curve_metrics(volume: Amount) -> CurveMetrics {
    let virtual_usdc = DEFAULT_VIRTUAL_USDC.saturating_add(volume);
    let k = DEFAULT_VIRTUAL_USDC.saturating_mul(DEFAULT_VIRTUAL_TICKET);
    let virtual_ticket = if virtual_usdc == 0 {
        DEFAULT_VIRTUAL_TICKET
    } else {
        k / virtual_usdc
    };
    let token_supply = DEFAULT_VIRTUAL_TICKET.saturating_sub(virtual_ticket);
    let price = fixed_price(virtual_usdc, virtual_ticket);
    let market_cap = price.saturating_mul(DEFAULT_VIRTUAL_TICKET) / SCALE;

    CurveMetrics {
        price,
        token_supply,
        market_cap,
        liquidity: volume,
        volume,
        virtual_usdc,
        virtual_ticket,
    }
}

fn fixed_price(virtual_usdc: Amount, virtual_ticket: Amount) -> Amount {
    if virtual_ticket == 0 {
        return 0;
    }
    virtual_usdc.saturating_mul(SCALE) / virtual_ticket
}

fn outcome_volume(outcomes: &[OutcomeRow], outcome_id: u8) -> Amount {
    outcomes
        .iter()
        .find(|outcome| outcome.outcome_id == outcome_id)
        .map(|outcome| outcome.total_stake)
        .unwrap_or(0)
}

fn side_label(side: Side) -> &'static str {
    match side {
        Side::Up => "UP",
        Side::Down => "DOWN",
    }
}
