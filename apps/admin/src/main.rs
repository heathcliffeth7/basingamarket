use anyhow::Context;
use basingamarket_chain::{decode_solana_pubkey, derive_program_address, SolanaDevnetConfig};
use basingamarket_db::{EventMeta, InMemoryProjectionStore, ProjectionEngine};
use basingamarket_domain::crypto_rounds::{
    all_protocol_stream_configs, build_automation_plan, plan_lazy_round_opening,
    protocol_stream_configs_for_phase, resolve_outcome, round_window, validate_resolve_time, Asset,
    MarketStreamConfig, DEFAULT_ACTIVATION_GRACE_SECONDS, DEFAULT_CLOSE_LAG_SECONDS,
};
use basingamarket_domain::{Amount, SCALE};
use basingamarket_market_data::binance::BinanceClient;
use basingamarket_observability::init_tracing;
use basingamarket_protocol_events::ProtocolEvent;
use clap::{Parser, Subcommand};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Parser)]
#[command(name = "basingamarket-admin")]
#[command(about = "Admin and operations tooling for basingamarket")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    ConfigCheck,
    RebuildFixture,
    Limits,
    CryptoStreams {
        #[arg(long, default_value = "1")]
        phase: String,
    },
    CryptoRoundPlan {
        #[arg(long, default_value = "1")]
        phase: String,
        #[arg(long)]
        now_ts: i64,
    },
    BinanceKline {
        #[arg(long)]
        symbol: String,
        #[arg(long)]
        interval: String,
        #[arg(long)]
        start_ts: i64,
    },
    BinanceRoundOpen {
        #[arg(long)]
        asset: Asset,
        #[arg(long = "duration", default_value_t = 300)]
        duration_seconds: u64,
        #[arg(long)]
        now_ts: i64,
    },
    BinanceRoundResolve {
        #[arg(long)]
        asset: Asset,
        #[arg(long = "duration", default_value_t = 300)]
        duration_seconds: u64,
        #[arg(long)]
        round_id: u64,
    },
    DevnetPdas {
        #[arg(long)]
        market_id: u64,
        #[arg(long)]
        round_id: u64,
        #[arg(long)]
        program_id: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("basingamarket-admin");
    let cli = Cli::parse();

    match cli.command {
        Command::ConfigCheck => {
            let config = SolanaDevnetConfig::from_env()?;
            println!("cluster={}", config.cluster);
            println!("rpc_url_configured={}", !config.rpc_url.is_empty());
            println!("ws_url_configured={}", config.ws_url.is_some());
            println!(
                "program_status={}",
                if config.program_id.is_some() {
                    "ready"
                } else {
                    "projection_pending"
                }
            );
        }
        Command::RebuildFixture => {
            let store = InMemoryProjectionStore::default();
            let engine = ProjectionEngine::new(store.clone());
            engine
                .apply_raw_event(
                    EventMeta::fixture(1, 0),
                    ProtocolEvent::MarketCreated {
                        market_id: 1,
                        question_hash: "fixture-question".to_owned(),
                        outcome_count: 2,
                        open_at: 0,
                        trade_until: 100,
                    },
                )
                .await?;
            engine.rebuild_from_raw_events().await?;
            println!("rebuild_ok=true");
            println!("markets={}", store.list_markets().await.len());
        }
        Command::Limits => {
            println!("solana_devnet_only=true");
            println!("max_open_markets=14");
            println!("max_market_stake_units=1000000000");
            println!("admin_create_resolve_required=true");
        }
        Command::CryptoStreams { phase } => {
            let streams = streams_for_phase_arg(&phase)?;
            println!("count={}", streams.len());
            for stream in streams {
                println!(
                    "market_id={} asset={} duration_seconds={} source=\"{}\" buy_fee_bps={} resale_fee_bps={} active={} protocol_owned={}",
                    stream.market_id,
                    stream.asset,
                    stream.duration_seconds,
                    stream.settlement_source,
                    stream.buy_fee_bps,
                    stream.resale_fee_bps,
                    stream.active,
                    stream.is_protocol_market
                );
            }
        }
        Command::CryptoRoundPlan { phase, now_ts } => {
            let streams = streams_for_phase_arg(&phase)?;
            let existing_round_ids = HashSet::new();
            let plan = build_automation_plan(streams, &existing_round_ids, now_ts)?;

            println!("now_ts={}", plan.now_ts);
            println!("streams={}", plan.streams.len());
            println!("round_openings={}", plan.round_openings.len());
            for opening in plan.round_openings {
                println!(
                    "open market_id={} asset={} duration_seconds={} source=\"{}\" round_id={} start_at={} end_at={}",
                    opening.market_id,
                    opening.asset,
                    opening.duration_seconds,
                    opening.settlement_source,
                    opening.round_id,
                    opening.start_at,
                    opening.end_at
                );
            }
        }
        Command::BinanceKline {
            symbol,
            interval,
            start_ts,
        } => {
            let start_time_ms = start_ts
                .checked_mul(1_000)
                .context("start_ts overflow while converting to milliseconds")?;
            let client = BinanceClient::default();
            let kline = client
                .fetch_kline(&symbol, &interval, start_time_ms)
                .await?;

            println!("symbol={}", kline.symbol);
            println!("interval={}", kline.interval);
            println!("open_time_ms={}", kline.open_time_ms);
            println!("close_time_ms={}", kline.close_time_ms);
            println!("open_price={}", format_scaled_amount(kline.open_price));
            println!("high_price={}", format_scaled_amount(kline.high_price));
            println!("low_price={}", format_scaled_amount(kline.low_price));
            println!("close_price={}", format_scaled_amount(kline.close_price));
            println!("number_of_trades={}", kline.number_of_trades);
        }
        Command::BinanceRoundOpen {
            asset,
            duration_seconds,
            now_ts,
        } => {
            let stream = phase_one_stream_for_asset_duration(asset, duration_seconds)?;
            let existing_round_ids: HashSet<(u64, u64)> = HashSet::new();
            let opening = plan_lazy_round_opening(
                &stream,
                &existing_round_ids,
                now_ts,
                DEFAULT_ACTIVATION_GRACE_SECONDS,
            )?
            .context("round already exists or stream is inactive")?;

            let client = BinanceClient::default();
            let snapshot = client
                .fetch_round_snapshot(asset, opening.start_at, opening.duration_seconds)
                .await?;

            println!("action=lazy_open");
            println!("market_id={}", opening.market_id);
            println!("asset={}", opening.asset);
            println!("round_id={}", opening.round_id);
            println!("start_at={}", opening.start_at);
            println!("end_at={}", opening.end_at);
            println!("source=\"{}\"", opening.settlement_source);
            println!("binance_symbol={}", snapshot.symbol);
            println!("binance_interval={}", snapshot.interval);
            println!("start_price={}", format_scaled_amount(snapshot.start_price));
            println!(
                "activation_grace_seconds={}",
                DEFAULT_ACTIVATION_GRACE_SECONDS
            );
        }
        Command::BinanceRoundResolve {
            asset,
            duration_seconds,
            round_id,
        } => {
            let now_ts = current_unix_ts()?;
            let stream = phase_one_stream_for_asset_duration(asset, duration_seconds)?;
            let (start_at, end_at) = round_window(round_id, stream.duration_seconds)?;
            validate_resolve_time(now_ts, end_at, DEFAULT_CLOSE_LAG_SECONDS)?;

            let client = BinanceClient::default();
            let snapshot = client
                .fetch_round_snapshot(asset, start_at, stream.duration_seconds)
                .await?;
            let outcome = resolve_outcome(snapshot.start_price, snapshot.end_price)
                .map(|side| side.to_string())
                .unwrap_or_else(|| "VOID".to_owned());

            println!("action=resolve");
            println!("market_id={}", stream.market_id);
            println!("asset={}", asset);
            println!("round_id={}", round_id);
            println!("start_at={}", start_at);
            println!("end_at={}", end_at);
            println!("source=\"{}\"", stream.settlement_source);
            println!("binance_symbol={}", snapshot.symbol);
            println!("binance_interval={}", snapshot.interval);
            println!("start_price={}", format_scaled_amount(snapshot.start_price));
            println!("end_price={}", format_scaled_amount(snapshot.end_price));
            println!("outcome={outcome}");
            println!("close_lag_seconds={}", DEFAULT_CLOSE_LAG_SECONDS);
        }
        Command::DevnetPdas {
            market_id,
            round_id,
            program_id,
        } => {
            let config = SolanaDevnetConfig::from_env()?;
            let program_id = program_id
                .or(config.program_id)
                .ok_or_else(|| anyhow::anyhow!("missing --program-id or SOLANA_PROGRAM_ID"))?;
            let addresses = devnet_pdas(&program_id, market_id, round_id)?;

            println!("program_id={program_id}");
            println!("market_id={market_id}");
            println!("round_id={round_id}");
            println!("global={}", addresses.global);
            println!("market={}", addresses.market);
            println!("round={}", addresses.round);
            println!("opening_aggregate_up={}", addresses.opening_aggregate_up);
            println!(
                "opening_aggregate_down={}",
                addresses.opening_aggregate_down
            );
            println!("round_vault={}", addresses.round_vault);
            println!("fee_vault={}", addresses.fee_vault);
        }
    }

    Ok(())
}

fn streams_for_phase_arg(phase: &str) -> anyhow::Result<Vec<MarketStreamConfig>> {
    if phase.eq_ignore_ascii_case("all") {
        return Ok(all_protocol_stream_configs());
    }

    let phase_number = phase.parse::<u8>()?;
    Ok(protocol_stream_configs_for_phase(phase_number)?)
}

fn phase_one_stream_for_asset_duration(
    asset: Asset,
    duration_seconds: u64,
) -> anyhow::Result<MarketStreamConfig> {
    protocol_stream_configs_for_phase(1)?
        .into_iter()
        .find(|stream| stream.asset == asset && stream.duration_seconds == duration_seconds)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "asset {asset} duration_seconds {duration_seconds} is not enabled for Binance phase 1"
            )
        })
}

fn current_unix_ts() -> anyhow::Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before Unix epoch")?;
    i64::try_from(duration.as_secs()).context("current Unix timestamp does not fit in i64")
}

fn format_scaled_amount(amount: Amount) -> String {
    let whole = amount / SCALE;
    let fractional = amount % SCALE;
    format!("{whole}.{fractional:06}")
}

#[derive(Debug)]
struct DevnetPdas {
    global: String,
    market: String,
    round: String,
    opening_aggregate_up: String,
    opening_aggregate_down: String,
    round_vault: String,
    fee_vault: String,
}

fn devnet_pdas(program_id: &str, market_id: u64, round_id: u64) -> anyhow::Result<DevnetPdas> {
    let market_seed = market_id.to_le_bytes();
    let round_seed = round_id.to_le_bytes();
    let global = derive_program_address(&[b"global"], program_id, "program_id")?;
    let market = derive_program_address(&[b"market", &market_seed], program_id, "program_id")?;
    let market_bytes = decode_solana_pubkey(&market, "market")?;
    let round = derive_program_address(
        &[b"round", &market_bytes, &round_seed],
        program_id,
        "program_id",
    )?;
    let round_bytes = decode_solana_pubkey(&round, "round")?;
    let global_bytes = decode_solana_pubkey(&global, "global")?;

    Ok(DevnetPdas {
        global,
        market,
        round: round.clone(),
        opening_aggregate_up: derive_program_address(
            &[b"opening_aggregate", &round_bytes, b"up"],
            program_id,
            "program_id",
        )?,
        opening_aggregate_down: derive_program_address(
            &[b"opening_aggregate", &round_bytes, b"down"],
            program_id,
            "program_id",
        )?,
        round_vault: derive_program_address(
            &[b"round_vault", &round_bytes],
            program_id,
            "program_id",
        )?,
        fee_vault: derive_program_address(
            &[b"fee_vault", &global_bytes],
            program_id,
            "program_id",
        )?,
    })
}
