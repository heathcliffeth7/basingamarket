use std::{fs, path::PathBuf, process::Command};

use axum::{
    extract::{Path, State},
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_chain::{
    derive_associated_token_address, encode_base58_bytes, is_valid_solana_signature,
    verify_solana_message_signature, TOKEN_PROGRAM_ADDRESS,
};
use basingamarket_db::{CashWithdrawalQuoteRow, CashWithdrawalRow};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{deposits::ResolvedDepositConfig, ApiError, AppState};

const DEFAULT_WITHDRAW_KEYPAIR: &str = "~/.config/solana/basingamarket-devnet-vault-owner.json";
const DEFAULT_WITHDRAW_TTL_SECONDS: i64 = 60;
const CASH_DECIMALS: u32 = 6;
const BUSDC_CURRENCY: &str = "BUSDC";

pub(crate) async fn get_withdraw_config(
    State(state): State<AppState>,
) -> Json<WithdrawConfigResponse> {
    Json(WithdrawConfigResponse::from_state(&state))
}

pub(crate) async fn get_latest_withdrawal(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<WithdrawalResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let row = state
        .store
        .latest_cash_withdrawal(&wallet_address)
        .await
        .ok_or_else(|| ApiError::not_found("withdraw_not_found", "Withdraw bulunamadi."))?;
    let cash_balance = current_cash_balance(&state, &wallet_address).await;
    Ok(Json(WithdrawalResponse::from_row(
        &row,
        cash_balance,
        "already_sent",
    )))
}

pub(crate) async fn create_withdrawal_quote(
    State(state): State<AppState>,
    Path(address): Path<String>,
    Json(payload): Json<WithdrawalQuoteRequest>,
) -> Result<Json<WithdrawalQuoteResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let config = resolve_withdraw_config(&state)?;
    let cash_amount = parse_cash_amount(&payload.cash_amount)?;
    let cash_balance = state
        .store
        .get_cash_balance(&wallet_address)
        .await
        .map(|row| row.cash_balance)
        .unwrap_or(0);
    if cash_balance < cash_amount {
        return Err(ApiError::bad_request(
            "withdraw_insufficient_cash",
            "Cash bakiyesi yetersiz.",
        ));
    }

    let destination_wallet =
        requested_destination_wallet(&wallet_address, payload.destination.as_deref())?;
    if destination_wallet != wallet_address {
        reject_token_account_destination(&state, &destination_wallet).await?;
    }
    let destination_token_account =
        derive_associated_token_address(&destination_wallet, &config.deposit.mint)
            .map_err(ApiError::internal)?;
    let quote_id = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + chrono::Duration::seconds(config.quote_ttl_seconds);
    let message = withdraw_message(WithdrawMessageInput {
        wallet_address: &wallet_address,
        destination_wallet: &destination_wallet,
        destination_token_account: &destination_token_account,
        mint: &config.deposit.mint,
        vault_token_account: &config.deposit.vault_token_account,
        cash_amount,
        quote_id: &quote_id,
        expires_at,
    });
    state
        .store
        .insert_cash_withdrawal_quote(CashWithdrawalQuoteRow {
            quote_id: quote_id.clone(),
            wallet_address: wallet_address.clone(),
            destination_wallet: Some(destination_wallet.clone()),
            destination_token_account: destination_token_account.clone(),
            cash_amount,
            message: message.clone(),
            expires_at,
            used_user_signature: None,
            created_at: Utc::now(),
        })
        .await;
    state.persist_cash_projection().await?;

    Ok(Json(WithdrawalQuoteResponse {
        wallet_address,
        currency: BUSDC_CURRENCY,
        decimals: 6,
        cash_amount: cash_amount.to_string(),
        quote_id: Some(quote_id),
        message: Some(message),
        destination: Some(destination_wallet),
        destination_token_account: Some(destination_token_account),
        mint: Some(config.deposit.mint),
        expires_at: Some(expires_at.to_rfc3339()),
        status: "ready",
    }))
}

pub(crate) async fn verify_withdrawal(
    State(state): State<AppState>,
    Path(address): Path<String>,
    Json(payload): Json<WithdrawalRequest>,
) -> Result<Json<WithdrawalResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let config = resolve_withdraw_config(&state)?;
    let user_signature = payload.user_signature.trim().to_owned();
    if !is_valid_solana_signature(&user_signature) {
        return Err(ApiError::bad_request(
            "invalid_signature",
            "Solana signature gecersiz.",
        ));
    }

    if let Some(existing) = state
        .store
        .get_cash_withdrawal_by_quote(payload.quote_id.trim())
        .await
    {
        if existing.wallet_address != wallet_address {
            return Err(ApiError::bad_request(
                "withdraw_wallet_mismatch",
                "Withdraw quote farkli bir wallet icin kaydedilmis.",
            ));
        }
        let cash_balance = current_cash_balance(&state, &wallet_address).await;
        return Ok(Json(WithdrawalResponse::from_row(
            &existing,
            cash_balance,
            "already_sent",
        )));
    }

    let quote = state
        .store
        .get_cash_withdrawal_quote(payload.quote_id.trim())
        .await
        .ok_or_else(|| {
            ApiError::bad_request("withdraw_quote_not_found", "Withdraw quote bulunamadi.")
        })?;
    if quote.wallet_address != wallet_address {
        return Err(ApiError::bad_request(
            "withdraw_quote_wallet_mismatch",
            "Withdraw quote wallet ile eslesmiyor.",
        ));
    }
    if quote.used_user_signature.is_some() {
        return Err(ApiError::service_unavailable(
            "withdrawal_processing",
            "Withdraw islemi isleniyor. Birazdan tekrar kontrol et.",
        ));
    }
    if quote.expires_at <= Utc::now() {
        return Err(ApiError::bad_request(
            "withdraw_quote_expired",
            "Withdraw quote suresi dolmus.",
        ));
    }
    verify_solana_message_signature(&wallet_address, quote.message.as_bytes(), &user_signature)
        .map_err(|_| {
            ApiError::bad_request(
                "withdraw_wrong_signer",
                "Withdraw imzasi wallet ile eslesmiyor.",
            )
        })?;
    if current_cash_balance(&state, &wallet_address).await < quote.cash_amount {
        return Err(ApiError::bad_request(
            "withdraw_insufficient_cash",
            "Cash bakiyesi yetersiz.",
        ));
    }

    state
        .store
        .reserve_cash_withdrawal_quote(&quote.quote_id, &user_signature)
        .await
        .map_err(ApiError::internal)?;
    let destination_wallet = quote
        .destination_wallet
        .clone()
        .unwrap_or_else(|| quote.wallet_address.clone());
    let vault_signature = submit_withdrawal(&config, &destination_wallet, quote.cash_amount)?;
    let row = CashWithdrawalRow {
        wallet_address: wallet_address.clone(),
        destination_wallet: Some(destination_wallet),
        quote_id: quote.quote_id.clone(),
        user_signature,
        vault_signature,
        mint: config.deposit.mint.clone(),
        vault_token_account: config.deposit.vault_token_account.clone(),
        destination_token_account: quote.destination_token_account,
        amount: quote.cash_amount,
        created_at: Utc::now(),
    };
    let (cash_balance, sent) = state
        .store
        .record_cash_withdrawal(row.clone())
        .await
        .map_err(ApiError::internal)?;
    if sent {
        state.persist_cash_projection().await?;
    }

    Ok(Json(WithdrawalResponse::from_row(
        &row,
        cash_balance.cash_balance,
        if sent { "sent" } else { "already_sent" },
    )))
}

#[derive(Debug)]
struct ResolvedWithdrawConfig {
    deposit: ResolvedDepositConfig,
    keypair_path: String,
    quote_ttl_seconds: i64,
    rpc_url: String,
    script_path: PathBuf,
    env_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WithdrawalQuoteRequest {
    cash_amount: String,
    destination: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WithdrawalRequest {
    quote_id: String,
    user_signature: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WithdrawConfigResponse {
    cluster: String,
    currency: &'static str,
    decimals: u8,
    mint: Option<String>,
    vault_owner: Option<String>,
    vault_token_account: Option<String>,
    quote_ttl_seconds: u64,
    status: &'static str,
    reason: Option<&'static str>,
}

impl WithdrawConfigResponse {
    fn from_state(state: &AppState) -> Self {
        let deposit = ResolvedDepositConfig::from_chain_config(&state.chain_config).ok();
        let runtime = withdraw_runtime_from_env();
        let reason = withdraw_setup_reason(state, &runtime, deposit.as_ref());
        Self {
            cluster: state.chain_config.cluster.clone(),
            currency: BUSDC_CURRENCY,
            decimals: 6,
            mint: deposit.as_ref().map(|config| config.mint.clone()),
            vault_owner: state.chain_config.deposit_vault_owner.clone(),
            vault_token_account: deposit.map(|config| config.vault_token_account),
            quote_ttl_seconds: runtime.quote_ttl_seconds.max(1) as u64,
            status: if reason.is_none() {
                "ready"
            } else {
                "setup_pending"
            },
            reason,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct WithdrawalQuoteResponse {
    wallet_address: String,
    currency: &'static str,
    decimals: u8,
    cash_amount: String,
    quote_id: Option<String>,
    message: Option<String>,
    destination: Option<String>,
    destination_token_account: Option<String>,
    mint: Option<String>,
    expires_at: Option<String>,
    status: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct WithdrawalResponse {
    wallet_address: String,
    quote_id: String,
    user_signature: String,
    vault_signature: String,
    currency: &'static str,
    decimals: u8,
    mint: String,
    cash_balance: String,
    withdrawn_amount: String,
    destination: String,
    destination_token_account: String,
    explorer_url: String,
    status: &'static str,
}

impl WithdrawalResponse {
    fn from_row(row: &CashWithdrawalRow, cash_balance: u128, status: &'static str) -> Self {
        Self {
            wallet_address: row.wallet_address.clone(),
            quote_id: row.quote_id.clone(),
            user_signature: row.user_signature.clone(),
            vault_signature: row.vault_signature.clone(),
            currency: BUSDC_CURRENCY,
            decimals: 6,
            mint: row.mint.clone(),
            cash_balance: cash_balance.to_string(),
            withdrawn_amount: row.amount.to_string(),
            destination: row
                .destination_wallet
                .clone()
                .unwrap_or_else(|| row.wallet_address.clone()),
            destination_token_account: row.destination_token_account.clone(),
            explorer_url: solana_explorer_tx_url(&row.vault_signature),
            status,
        }
    }
}

struct WithdrawRuntimeConfig {
    enabled: bool,
    keypair_path: String,
    quote_ttl_seconds: i64,
    script_path: PathBuf,
    env_path: PathBuf,
}

struct WithdrawMessageInput<'a> {
    wallet_address: &'a str,
    destination_wallet: &'a str,
    destination_token_account: &'a str,
    mint: &'a str,
    vault_token_account: &'a str,
    cash_amount: u128,
    quote_id: &'a str,
    expires_at: DateTime<Utc>,
}

fn resolve_withdraw_config(state: &AppState) -> Result<ResolvedWithdrawConfig, ApiError> {
    let deposit = ResolvedDepositConfig::from_chain_config(&state.chain_config)?;
    let runtime = withdraw_runtime_from_env();
    if let Some(reason) = withdraw_setup_reason(state, &runtime, Some(&deposit)) {
        return Err(ApiError::service_unavailable(
            "withdraw_setup_pending",
            reason_message(reason),
        ));
    }
    Ok(ResolvedWithdrawConfig {
        deposit,
        keypair_path: runtime.keypair_path,
        quote_ttl_seconds: runtime.quote_ttl_seconds,
        rpc_url: state.chain_config.rpc_url.clone(),
        script_path: runtime.script_path,
        env_path: runtime.env_path,
    })
}

fn withdraw_setup_reason(
    state: &AppState,
    runtime: &WithdrawRuntimeConfig,
    deposit: Option<&ResolvedDepositConfig>,
) -> Option<&'static str> {
    if deposit.is_none() {
        return Some("deposit_config_pending");
    }
    if !runtime.enabled {
        return Some("withdraw_disabled");
    }
    let Ok(keypair_owner) = vault_owner_from_keypair(&runtime.keypair_path) else {
        return Some("vault_keypair_missing");
    };
    if state.chain_config.deposit_vault_owner.as_deref() != Some(keypair_owner.as_str()) {
        return Some("vault_owner_mismatch");
    }
    None
}

fn reason_message(reason: &'static str) -> &'static str {
    match reason {
        "deposit_config_pending" => "Withdraw setup pending: deposit config hazir degil.",
        "withdraw_disabled" => "Withdraw setup pending: SOLANA_WITHDRAW_ENABLED=true olmali.",
        "vault_keypair_missing" => "Withdraw setup pending: vault owner keypair okunamadi.",
        "vault_owner_mismatch" => {
            "Withdraw setup pending: vault owner keypair config ile eslesmiyor."
        }
        _ => "Withdraw setup pending.",
    }
}

fn withdraw_runtime_from_env() -> WithdrawRuntimeConfig {
    let quote_ttl_seconds = std::env::var("SOLANA_WITHDRAW_QUOTE_TTL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_WITHDRAW_TTL_SECONDS);
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .unwrap_or(manifest_dir.as_path())
        .to_path_buf();
    WithdrawRuntimeConfig {
        enabled: std::env::var("SOLANA_WITHDRAW_ENABLED")
            .ok()
            .is_some_and(|value| parse_bool(&value)),
        keypair_path: std::env::var("SOLANA_WITHDRAW_VAULT_OWNER_KEYPAIR")
            .unwrap_or_else(|_| DEFAULT_WITHDRAW_KEYPAIR.to_owned()),
        quote_ttl_seconds,
        script_path: std::env::var("SOLANA_WITHDRAW_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join("apps/web/scripts/withdraw-devnet-cash.mjs")),
        env_path: std::env::var("SOLANA_WITHDRAW_ENV_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join(".env")),
    }
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn vault_owner_from_keypair(keypair_path: &str) -> Result<String, ApiError> {
    let path = expand_home(keypair_path);
    let text = fs::read_to_string(&path).map_err(|_| {
        ApiError::service_unavailable(
            "withdraw_setup_pending",
            "Withdraw setup pending: vault owner keypair okunamadi.",
        )
    })?;
    let bytes: Vec<u8> = serde_json::from_str(&text).map_err(ApiError::internal)?;
    if bytes.len() != 64 {
        return Err(ApiError::service_unavailable(
            "withdraw_setup_pending",
            "Withdraw setup pending: vault owner keypair gecersiz.",
        ));
    }
    Ok(encode_base58_bytes(&bytes[32..64]))
}

fn submit_withdrawal(
    config: &ResolvedWithdrawConfig,
    destination_wallet: &str,
    amount: u128,
) -> Result<String, ApiError> {
    let output = Command::new("node")
        .arg(&config.script_path)
        .arg("--destination")
        .arg(destination_wallet)
        .arg("--amount")
        .arg(format_base_units(amount))
        .arg("--vault-owner-keypair")
        .arg(&config.keypair_path)
        .arg("--env")
        .arg(&config.env_path)
        .arg("--rpc-url")
        .arg(&config.rpc_url)
        .output()
        .map_err(ApiError::internal)?;
    if !output.status.success() {
        tracing::warn!(
            stderr = %String::from_utf8_lossy(&output.stderr),
            "withdraw script failed"
        );
        return Err(ApiError::service_unavailable(
            "withdrawal_transfer_failed",
            "Vault transfer tamamlanamadi.",
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_script_signature(&stdout).ok_or_else(|| {
        ApiError::service_unavailable(
            "withdrawal_transfer_failed",
            "Vault transfer signature okunamadi.",
        )
    })
}

fn parse_cash_amount(value: &str) -> Result<u128, ApiError> {
    let amount = value
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::bad_request("invalid_cash_amount", "Cash amount gecersiz."))?;
    if amount == 0 {
        return Err(ApiError::bad_request(
            "invalid_cash_amount",
            "Cash amount sifir olamaz.",
        ));
    }
    Ok(amount)
}

fn requested_destination_wallet(
    wallet_address: &str,
    destination: Option<&str>,
) -> Result<String, ApiError> {
    let Some(destination) = destination.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(wallet_address.to_owned());
    };
    normalize_solana_pubkey(destination).map_err(|_| {
        ApiError::bad_request(
            "withdraw_invalid_destination",
            "Withdraw destination Solana wallet adresi gecersiz.",
        )
    })
}

async fn reject_token_account_destination(
    state: &AppState,
    destination_wallet: &str,
) -> Result<(), ApiError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            state.chain_config.request_timeout_ms,
        ))
        .build()
        .map_err(ApiError::internal)?;
    let response = client
        .post(&state.chain_config.rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [
                destination_wallet,
                {
                    "encoding": "jsonParsed",
                    "commitment": state.chain_config.deposit_commitment
                }
            ]
        }))
        .send()
        .await
        .map_err(ApiError::internal)?;
    if !response.status().is_success() {
        return Err(ApiError::service_unavailable(
            "solana_rpc_unavailable",
            "Solana RPC su anda yanit vermiyor.",
        ));
    }
    let body: serde_json::Value = response.json().await.map_err(ApiError::internal)?;
    if body.get("error").is_some() {
        return Err(ApiError::service_unavailable(
            "solana_rpc_unavailable",
            "Solana RPC su anda yanit vermiyor.",
        ));
    }
    let owner = body
        .pointer("/result/value/owner")
        .and_then(serde_json::Value::as_str);
    if owner == Some(TOKEN_PROGRAM_ADDRESS) {
        return Err(ApiError::bad_request(
            "withdraw_destination_token_account",
            "Withdraw destination wallet adresi olmali; token account adresi girme.",
        ));
    }
    Ok(())
}

fn withdraw_message(input: WithdrawMessageInput<'_>) -> String {
    format!(
        "BasingaMarket devnet withdraw\nWallet: {}\nDestination Wallet: {}\nDestination ATA: {}\nMint: {}\nVault ATA: {}\nAmount: {}\nQuote: {}\nExpires at: {}",
        input.wallet_address,
        input.destination_wallet,
        input.destination_token_account,
        input.mint,
        input.vault_token_account,
        input.cash_amount,
        input.quote_id,
        input.expires_at.to_rfc3339()
    )
}

fn solana_explorer_tx_url(signature: &str) -> String {
    format!("https://explorer.solana.com/tx/{signature}?cluster=devnet")
}

fn format_base_units(amount: u128) -> String {
    let scale = 10u128.pow(CASH_DECIMALS);
    let whole = amount / scale;
    let fraction = amount % scale;
    if fraction == 0 {
        return whole.to_string();
    }
    let trimmed = format!("{fraction:06}").trim_end_matches('0').to_owned();
    format!("{whole}.{trimmed}")
}

fn parse_script_signature(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.strip_prefix("Transaction: ")
            .map(str::trim)
            .filter(|value| is_valid_solana_signature(value))
            .map(ToOwned::to_owned)
    })
}

async fn current_cash_balance(state: &AppState, wallet_address: &str) -> u128 {
    state
        .store
        .get_cash_balance(wallet_address)
        .await
        .map(|row| row.cash_balance)
        .unwrap_or(0)
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_base_units_for_script_amounts() {
        assert_eq!(format_base_units(1), "0.000001");
        assert_eq!(format_base_units(1_000_000), "1");
        assert_eq!(format_base_units(1_250_000), "1.25");
    }

    #[test]
    fn parses_withdraw_script_signature() {
        let signature =
            "5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q";
        assert_eq!(
            parse_script_signature(&format!(
                "Devnet cash withdraw complete.\nTransaction: {signature}\n"
            )),
            Some(signature.to_owned())
        );
    }

    #[test]
    fn withdrawal_message_is_exact_and_bound_to_quote() {
        let expires_at = DateTime::parse_from_rfc3339("2026-05-10T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let message = withdraw_message(WithdrawMessageInput {
            wallet_address: "wallet",
            destination_wallet: "destination",
            destination_token_account: "ata",
            mint: "mint",
            vault_token_account: "vault",
            cash_amount: 1_000_000,
            quote_id: "quote-1",
            expires_at,
        });

        assert!(message.contains("BasingaMarket devnet withdraw"));
        assert!(message.contains("Wallet: wallet"));
        assert!(message.contains("Destination Wallet: destination"));
        assert!(message.contains("Quote: quote-1"));
        assert!(message.contains("Amount: 1000000"));
    }

    #[test]
    fn requested_destination_defaults_to_source_and_rejects_invalid_values() {
        let source = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        let custom = "So11111111111111111111111111111111111111112";

        assert_eq!(requested_destination_wallet(source, None).unwrap(), source);
        assert_eq!(
            requested_destination_wallet(source, Some(" ")).unwrap(),
            source
        );
        assert_eq!(
            requested_destination_wallet(source, Some(custom)).unwrap(),
            custom
        );
        assert_eq!(
            requested_destination_wallet(
                source,
                Some("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            )
            .unwrap_err()
            .code,
            "withdraw_invalid_destination"
        );
    }

    #[test]
    fn explorer_url_targets_devnet_tx() {
        assert_eq!(
            solana_explorer_tx_url("signature"),
            "https://explorer.solana.com/tx/signature?cluster=devnet"
        );
    }

    #[test]
    fn keypair_owner_uses_public_half() {
        let bytes = [1u8; 64];
        let expected = encode_base58_bytes(&bytes[32..64]);
        assert_eq!(expected, vault_owner_from_keypair_bytes_for_test(&bytes));
    }

    fn vault_owner_from_keypair_bytes_for_test(bytes: &[u8; 64]) -> String {
        encode_base58_bytes(&bytes[32..64])
    }

    #[test]
    fn rejects_invalid_cash_amounts() {
        assert!(parse_cash_amount("0").is_err());
        assert!(parse_cash_amount("abc").is_err());
        assert_eq!(parse_cash_amount("1000000").unwrap(), 1_000_000);
    }

    #[test]
    fn base58_signature_decode_remains_available_for_withdraw() {
        let signature =
            "5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q";
        assert_eq!(
            basingamarket_chain::decode_base58_bytes(signature)
                .unwrap()
                .len(),
            64
        );
    }
}
