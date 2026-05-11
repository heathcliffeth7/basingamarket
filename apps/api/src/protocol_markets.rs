use basingamarket_db::{InMemoryProjectionStore, MarketRow, OutcomeRow};
use basingamarket_domain::{
    crypto_rounds::{
        protocol_stream_configs_for_phase, MarketStreamConfig, DURATION_15M_SECONDS,
        DURATION_1M_SECONDS, DURATION_5M_SECONDS,
    },
    MarketStatus,
};

const PHASE_ONE_PROTOCOL_MARKET_TRADE_UNTIL: u64 = 4_102_444_800;
const PHASE_ONE_PROTOCOL_MARKET_CURSOR_SLOT: u64 = 13;
const EVEN_ODDS: u128 = 500_000;

pub async fn seed_phase_one_protocol_markets(
    store: &InMemoryProjectionStore,
) -> anyhow::Result<bool> {
    let streams = protocol_stream_configs_for_phase(1)?;
    let mut inserted_any = false;

    for stream in streams {
        let now = chrono::Utc::now();
        let market = MarketRow {
            market_id: stream.market_id,
            question_hash: protocol_market_question(&stream),
            status: MarketStatus::Open,
            outcome_count: 2,
            open_at: 0,
            trade_until: PHASE_ONE_PROTOCOL_MARKET_TRADE_UNTIL,
            winning_outcome: None,
            created_slot: stream.market_id,
            created_at: now,
            updated_at: now,
        };
        let outcomes = vec![
            protocol_outcome(stream.market_id, 0, "UP"),
            protocol_outcome(stream.market_id, 1, "DOWN"),
        ];

        inserted_any = store.insert_market_if_absent(market, outcomes).await || inserted_any;
    }

    if inserted_any {
        store
            .update_cursor(PHASE_ONE_PROTOCOL_MARKET_CURSOR_SLOT)
            .await;
    }

    Ok(inserted_any)
}

fn protocol_market_question(stream: &MarketStreamConfig) -> String {
    format!(
        "{} {} Crypto Round",
        stream.asset,
        duration_label(stream.duration_seconds)
    )
}

fn duration_label(duration_seconds: u64) -> &'static str {
    match duration_seconds {
        DURATION_1M_SECONDS => "1m",
        DURATION_5M_SECONDS => "5m",
        DURATION_15M_SECONDS => "15m",
        _ => "custom",
    }
}

fn protocol_outcome(market_id: u64, outcome_id: u8, label: &str) -> OutcomeRow {
    OutcomeRow {
        market_id,
        outcome_id,
        label: label.to_owned(),
        total_stake: 0,
        total_reward_shares: 0,
        current_odds: EVEN_ODDS,
    }
}
