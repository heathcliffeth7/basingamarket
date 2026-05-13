use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_chain::{is_valid_solana_signature, SolanaDevnetConfig, TOKEN_PROGRAM_ADDRESS};
use basingamarket_db::{CashDepositRow, SolDepositQuoteRow, SolDepositRow};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{wallet_sessions::require_wallet_owner, ApiError, AppState};

pub(crate) const LAMPORTS_PER_SOL: u128 = 1_000_000_000;
pub(crate) const SYSTEM_PROGRAM_ADDRESS: &str = "11111111111111111111111111111111";
const BUSDC_CURRENCY: &str = "BUSDC";

pub(crate) async fn get_deposit_config(
    State(state): State<AppState>,
) -> Json<DepositConfigResponse> {
    Json(DepositConfigResponse::from_config(&state.chain_config))
}

pub(crate) async fn get_deposit_liquidity(
    State(state): State<AppState>,
) -> Result<Json<DepositLiquidityResponse>, ApiError> {
    let config = match ResolvedDepositConfig::from_chain_config(&state.chain_config) {
        Ok(config) => config,
        Err(_) => return Ok(Json(DepositLiquidityResponse::pending(&state.chain_config))),
    };
    let client = rpc_client(&state)?;
    let vault_cash_balance =
        fetch_spl_token_balance(&client, &state.chain_config, &config.vault_token_account).await?;
    let total_cash_liabilities = state
        .store
        .total_cash_balance()
        .await
        .map_err(ApiError::internal)?;
    let available_cash_reserve = vault_cash_balance.saturating_sub(total_cash_liabilities);

    Ok(Json(DepositLiquidityResponse {
        cluster: state.chain_config.cluster.clone(),
        currency: BUSDC_CURRENCY,
        decimals: config.decimals,
        mint: Some(config.mint),
        vault_owner: state.chain_config.deposit_vault_owner.clone(),
        vault_token_account: Some(config.vault_token_account),
        vault_cash_balance: vault_cash_balance.to_string(),
        total_cash_liabilities: total_cash_liabilities.to_string(),
        available_cash_reserve: available_cash_reserve.to_string(),
        status: deposit_liquidity_status(available_cash_reserve),
    }))
}

pub(crate) async fn verify_profile_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Json(payload): Json<DepositRequest>,
) -> Result<Json<DepositVerificationResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address is invalid."))?;
    require_wallet_owner(&state, &headers, &wallet_address)?;
    let signature = payload.signature.trim().to_owned();
    if !is_valid_solana_signature(&signature) {
        return Err(ApiError::bad_request(
            "invalid_signature",
            "Solana signature is invalid.",
        ));
    }

    let config = ResolvedDepositConfig::from_chain_config(&state.chain_config)?;

    if let Some(existing) = state.store.get_cash_deposit(&signature).await {
        if existing.wallet_address != wallet_address {
            return Err(ApiError::bad_request(
                "deposit_wallet_mismatch",
                "Deposit signature was recorded for a different wallet.",
            ));
        }
        let cash_balance = state
            .store
            .get_cash_balance(&wallet_address)
            .await
            .map(|row| row.cash_balance)
            .unwrap_or(0);
        return Ok(Json(DepositVerificationResponse {
            wallet_address,
            signature,
            currency: BUSDC_CURRENCY,
            decimals: config.decimals,
            cash_balance: cash_balance.to_string(),
            deposited_amount: existing.amount.to_string(),
            status: "already_credited",
        }));
    }
    if state.store.get_sol_deposit(&signature).await.is_some() {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }
    if state.store.get_transfer_deposit(&signature).await.is_some() {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(state.chain_config.request_timeout_ms))
        .build()
        .map_err(ApiError::internal)?;
    let transaction = fetch_solana_transaction(&client, &state.chain_config, &signature).await?;
    let verified = verify_deposit_transaction(&transaction, &config, &wallet_address)?;
    let row = CashDepositRow {
        wallet_address: wallet_address.clone(),
        signature: signature.clone(),
        mint: config.mint.clone(),
        vault_token_account: config.vault_token_account.clone(),
        amount: verified.amount,
        slot: verified.slot,
        created_at: chrono::Utc::now(),
    };
    let (cash_balance, credited) = state
        .store
        .record_cash_deposit(row)
        .await
        .map_err(ApiError::internal)?;
    if credited {
        state.persist_cash_projection().await?;
    }

    Ok(Json(DepositVerificationResponse {
        wallet_address,
        signature,
        currency: BUSDC_CURRENCY,
        decimals: config.decimals,
        cash_balance: cash_balance.cash_balance.to_string(),
        deposited_amount: verified.amount.to_string(),
        status: if credited {
            "credited"
        } else {
            "already_credited"
        },
    }))
}

pub(crate) async fn get_sol_deposit_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Query(query): Query<SolDepositQuoteQuery>,
) -> Result<Json<SolDepositQuoteResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address is invalid."))?;
    require_wallet_owner(&state, &headers, &wallet_address)?;
    let cash_amount = query
        .cash_amount
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::bad_request("invalid_cash_amount", "Cash amount is invalid."))?;
    if cash_amount == 0 {
        return Err(ApiError::bad_request(
            "invalid_cash_amount",
            "Cash amount cannot be zero.",
        ));
    }
    let config = match ResolvedSolDepositConfig::from_chain_config(&state.chain_config) {
        Ok(config) => config,
        Err(_) => {
            return Ok(Json(SolDepositQuoteResponse::pending(
                wallet_address,
                cash_amount,
                "projection_pending",
            )))
        }
    };
    let price = state
        .sol_deposit_price_provider
        .sol_usdt_price(&config.price_symbol)
        .await?;
    let lamports = lamports_for_cash_amount(cash_amount, price)?;
    let client = rpc_client(&state)?;
    if !has_cash_reserve(&state, &client, &config.deposit, cash_amount).await? {
        return Ok(Json(SolDepositQuoteResponse {
            wallet_address,
            currency: BUSDC_CURRENCY,
            decimals: config.deposit.decimals,
            cash_amount: cash_amount.to_string(),
            quote_id: None,
            lamports: Some(lamports.to_string()),
            price: Some(price.to_string()),
            expires_at: None,
            treasury: Some(config.treasury),
            status: "liquidity_pending",
        }));
    }

    let now = Utc::now();
    let expires_at = now
        + chrono::Duration::seconds(
            i64::try_from(config.quote_ttl_seconds).map_err(ApiError::internal)?,
        );
    let quote_id = Uuid::new_v4().to_string();
    state
        .store
        .insert_sol_deposit_quote(SolDepositQuoteRow {
            quote_id: quote_id.clone(),
            wallet_address: wallet_address.clone(),
            cash_amount,
            lamports,
            price,
            treasury: config.treasury.clone(),
            expires_at,
            used_signature: None,
            created_at: now,
        })
        .await;
    state.persist_cash_projection().await?;

    Ok(Json(SolDepositQuoteResponse {
        wallet_address,
        currency: BUSDC_CURRENCY,
        decimals: config.deposit.decimals,
        cash_amount: cash_amount.to_string(),
        quote_id: Some(quote_id),
        lamports: Some(lamports.to_string()),
        price: Some(price.to_string()),
        expires_at: Some(expires_at),
        treasury: Some(config.treasury),
        status: "ready",
    }))
}

pub(crate) async fn verify_profile_sol_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Json(payload): Json<SolDepositRequest>,
) -> Result<Json<SolDepositVerificationResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address is invalid."))?;
    require_wallet_owner(&state, &headers, &wallet_address)?;
    let signature = payload.signature.trim().to_owned();
    if !is_valid_solana_signature(&signature) {
        return Err(ApiError::bad_request(
            "invalid_signature",
            "Solana signature is invalid.",
        ));
    }
    let config = ResolvedSolDepositConfig::from_chain_config(&state.chain_config)?;

    if let Some(existing) = state.store.get_sol_deposit(&signature).await {
        if existing.wallet_address != wallet_address {
            return Err(ApiError::bad_request(
                "deposit_wallet_mismatch",
                "Deposit signature was recorded for a different wallet.",
            ));
        }
        let cash_balance = state
            .store
            .get_cash_balance(&wallet_address)
            .await
            .map(|row| row.cash_balance)
            .unwrap_or(0);
        return Ok(Json(SolDepositVerificationResponse {
            wallet_address,
            signature,
            quote_id: existing.quote_id,
            currency: BUSDC_CURRENCY,
            decimals: config.deposit.decimals,
            cash_balance: cash_balance.to_string(),
            deposited_amount: existing.cash_amount.to_string(),
            lamports: existing.lamports.to_string(),
            price: existing.price.to_string(),
            status: "already_credited",
        }));
    }
    if state.store.get_cash_deposit(&signature).await.is_some() {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }
    if state.store.get_transfer_deposit(&signature).await.is_some() {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }

    let quote = state
        .store
        .get_sol_deposit_quote(payload.quote_id.trim())
        .await
        .ok_or_else(|| ApiError::bad_request("sol_deposit_quote_not_found", "Quote not found."))?;
    if quote.wallet_address != wallet_address {
        return Err(ApiError::bad_request(
            "sol_deposit_quote_wallet_mismatch",
            "Quote does not match this wallet.",
        ));
    }
    if quote.used_signature.is_some() {
        return Err(ApiError::bad_request(
            "sol_deposit_quote_used",
            "Quote has already been used.",
        ));
    }
    if quote.expires_at <= Utc::now() {
        return Err(ApiError::bad_request(
            "sol_deposit_quote_expired",
            "Quote has expired.",
        ));
    }
    if quote.treasury != config.treasury {
        return Err(ApiError::bad_request(
            "sol_deposit_treasury_mismatch",
            "Quote treasury does not match the current config.",
        ));
    }

    let client = rpc_client(&state)?;
    let transaction = fetch_solana_transaction(&client, &state.chain_config, &signature).await?;
    let verified = verify_sol_deposit_transaction(&transaction, &quote, &wallet_address)?;
    if !has_cash_reserve(&state, &client, &config.deposit, quote.cash_amount).await? {
        return Err(ApiError::service_unavailable(
            "sol_deposit_liquidity_pending",
            "App vault BUSDC reserve is too low.",
        ));
    }

    let row = SolDepositRow {
        wallet_address: wallet_address.clone(),
        signature: signature.clone(),
        quote_id: quote.quote_id.clone(),
        treasury: quote.treasury.clone(),
        lamports: quote.lamports,
        cash_amount: quote.cash_amount,
        price: quote.price,
        slot: verified.slot,
        created_at: Utc::now(),
    };
    let (cash_balance, credited) = state.store.record_sol_deposit(row).await.map_err(|error| {
        if error.to_string().contains("quote already used") {
            ApiError::bad_request("sol_deposit_quote_used", "Quote has already been used.")
        } else {
            ApiError::internal(error)
        }
    })?;
    if credited {
        state.persist_cash_projection().await?;
    }

    Ok(Json(SolDepositVerificationResponse {
        wallet_address,
        signature,
        quote_id: quote.quote_id,
        currency: BUSDC_CURRENCY,
        decimals: config.deposit.decimals,
        cash_balance: cash_balance.cash_balance.to_string(),
        deposited_amount: quote.cash_amount.to_string(),
        lamports: quote.lamports.to_string(),
        price: quote.price.to_string(),
        status: if credited {
            "credited"
        } else {
            "already_credited"
        },
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DepositRequest {
    signature: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SolDepositQuoteQuery {
    cash_amount: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SolDepositRequest {
    quote_id: String,
    signature: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct DepositConfigResponse {
    cluster: String,
    currency: &'static str,
    decimals: u8,
    mint: Option<String>,
    vault_owner: Option<String>,
    vault_token_account: Option<String>,
    commitment: String,
    status: &'static str,
}

impl DepositConfigResponse {
    fn from_config(config: &SolanaDevnetConfig) -> Self {
        Self {
            cluster: config.cluster.clone(),
            currency: BUSDC_CURRENCY,
            decimals: config.cash_decimals,
            mint: config.cash_mint.clone(),
            vault_owner: config.deposit_vault_owner.clone(),
            vault_token_account: config.resolved_deposit_vault_token_account(),
            commitment: config.deposit_commitment.clone(),
            status: config.deposit_status(),
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct DepositLiquidityResponse {
    cluster: String,
    currency: &'static str,
    decimals: u8,
    mint: Option<String>,
    vault_owner: Option<String>,
    vault_token_account: Option<String>,
    vault_cash_balance: String,
    total_cash_liabilities: String,
    available_cash_reserve: String,
    status: &'static str,
}

impl DepositLiquidityResponse {
    fn pending(config: &SolanaDevnetConfig) -> Self {
        Self {
            cluster: config.cluster.clone(),
            currency: BUSDC_CURRENCY,
            decimals: config.cash_decimals,
            mint: config.cash_mint.clone(),
            vault_owner: config.deposit_vault_owner.clone(),
            vault_token_account: config.resolved_deposit_vault_token_account(),
            vault_cash_balance: "0".to_owned(),
            total_cash_liabilities: "0".to_owned(),
            available_cash_reserve: "0".to_owned(),
            status: "projection_pending",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct DepositVerificationResponse {
    wallet_address: String,
    signature: String,
    currency: &'static str,
    decimals: u8,
    cash_balance: String,
    deposited_amount: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct SolDepositQuoteResponse {
    wallet_address: String,
    currency: &'static str,
    decimals: u8,
    cash_amount: String,
    quote_id: Option<String>,
    lamports: Option<String>,
    price: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    treasury: Option<String>,
    status: &'static str,
}

impl SolDepositQuoteResponse {
    fn pending(wallet_address: String, cash_amount: u128, status: &'static str) -> Self {
        Self {
            wallet_address,
            currency: BUSDC_CURRENCY,
            decimals: 6,
            cash_amount: cash_amount.to_string(),
            quote_id: None,
            lamports: None,
            price: None,
            expires_at: None,
            treasury: None,
            status,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct SolDepositVerificationResponse {
    wallet_address: String,
    signature: String,
    quote_id: String,
    currency: &'static str,
    decimals: u8,
    cash_balance: String,
    deposited_amount: String,
    lamports: String,
    price: String,
    status: &'static str,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedDepositConfig {
    pub(crate) mint: String,
    pub(crate) decimals: u8,
    pub(crate) vault_token_account: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSolDepositConfig {
    pub(crate) deposit: ResolvedDepositConfig,
    pub(crate) treasury: String,
    pub(crate) quote_ttl_seconds: u64,
    pub(crate) price_symbol: String,
}

impl ResolvedSolDepositConfig {
    pub(crate) fn from_chain_config(config: &SolanaDevnetConfig) -> Result<Self, ApiError> {
        let deposit = ResolvedDepositConfig::from_chain_config(config)?;
        if config.sol_deposit_status() != "ready" {
            return Err(ApiError::service_unavailable(
                "sol_deposit_projection_pending",
                "SOL deposit config is not ready yet.",
            ));
        }
        let treasury = config.sol_deposit_treasury.clone().ok_or_else(|| {
            ApiError::service_unavailable(
                "sol_deposit_projection_pending",
                "SOL treasury is not ready yet.",
            )
        })?;
        Ok(Self {
            deposit,
            treasury,
            quote_ttl_seconds: config.sol_deposit_quote_ttl_seconds,
            price_symbol: config.sol_deposit_price_symbol.clone(),
        })
    }
}

impl ResolvedDepositConfig {
    pub(crate) fn from_chain_config(config: &SolanaDevnetConfig) -> Result<Self, ApiError> {
        let mint = config.cash_mint.clone().ok_or_else(|| {
            ApiError::service_unavailable(
                "deposit_projection_pending",
                "Deposit config is not ready yet.",
            )
        })?;
        let vault_token_account =
            config
                .resolved_deposit_vault_token_account()
                .ok_or_else(|| {
                    ApiError::service_unavailable(
                        "deposit_projection_pending",
                        "Deposit vault is not ready yet.",
                    )
                })?;

        Ok(Self {
            mint,
            decimals: config.cash_decimals,
            vault_token_account,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VerifiedDeposit {
    amount: u128,
    slot: u64,
}

pub(crate) async fn fetch_solana_transaction(
    client: &reqwest::Client,
    config: &SolanaDevnetConfig,
    signature: &str,
) -> Result<Value, ApiError> {
    let response = client
        .post(&config.rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                signature,
                {
                    "encoding": "jsonParsed",
                    "commitment": config.deposit_commitment,
                    "maxSupportedTransactionVersion": 0
                }
            ]
        }))
        .send()
        .await
        .map_err(ApiError::internal)?;

    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::service_unavailable(
            "solana_rpc_unavailable",
            "Solana RPC is not responding right now.",
        ));
    }

    let body: Value = response.json().await.map_err(ApiError::internal)?;
    if let Some(error) = body.get("error") {
        tracing::warn!(
            ?error,
            signature,
            "Solana deposit transaction lookup failed"
        );
        return Err(ApiError::bad_request(
            "deposit_transaction_unavailable",
            "Deposit transaction could not be read.",
        ));
    }

    body.get("result")
        .filter(|value| !value.is_null())
        .cloned()
        .ok_or_else(|| {
            ApiError::bad_request(
                "deposit_not_confirmed",
                "Deposit transaction is not confirmed yet.",
            )
        })
}

fn verify_deposit_transaction(
    transaction: &Value,
    config: &ResolvedDepositConfig,
    wallet_address: &str,
) -> Result<VerifiedDeposit, ApiError> {
    if transaction
        .pointer("/meta/err")
        .is_some_and(|value| !value.is_null())
    {
        return Err(ApiError::bad_request(
            "deposit_transaction_failed",
            "Deposit transaction failed.",
        ));
    }

    if !signed_by_wallet(transaction, wallet_address) {
        return Err(ApiError::bad_request(
            "deposit_wrong_signer",
            "Deposit was not signed by the wallet.",
        ));
    }

    let slot = transaction
        .get("slot")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            ApiError::bad_request("deposit_missing_slot", "Deposit slot was not found.")
        })?;

    for instruction in parsed_instructions(transaction) {
        if !is_spl_transfer_checked(instruction) {
            continue;
        }
        let info = instruction.pointer("/parsed/info").ok_or_else(|| {
            ApiError::bad_request("deposit_parse_failed", "Deposit could not be parsed.")
        })?;
        let mint = string_field(info, "mint", "deposit_missing_mint")?;
        if mint != config.mint {
            return Err(ApiError::bad_request(
                "deposit_wrong_mint",
                "Deposit mint does not match the config.",
            ));
        }
        let destination = string_field(info, "destination", "deposit_missing_destination")?;
        if destination != config.vault_token_account {
            return Err(ApiError::bad_request(
                "deposit_wrong_vault",
                "Deposit vault does not match the config.",
            ));
        }
        let authority = string_field(info, "authority", "deposit_missing_authority")?;
        if authority != wallet_address {
            return Err(ApiError::bad_request(
                "deposit_wrong_authority",
                "Deposit authority does not match the wallet.",
            ));
        }
        let source = string_field(info, "source", "deposit_missing_source")?;
        let source_owner =
            token_balance_owner(transaction, source, &config.mint).ok_or_else(|| {
                ApiError::bad_request(
                    "deposit_source_owner_unverified",
                    "Deposit source owner could not be verified.",
                )
            })?;
        if source_owner != wallet_address {
            return Err(ApiError::bad_request(
                "deposit_wrong_source_owner",
                "Deposit source owner does not match the wallet.",
            ));
        }

        let decimals = info
            .pointer("/tokenAmount/decimals")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                ApiError::bad_request(
                    "deposit_missing_decimals",
                    "Deposit decimals were not found.",
                )
            })?;
        if decimals != u64::from(config.decimals) {
            return Err(ApiError::bad_request(
                "deposit_wrong_decimals",
                "Deposit decimals do not match the config.",
            ));
        }
        let amount = info
            .pointer("/tokenAmount/amount")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::bad_request("deposit_missing_amount", "Deposit amount was not found.")
            })?
            .parse::<u128>()
            .map_err(|_| {
                ApiError::bad_request("deposit_invalid_amount", "Deposit amount is invalid.")
            })?;
        if amount == 0 {
            return Err(ApiError::bad_request(
                "deposit_invalid_amount",
                "Deposit amount cannot be zero.",
            ));
        }

        return Ok(VerifiedDeposit { amount, slot });
    }

    Err(ApiError::bad_request(
        "deposit_transfer_not_found",
        "Valid SPL transfer was not found.",
    ))
}

pub(crate) fn lamports_for_cash_amount(cash_amount: u128, price: u128) -> Result<u64, ApiError> {
    if price == 0 {
        return Err(ApiError::service_unavailable(
            "sol_deposit_price_unavailable",
            "SOL price is unavailable right now.",
        ));
    }
    let numerator = cash_amount
        .checked_mul(LAMPORTS_PER_SOL)
        .ok_or_else(|| ApiError::bad_request("invalid_cash_amount", "Cash amount is invalid."))?;
    let lamports = numerator
        .checked_add(price - 1)
        .and_then(|value| value.checked_div(price))
        .ok_or_else(|| ApiError::bad_request("invalid_cash_amount", "Cash amount is invalid."))?;
    u64::try_from(lamports)
        .map_err(|_| ApiError::bad_request("invalid_cash_amount", "Cash amount is too large."))
}

pub(crate) fn rpc_client(state: &AppState) -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(state.chain_config.request_timeout_ms))
        .build()
        .map_err(ApiError::internal)
}

pub(crate) async fn has_cash_reserve(
    state: &AppState,
    client: &reqwest::Client,
    config: &ResolvedDepositConfig,
    new_credit: u128,
) -> Result<bool, ApiError> {
    let vault_balance =
        fetch_spl_token_balance(client, &state.chain_config, &config.vault_token_account).await?;
    let total_cash = state
        .store
        .total_cash_balance()
        .await
        .map_err(ApiError::internal)?;
    Ok(cash_reserve_covers_credit(
        vault_balance,
        total_cash,
        new_credit,
    ))
}

pub(crate) fn cash_reserve_covers_credit(
    vault_balance: u128,
    total_cash: u128,
    new_credit: u128,
) -> bool {
    vault_balance >= total_cash.saturating_add(new_credit)
}

fn deposit_liquidity_status(available_cash_reserve: u128) -> &'static str {
    if available_cash_reserve > 0 {
        "ready"
    } else {
        "liquidity_pending"
    }
}

async fn fetch_spl_token_balance(
    client: &reqwest::Client,
    config: &SolanaDevnetConfig,
    token_account: &str,
) -> Result<u128, ApiError> {
    let response = client
        .post(&config.rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenAccountBalance",
            "params": [
                token_account,
                { "commitment": config.deposit_commitment }
            ]
        }))
        .send()
        .await
        .map_err(ApiError::internal)?;
    if !response.status().is_success() {
        return Err(ApiError::service_unavailable(
            "solana_rpc_unavailable",
            "Solana RPC is not responding right now.",
        ));
    }

    let body: Value = response.json().await.map_err(ApiError::internal)?;
    if let Some(error) = body.get("error") {
        let missing_account = error
            .get("message")
            .and_then(Value::as_str)
            .is_some_and(|message| message.contains("could not find account"));
        return if missing_account {
            Ok(0)
        } else {
            tracing::warn!(?error, token_account, "Solana token balance lookup failed");
            Err(ApiError::service_unavailable(
                "solana_rpc_unavailable",
                "Solana RPC is not responding right now.",
            ))
        };
    }

    body.pointer("/result/value/amount")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            ApiError::service_unavailable(
                "solana_rpc_unavailable",
                "Solana RPC is not responding right now.",
            )
        })?
        .parse::<u128>()
        .map_err(ApiError::internal)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VerifiedSolDeposit {
    slot: u64,
}

fn verify_sol_deposit_transaction(
    transaction: &Value,
    quote: &SolDepositQuoteRow,
    wallet_address: &str,
) -> Result<VerifiedSolDeposit, ApiError> {
    if transaction
        .pointer("/meta/err")
        .is_some_and(|value| !value.is_null())
    {
        return Err(ApiError::bad_request(
            "deposit_transaction_failed",
            "Deposit transaction failed.",
        ));
    }
    if !signed_by_wallet(transaction, wallet_address) {
        return Err(ApiError::bad_request(
            "deposit_wrong_signer",
            "Deposit was not signed by the wallet.",
        ));
    }
    let slot = transaction
        .get("slot")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            ApiError::bad_request("deposit_missing_slot", "Deposit slot was not found.")
        })?;

    for instruction in parsed_instructions(transaction) {
        if !is_system_transfer(instruction) {
            continue;
        }
        let info = instruction.pointer("/parsed/info").ok_or_else(|| {
            ApiError::bad_request(
                "sol_deposit_parse_failed",
                "SOL deposit could not be parsed.",
            )
        })?;
        let source = string_field(info, "source", "sol_deposit_missing_source")?;
        if source != wallet_address {
            return Err(ApiError::bad_request(
                "sol_deposit_wrong_source",
                "SOL transfer source does not match the wallet.",
            ));
        }
        let destination = string_field(info, "destination", "sol_deposit_missing_destination")?;
        if destination != quote.treasury {
            return Err(ApiError::bad_request(
                "sol_deposit_wrong_treasury",
                "SOL transfer treasury does not match.",
            ));
        }
        let lamports = info
            .get("lamports")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                ApiError::bad_request(
                    "sol_deposit_missing_lamports",
                    "SOL transfer lamports are missing.",
                )
            })?;
        if lamports != quote.lamports {
            return Err(ApiError::bad_request(
                "sol_deposit_wrong_lamports",
                "SOL transfer amount does not match the quote.",
            ));
        }

        return Ok(VerifiedSolDeposit { slot });
    }

    Err(ApiError::bad_request(
        "sol_deposit_transfer_not_found",
        "Valid SOL transfer was not found.",
    ))
}

pub(crate) fn parsed_instructions(transaction: &Value) -> Vec<&Value> {
    let mut instructions = Vec::new();
    if let Some(top_level) = transaction
        .pointer("/transaction/message/instructions")
        .and_then(Value::as_array)
    {
        instructions.extend(top_level.iter());
    }
    if let Some(inner_groups) = transaction
        .pointer("/meta/innerInstructions")
        .and_then(Value::as_array)
    {
        for group in inner_groups {
            if let Some(inner) = group.get("instructions").and_then(Value::as_array) {
                instructions.extend(inner.iter());
            }
        }
    }
    instructions
}

pub(crate) fn is_spl_transfer_checked(instruction: &Value) -> bool {
    let is_token_program = instruction
        .get("programId")
        .and_then(Value::as_str)
        .is_some_and(|program_id| program_id == TOKEN_PROGRAM_ADDRESS)
        || instruction
            .get("program")
            .and_then(Value::as_str)
            .is_some_and(|program| program == "spl-token");
    let is_transfer_checked = instruction
        .pointer("/parsed/type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "transferChecked");
    is_token_program && is_transfer_checked
}

pub(crate) fn is_system_transfer(instruction: &Value) -> bool {
    let is_system_program = instruction
        .get("programId")
        .and_then(Value::as_str)
        .is_some_and(|program_id| program_id == SYSTEM_PROGRAM_ADDRESS)
        || instruction
            .get("program")
            .and_then(Value::as_str)
            .is_some_and(|program| program == "system");
    let is_transfer = instruction
        .pointer("/parsed/type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "transfer");
    is_system_program && is_transfer
}

fn signed_by_wallet(transaction: &Value, wallet_address: &str) -> bool {
    transaction
        .pointer("/transaction/message/accountKeys")
        .and_then(Value::as_array)
        .is_some_and(|keys| {
            keys.iter().any(|key| {
                account_key_pubkey(key) == Some(wallet_address)
                    && key.get("signer").and_then(Value::as_bool) == Some(true)
            })
        })
}

fn token_balance_owner<'a>(
    transaction: &'a Value,
    token_account: &str,
    mint: &str,
) -> Option<&'a str> {
    let account_index = transaction
        .pointer("/transaction/message/accountKeys")
        .and_then(Value::as_array)?
        .iter()
        .position(|key| account_key_pubkey(key) == Some(token_account))?;
    transaction
        .pointer("/meta/preTokenBalances")
        .and_then(Value::as_array)?
        .iter()
        .find(|balance| {
            balance
                .get("accountIndex")
                .and_then(Value::as_u64)
                .is_some_and(|index| index as usize == account_index)
                && balance
                    .get("mint")
                    .and_then(Value::as_str)
                    .is_some_and(|candidate| candidate == mint)
        })?
        .get("owner")
        .and_then(Value::as_str)
}

fn account_key_pubkey(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("pubkey").and_then(Value::as_str))
}

pub(crate) fn string_field<'a>(
    value: &'a Value,
    field: &'static str,
    code: &'static str,
) -> Result<&'a str, ApiError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request(code, "Deposit transaction fields are missing."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALLET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const MINT: &str = "So11111111111111111111111111111111111111112";
    const SOURCE: &str = "SysvarRent111111111111111111111111111111111";
    const VAULT: &str = "11111111111111111111111111111111";
    const TREASURY: &str = "SysvarC1ock11111111111111111111111111111111";

    fn config() -> ResolvedDepositConfig {
        let chain_config = SolanaDevnetConfig::from_all_values(
            None,
            None,
            None,
            None,
            None,
            Some(MINT.to_owned()),
            Some(6),
            Some(WALLET.to_owned()),
            Some(VAULT.to_owned()),
            Some("confirmed".to_owned()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        ResolvedDepositConfig::from_chain_config(&chain_config).unwrap()
    }

    #[test]
    fn reserve_cover_allows_exact_backing_for_cash_buys_but_not_new_credits() {
        assert!(cash_reserve_covers_credit(
            50_003_000_000,
            50_003_000_000,
            0
        ));
        assert!(!cash_reserve_covers_credit(17_000_000, 50_003_000_000, 0));
        assert!(!cash_reserve_covers_credit(
            50_003_000_000,
            50_003_000_000,
            1
        ));
    }

    fn transaction(overrides: Value) -> Value {
        let mut value = json!({
            "slot": 42,
            "meta": {
                "err": null,
                "preTokenBalances": [
                    {
                        "accountIndex": 1,
                        "mint": MINT,
                        "owner": WALLET,
                        "uiTokenAmount": {
                            "amount": "2500000",
                            "decimals": 6
                        }
                    }
                ]
            },
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": WALLET, "signer": true, "writable": true },
                        { "pubkey": SOURCE, "signer": false, "writable": true },
                        { "pubkey": MINT, "signer": false, "writable": false },
                        { "pubkey": VAULT, "signer": false, "writable": true }
                    ],
                    "instructions": [
                        {
                            "program": "spl-token",
                            "programId": TOKEN_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transferChecked",
                                "info": {
                                    "source": SOURCE,
                                    "mint": MINT,
                                    "destination": VAULT,
                                    "authority": WALLET,
                                    "tokenAmount": {
                                        "amount": "2500000",
                                        "decimals": 6
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        });
        merge(&mut value, overrides);
        value
    }

    fn sol_quote() -> SolDepositQuoteRow {
        SolDepositQuoteRow {
            quote_id: "quote-1".to_owned(),
            wallet_address: WALLET.to_owned(),
            cash_amount: 1_000_000,
            lamports: 6_666_667,
            price: 150_000_000,
            treasury: TREASURY.to_owned(),
            expires_at: Utc::now() + chrono::Duration::seconds(60),
            used_signature: None,
            created_at: Utc::now(),
        }
    }

    fn sol_transaction(overrides: Value) -> Value {
        let mut value = json!({
            "slot": 99,
            "meta": { "err": null },
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": WALLET, "signer": true, "writable": true },
                        { "pubkey": TREASURY, "signer": false, "writable": true }
                    ],
                    "instructions": [
                        {
                            "program": "system",
                            "programId": SYSTEM_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transfer",
                                "info": {
                                    "source": WALLET,
                                    "destination": TREASURY,
                                    "lamports": 6666667
                                }
                            }
                        }
                    ]
                }
            }
        });
        merge(&mut value, overrides);
        value
    }

    fn merge(target: &mut Value, patch: Value) {
        match (target, patch) {
            (Value::Object(target), Value::Object(patch)) => {
                for (key, value) in patch {
                    merge(target.entry(key).or_insert(Value::Null), value);
                }
            }
            (target, patch) => *target = patch,
        }
    }

    #[test]
    fn verifies_confirmed_spl_transfer() {
        let verified =
            verify_deposit_transaction(&transaction(json!({})), &config(), WALLET).unwrap();

        assert_eq!(
            verified,
            VerifiedDeposit {
                amount: 2_500_000,
                slot: 42
            }
        );
    }

    #[test]
    fn rejects_wrong_mint_or_vault() {
        let wrong_mint = transaction(json!({
            "transaction": {
                "message": {
                    "instructions": [
                        {
                            "program": "spl-token",
                            "programId": TOKEN_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transferChecked",
                                "info": {
                                    "source": SOURCE,
                                    "mint": WALLET,
                                    "destination": VAULT,
                                    "authority": WALLET,
                                    "tokenAmount": {
                                        "amount": "2500000",
                                        "decimals": 6
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }));
        assert_eq!(
            verify_deposit_transaction(&wrong_mint, &config(), WALLET)
                .unwrap_err()
                .code,
            "deposit_wrong_mint"
        );

        let wrong_vault = transaction(json!({
            "transaction": {
                "message": {
                    "instructions": [
                        {
                            "program": "spl-token",
                            "programId": TOKEN_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transferChecked",
                                "info": {
                                    "source": SOURCE,
                                    "mint": MINT,
                                    "destination": WALLET,
                                    "authority": WALLET,
                                    "tokenAmount": {
                                        "amount": "2500000",
                                        "decimals": 6
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }));
        assert_eq!(
            verify_deposit_transaction(&wrong_vault, &config(), WALLET)
                .unwrap_err()
                .code,
            "deposit_wrong_vault"
        );
    }

    #[test]
    fn rejects_failed_transaction_or_wrong_signer() {
        let failed =
            transaction(json!({ "meta": { "err": { "InstructionError": [0, "Custom"] } } }));
        assert_eq!(
            verify_deposit_transaction(&failed, &config(), WALLET)
                .unwrap_err()
                .code,
            "deposit_transaction_failed"
        );

        let wrong_signer = transaction(json!({
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": WALLET, "signer": false, "writable": true },
                        { "pubkey": SOURCE, "signer": false, "writable": true },
                        { "pubkey": MINT, "signer": false, "writable": false },
                        { "pubkey": VAULT, "signer": false, "writable": true }
                    ]
                }
            }
        }));
        assert_eq!(
            verify_deposit_transaction(&wrong_signer, &config(), WALLET)
                .unwrap_err()
                .code,
            "deposit_wrong_signer"
        );
    }

    #[test]
    fn calculates_sol_lamports_from_binance_scaled_price() {
        assert_eq!(
            lamports_for_cash_amount(1_000_000, 150_000_000).unwrap(),
            6_666_667
        );
    }

    #[test]
    fn verifies_sol_transfer_against_quote() {
        let verified =
            verify_sol_deposit_transaction(&sol_transaction(json!({})), &sol_quote(), WALLET)
                .unwrap();
        assert_eq!(verified.slot, 99);

        let wrong_lamports = sol_transaction(json!({
            "transaction": {
                "message": {
                    "instructions": [
                        {
                            "program": "system",
                            "programId": SYSTEM_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transfer",
                                "info": {
                                    "source": WALLET,
                                    "destination": TREASURY,
                                    "lamports": 1
                                }
                            }
                        }
                    ]
                }
            }
        }));
        assert_eq!(
            verify_sol_deposit_transaction(&wrong_lamports, &sol_quote(), WALLET)
                .unwrap_err()
                .code,
            "sol_deposit_wrong_lamports"
        );
    }
}
