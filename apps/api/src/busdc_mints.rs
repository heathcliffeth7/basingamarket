use std::{path::PathBuf, process::Output, time::Duration};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_db::BusdcMintRow;
use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

use crate::{
    deposits::ResolvedDepositConfig, require_privy_session, ApiError, AppState, BusdcReserveBacker,
};

const BUSDC_CURRENCY: &str = "BUSDC";
const BUSDC_DECIMALS: u8 = 6;
const BUSDC_DAILY_MINT_LIMIT: u32 = 5;
const BUSDC_MINT_AMOUNT: u128 = 50_000_000_000;
const BUSDC_MINT_AMOUNT_UI: &str = "50000";
const DEFAULT_BUSDC_RESERVE_SCRIPT: &str = "apps/web/scripts/reserve-devnet-cash.mjs";
const DEFAULT_BUSDC_RESERVE_TIMEOUT_MS: u64 = 45_000;

pub(crate) async fn get_busdc_mint_status(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<BusdcMintStatusResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let window = mint_window(Utc::now());
    let used = state
        .store
        .busdc_mint_count_for_day(&wallet_address, &window.mint_day)
        .await;

    Ok(Json(BusdcMintStatusResponse::new(
        wallet_address,
        used,
        window,
    )))
}

pub(crate) async fn mint_busdc(
    State(state): State<AppState>,
    Path(address): Path<String>,
    headers: HeaderMap,
) -> Result<Json<BusdcMintResponse>, ApiError> {
    let _session = require_privy_session(&state, &headers)?;
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let now = Utc::now();
    let window = mint_window(now);
    let used_before = state
        .store
        .busdc_mint_count_for_day(&wallet_address, &window.mint_day)
        .await;
    if used_before >= BUSDC_DAILY_MINT_LIMIT {
        return Err(busdc_mint_limit_exceeded());
    }
    back_busdc_mint_reserve(&state, BUSDC_MINT_AMOUNT_UI).await?;
    let (balance, used_today) = state
        .store
        .record_busdc_mint(
            BusdcMintRow {
                mint_id: Uuid::new_v4().to_string(),
                wallet_address: wallet_address.clone(),
                mint_day: window.mint_day.clone(),
                amount: BUSDC_MINT_AMOUNT,
                created_at: now,
            },
            BUSDC_DAILY_MINT_LIMIT,
        )
        .await
        .map_err(busdc_mint_store_error)?;
    state.persist_cash_projection().await?;

    Ok(Json(BusdcMintResponse {
        wallet_address,
        currency: BUSDC_CURRENCY,
        decimals: BUSDC_DECIMALS,
        minted_amount: BUSDC_MINT_AMOUNT.to_string(),
        cash_balance: balance.cash_balance.to_string(),
        daily_mints_used: used_today,
        daily_mints_remaining: BUSDC_DAILY_MINT_LIMIT.saturating_sub(used_today),
        daily_mints_limit: BUSDC_DAILY_MINT_LIMIT,
        reset_at: window.reset_at.to_rfc3339(),
        status: "credited",
    }))
}

#[derive(Debug, Clone)]
struct MintWindow {
    mint_day: String,
    reset_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BusdcMintStatusResponse {
    wallet_address: String,
    currency: &'static str,
    decimals: u8,
    mint_amount: String,
    daily_mints_used: u32,
    daily_mints_remaining: u32,
    daily_mints_limit: u32,
    reset_at: String,
    status: &'static str,
}

impl BusdcMintStatusResponse {
    fn new(wallet_address: String, used: u32, window: MintWindow) -> Self {
        Self {
            wallet_address,
            currency: BUSDC_CURRENCY,
            decimals: BUSDC_DECIMALS,
            mint_amount: BUSDC_MINT_AMOUNT.to_string(),
            daily_mints_used: used,
            daily_mints_remaining: BUSDC_DAILY_MINT_LIMIT.saturating_sub(used),
            daily_mints_limit: BUSDC_DAILY_MINT_LIMIT,
            reset_at: window.reset_at.to_rfc3339(),
            status: "ready",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct BusdcMintResponse {
    wallet_address: String,
    currency: &'static str,
    decimals: u8,
    minted_amount: String,
    cash_balance: String,
    daily_mints_used: u32,
    daily_mints_remaining: u32,
    daily_mints_limit: u32,
    reset_at: String,
    status: &'static str,
}

#[derive(Debug)]
struct ResolvedBusdcReserveConfig {
    mint_authority_keypair_path: String,
    script_path: PathBuf,
    env_path: PathBuf,
    api_base_url: Option<String>,
    timeout: Duration,
}

async fn back_busdc_mint_reserve(state: &AppState, amount_ui: &str) -> Result<(), ApiError> {
    match state.busdc_reserve_backer {
        #[cfg(test)]
        BusdcReserveBacker::MockSuccess => Ok(()),
        BusdcReserveBacker::Script => back_busdc_mint_reserve_with_script(state, amount_ui).await,
    }
}

async fn back_busdc_mint_reserve_with_script(
    state: &AppState,
    amount_ui: &str,
) -> Result<(), ApiError> {
    let config = resolve_busdc_reserve_config(state)?;
    let mut command = Command::new("node");
    command
        .kill_on_drop(true)
        .arg(&config.script_path)
        .arg("--amount")
        .arg(amount_ui)
        .arg("--mint-authority-keypair")
        .arg(&config.mint_authority_keypair_path)
        .arg("--env")
        .arg(&config.env_path)
        .arg("--skip-liquidity");
    if let Some(api_base_url) = &config.api_base_url {
        command.arg("--api-base-url").arg(api_base_url);
    }

    let output = run_busdc_reserve_command(command, config.timeout).await?;
    if !output.status.success() {
        tracing::warn!(
            stdout = %String::from_utf8_lossy(&output.stdout),
            stderr = %String::from_utf8_lossy(&output.stderr),
            "BUSDC mint reserve backing failed"
        );
        return Err(busdc_mint_reserve_unavailable());
    }
    tracing::info!(
        stdout = %String::from_utf8_lossy(&output.stdout),
        "BUSDC mint reserve backed"
    );
    Ok(())
}

async fn run_busdc_reserve_command(
    mut command: Command,
    reserve_timeout: Duration,
) -> Result<Output, ApiError> {
    match timeout(reserve_timeout, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(ApiError::internal(error)),
        Err(_) => {
            tracing::warn!(
                timeout_ms = reserve_timeout.as_millis(),
                "BUSDC mint reserve backing timed out"
            );
            Err(busdc_mint_reserve_unavailable())
        }
    }
}

fn resolve_busdc_reserve_config(state: &AppState) -> Result<ResolvedBusdcReserveConfig, ApiError> {
    let _deposit = ResolvedDepositConfig::from_chain_config(&state.chain_config)
        .map_err(|_| busdc_mint_reserve_unavailable())?;
    let mint_authority_keypair_path = std::env::var("SOLANA_CASH_MINT_AUTHORITY_KEYPAIR")
        .map_err(|_| busdc_mint_reserve_unavailable())?;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .unwrap_or(manifest_dir.as_path())
        .to_path_buf();
    Ok(ResolvedBusdcReserveConfig {
        mint_authority_keypair_path,
        script_path: std::env::var("SOLANA_BUSDC_RESERVE_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join(DEFAULT_BUSDC_RESERVE_SCRIPT)),
        env_path: std::env::var("SOLANA_BUSDC_RESERVE_ENV_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join(".env")),
        api_base_url: std::env::var("SOLANA_BUSDC_RESERVE_API_BASE_URL").ok(),
        timeout: busdc_reserve_timeout()?,
    })
}

fn busdc_reserve_timeout() -> Result<Duration, ApiError> {
    let timeout_ms = match std::env::var("SOLANA_BUSDC_RESERVE_TIMEOUT_MS") {
        Ok(value) => value
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(busdc_mint_reserve_unavailable)?,
        Err(_) => DEFAULT_BUSDC_RESERVE_TIMEOUT_MS,
    };
    Ok(Duration::from_millis(timeout_ms))
}

fn busdc_mint_reserve_unavailable() -> ApiError {
    ApiError::service_unavailable(
        "busdc_mint_reserve_unavailable",
        "BUSDC mint reserve hazir degil. Devnet vault backing icin SOLANA_CASH_MINT_AUTHORITY_KEYPAIR gerekli.",
    )
}

fn mint_window(now: DateTime<Utc>) -> MintWindow {
    let date = now.date_naive();
    let reset_date = date.succ_opt().unwrap_or(date);
    let reset_naive = reset_date
        .and_hms_opt(0, 0, 0)
        .unwrap_or_else(|| now.naive_utc());
    MintWindow {
        mint_day: date.format("%Y-%m-%d").to_string(),
        reset_at: DateTime::<Utc>::from_naive_utc_and_offset(reset_naive, Utc),
    }
}

fn busdc_mint_store_error(error: basingamarket_db::DbError) -> ApiError {
    if error.to_string().contains("busdc mint limit exceeded") {
        return busdc_mint_limit_exceeded();
    }
    ApiError::internal(error)
}

fn busdc_mint_limit_exceeded() -> ApiError {
    ApiError::bad_request(
        "busdc_mint_limit_exceeded",
        "Daily BUSDC mint limit exceeded.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use std::{fs, time::Instant};

    #[tokio::test]
    async fn busdc_reserve_command_times_out() {
        let script_path = std::env::temp_dir().join(format!(
            "basingamarket-busdc-reserve-timeout-{}.mjs",
            Uuid::new_v4()
        ));
        fs::write(&script_path, "setTimeout(() => {}, 1000);\n").unwrap();
        let mut command = Command::new("node");
        command.kill_on_drop(true).arg(&script_path);

        let started_at = Instant::now();
        let error = run_busdc_reserve_command(command, Duration::from_millis(50))
            .await
            .unwrap_err();

        let _ = fs::remove_file(&script_path);
        assert!(started_at.elapsed() < Duration::from_millis(500));
        assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.code, "busdc_mint_reserve_unavailable");
    }
}
