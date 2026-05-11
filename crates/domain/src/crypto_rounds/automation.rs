use std::collections::HashSet;

use super::types::*;

pub fn default_protocol_streams() -> Vec<ProtocolStreamTemplate> {
    vec![
        protocol_stream_template(1, 1, Asset::Btc, DURATION_5M_SECONDS),
        protocol_stream_template(1, 2, Asset::Eth, DURATION_5M_SECONDS),
        protocol_stream_template(1, 3, Asset::Sol, DURATION_5M_SECONDS),
        protocol_stream_template(1, 11, Asset::Btc, DURATION_1M_SECONDS),
        protocol_stream_template(1, 12, Asset::Eth, DURATION_1M_SECONDS),
        protocol_stream_template(1, 13, Asset::Sol, DURATION_1M_SECONDS),
        protocol_stream_template(2, 4, Asset::Btc, DURATION_15M_SECONDS),
        protocol_stream_template(2, 5, Asset::Eth, DURATION_15M_SECONDS),
        protocol_stream_template(2, 6, Asset::Sol, DURATION_15M_SECONDS),
        protocol_stream_template(3, 7, Asset::Xrp, DURATION_5M_SECONDS),
        protocol_stream_template(3, 8, Asset::Doge, DURATION_5M_SECONDS),
        protocol_stream_template(4, 9, Asset::Xrp, DURATION_15M_SECONDS),
        protocol_stream_template(4, 10, Asset::Doge, DURATION_15M_SECONDS),
    ]
}

pub fn protocol_streams_for_phase(
    phase: u8,
) -> Result<Vec<ProtocolStreamTemplate>, CryptoRoundError> {
    if !(1..=4).contains(&phase) {
        return Err(CryptoRoundError::InvalidDuration);
    }
    Ok(default_protocol_streams()
        .into_iter()
        .filter(|template| template.phase <= phase)
        .collect())
}

pub fn all_protocol_stream_configs() -> Vec<MarketStreamConfig> {
    default_protocol_streams()
        .into_iter()
        .map(ProtocolStreamTemplate::to_config)
        .collect()
}

pub fn protocol_stream_configs_for_phase(
    phase: u8,
) -> Result<Vec<MarketStreamConfig>, CryptoRoundError> {
    Ok(protocol_streams_for_phase(phase)?
        .into_iter()
        .map(ProtocolStreamTemplate::to_config)
        .collect())
}

pub fn current_round_id(now_ts: i64, duration_seconds: u64) -> Result<u64, CryptoRoundError> {
    if now_ts < 0 {
        return Err(CryptoRoundError::InvalidTimestamp);
    }
    if duration_seconds == 0 {
        return Err(CryptoRoundError::InvalidDuration);
    }
    Ok(now_ts as u64 / duration_seconds)
}

pub fn round_window(round_id: u64, duration_seconds: u64) -> Result<(i64, i64), CryptoRoundError> {
    if duration_seconds == 0 {
        return Err(CryptoRoundError::InvalidDuration);
    }
    let start = round_id
        .checked_mul(duration_seconds)
        .ok_or(CryptoRoundError::Overflow)?;
    let end = start
        .checked_add(duration_seconds)
        .ok_or(CryptoRoundError::Overflow)?;
    Ok((
        i64::try_from(start).map_err(|_| CryptoRoundError::Overflow)?,
        i64::try_from(end).map_err(|_| CryptoRoundError::Overflow)?,
    ))
}

pub fn plan_round_openings(
    active_streams: &[MarketStreamConfig],
    existing_round_ids: &HashSet<(u64, u64)>,
    now_ts: i64,
) -> Result<Vec<RoundOpenPlan>, CryptoRoundError> {
    let mut plans = Vec::new();
    for stream in active_streams.iter().filter(|stream| stream.active) {
        let round_id = current_round_id(now_ts, stream.duration_seconds)?;
        if existing_round_ids.contains(&(stream.market_id, round_id)) {
            continue;
        }
        let (start_at, end_at) = round_window(round_id, stream.duration_seconds)?;
        plans.push(RoundOpenPlan {
            market_id: stream.market_id,
            asset: stream.asset,
            duration_seconds: stream.duration_seconds,
            round_id,
            start_at,
            batch_until: start_at + stream.opening_batch_seconds,
            end_at,
            settlement_source: stream.settlement_source,
        });
    }
    Ok(plans)
}

pub fn plan_lazy_round_opening(
    stream: &MarketStreamConfig,
    existing_round_ids: &HashSet<(u64, u64)>,
    now_ts: i64,
    activation_grace_seconds: i64,
) -> Result<Option<RoundOpenPlan>, CryptoRoundError> {
    if !stream.active {
        return Ok(None);
    }
    let round_id = current_round_id(now_ts, stream.duration_seconds)?;
    if existing_round_ids.contains(&(stream.market_id, round_id)) {
        return Ok(None);
    }
    let (start_at, end_at) = round_window(round_id, stream.duration_seconds)?;
    validate_lazy_open_window(now_ts, start_at, activation_grace_seconds)?;
    Ok(Some(RoundOpenPlan {
        market_id: stream.market_id,
        asset: stream.asset,
        duration_seconds: stream.duration_seconds,
        round_id,
        start_at,
        batch_until: start_at + stream.opening_batch_seconds,
        end_at,
        settlement_source: stream.settlement_source,
    }))
}

pub fn validate_lazy_open_window(
    now_ts: i64,
    start_at: i64,
    activation_grace_seconds: i64,
) -> Result<(), CryptoRoundError> {
    if now_ts < 0 || start_at < 0 || activation_grace_seconds < 0 {
        return Err(CryptoRoundError::InvalidTimestamp);
    }
    if now_ts < start_at {
        return Err(CryptoRoundError::RoundOpenWindowNotStarted { now_ts, start_at });
    }
    let latest_open_ts = start_at
        .checked_add(activation_grace_seconds)
        .ok_or(CryptoRoundError::Overflow)?;
    if now_ts > latest_open_ts {
        return Err(CryptoRoundError::RoundOpenWindowExpired {
            now_ts,
            latest_open_ts,
        });
    }
    Ok(())
}

pub fn validate_resolve_time(
    now_ts: i64,
    end_at: i64,
    close_lag_seconds: i64,
) -> Result<(), CryptoRoundError> {
    if now_ts < 0 || end_at < 0 || close_lag_seconds < 0 {
        return Err(CryptoRoundError::InvalidTimestamp);
    }
    let earliest_resolve_ts = end_at
        .checked_add(close_lag_seconds)
        .ok_or(CryptoRoundError::Overflow)?;
    if now_ts < earliest_resolve_ts {
        return Err(CryptoRoundError::ResolveTooEarly {
            now_ts,
            earliest_resolve_ts,
        });
    }
    Ok(())
}

pub fn build_automation_plan(
    streams: Vec<MarketStreamConfig>,
    existing_round_ids: &HashSet<(u64, u64)>,
    now_ts: i64,
) -> Result<AutomationPlan, CryptoRoundError> {
    let round_openings = plan_round_openings(&streams, existing_round_ids, now_ts)?;
    Ok(AutomationPlan {
        now_ts,
        streams,
        round_openings,
    })
}

fn protocol_stream_template(
    phase: u8,
    market_id: u64,
    asset: Asset,
    duration_seconds: u64,
) -> ProtocolStreamTemplate {
    ProtocolStreamTemplate {
        phase,
        market_id,
        asset,
        duration_seconds,
        settlement_source: SettlementSource::binance_spot(asset, duration_seconds)
            .expect("default protocol streams use supported Binance intervals"),
    }
}
