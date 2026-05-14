use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_chain::is_valid_solana_signature;
use basingamarket_db::{TransferDepositQuoteRow, TransferDepositRow};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{deposits, wallet_sessions::require_wallet_owner, ApiError, AppState};

const MEMO_PROGRAM_ADDRESS: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const LEGACY_MEMO_PROGRAM_ADDRESS: &str = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
const BUSDC_CURRENCY: &str = "BUSDC";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
enum TransferDepositAsset {
    #[serde(rename = "BUSDC", alias = "USDC")]
    Busdc,
    #[serde(rename = "SOL")]
    Sol,
}

impl TransferDepositAsset {
    fn as_str(self) -> &'static str {
        match self {
            Self::Busdc => "BUSDC",
            Self::Sol => "SOL",
        }
    }
}

fn public_transfer_asset(asset: &str) -> String {
    match asset {
        "USDC" | "BUSDC" => "BUSDC".to_owned(),
        other => other.to_owned(),
    }
}

pub(crate) async fn create_transfer_deposit_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Json(payload): Json<TransferDepositQuoteRequest>,
) -> Result<Json<TransferDepositQuoteResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address is invalid."))?;
    require_wallet_owner(&state, &headers, &wallet_address).await?;
    let cash_amount = parse_cash_amount(&payload.cash_amount)?;

    match payload.asset {
        TransferDepositAsset::Busdc => create_busdc_quote(state, wallet_address, cash_amount).await,
        TransferDepositAsset::Sol => create_sol_quote(state, wallet_address, cash_amount).await,
    }
}

pub(crate) async fn verify_transfer_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Json(payload): Json<TransferDepositRequest>,
) -> Result<Json<TransferDepositVerificationResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address is invalid."))?;
    require_wallet_owner(&state, &headers, &wallet_address).await?;
    let signature = payload.signature.trim().to_owned();
    if !is_valid_solana_signature(&signature) {
        return Err(ApiError::bad_request(
            "invalid_signature",
            "Solana signature is invalid.",
        ));
    }

    if let Some(existing) = state.store.get_transfer_deposit(&signature).await {
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
        return Ok(Json(TransferDepositVerificationResponse {
            wallet_address,
            signature,
            quote_id: existing.quote_id,
            asset: public_transfer_asset(&existing.asset),
            currency: BUSDC_CURRENCY,
            decimals: 6,
            cash_balance: cash_balance.to_string(),
            deposited_amount: existing.cash_amount.to_string(),
            transfer_amount: existing.transfer_amount.to_string(),
            price: existing.price.map(|price| price.to_string()),
            status: "already_credited",
        }));
    }
    if state.store.get_cash_deposit(&signature).await.is_some()
        || state.store.get_sol_deposit(&signature).await.is_some()
    {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }

    let client = deposits::rpc_client(&state)?;
    let payload_quote_id = payload
        .quote_id
        .as_deref()
        .map(str::trim)
        .filter(|quote_id| !quote_id.is_empty());
    let (quote_id, transaction) = if let Some(quote_id) = payload_quote_id {
        (quote_id.to_owned(), None)
    } else {
        let transaction =
            deposits::fetch_solana_transaction(&client, &state.chain_config, &signature).await?;
        let quote_id = transfer_deposit_quote_id_from_transaction(&transaction)?;
        (quote_id, Some(transaction))
    };

    let quote = state
        .store
        .get_transfer_deposit_quote(&quote_id)
        .await
        .ok_or_else(|| {
            ApiError::bad_request("transfer_deposit_quote_not_found", "Quote not found.")
        })?;
    if quote.wallet_address != wallet_address {
        return Err(ApiError::bad_request(
            "transfer_deposit_quote_wallet_mismatch",
            "Quote does not match this wallet.",
        ));
    }
    if quote.used_signature.is_some() {
        return Err(ApiError::bad_request(
            "transfer_deposit_quote_used",
            "Quote has already been used.",
        ));
    }
    if quote.expires_at <= Utc::now() {
        return Err(ApiError::bad_request(
            "transfer_deposit_quote_expired",
            "Quote has expired.",
        ));
    }

    let transaction = match transaction {
        Some(transaction) => transaction,
        None => {
            deposits::fetch_solana_transaction(&client, &state.chain_config, &signature).await?
        }
    };
    let slot = match quote.asset.as_str() {
        "BUSDC" | "USDC" => {
            let config = deposits::ResolvedDepositConfig::from_chain_config(&state.chain_config)?;
            verify_busdc_transfer(&transaction, &quote, &config)?
        }
        "SOL" => {
            let config =
                deposits::ResolvedSolDepositConfig::from_chain_config(&state.chain_config)?;
            if quote.destination != config.treasury {
                return Err(ApiError::bad_request(
                    "transfer_deposit_destination_mismatch",
                    "Quote destination does not match the current config.",
                ));
            }
            let slot = verify_sol_transfer(&transaction, &quote)?;
            if !deposits::has_cash_reserve(&state, &client, &config.deposit, quote.cash_amount)
                .await?
            {
                return Err(ApiError::service_unavailable(
                    "transfer_deposit_liquidity_pending",
                    "App vault BUSDC reserve is too low.",
                ));
            }
            slot
        }
        _ => {
            return Err(ApiError::bad_request(
                "transfer_deposit_asset_invalid",
                "Transfer asset is invalid.",
            ))
        }
    };

    let row = TransferDepositRow {
        wallet_address: wallet_address.clone(),
        signature: signature.clone(),
        quote_id: quote.quote_id.clone(),
        asset: quote.asset.clone(),
        destination: quote.destination.clone(),
        transfer_amount: quote.transfer_amount,
        cash_amount: quote.cash_amount,
        price: quote.price,
        slot,
        created_at: Utc::now(),
    };
    let (cash_balance, credited) =
        state
            .store
            .record_transfer_deposit(row)
            .await
            .map_err(|error| {
                if error.to_string().contains("quote already used") {
                    ApiError::bad_request(
                        "transfer_deposit_quote_used",
                        "Quote has already been used.",
                    )
                } else {
                    ApiError::internal(error)
                }
            })?;
    if credited {
        state.persist_cash_projection().await?;
    }

    Ok(Json(TransferDepositVerificationResponse {
        wallet_address,
        signature,
        quote_id: quote.quote_id,
        asset: public_transfer_asset(&quote.asset),
        currency: BUSDC_CURRENCY,
        decimals: 6,
        cash_balance: cash_balance.cash_balance.to_string(),
        deposited_amount: quote.cash_amount.to_string(),
        transfer_amount: quote.transfer_amount.to_string(),
        price: quote.price.map(|price| price.to_string()),
        status: if credited {
            "credited"
        } else {
            "already_credited"
        },
    }))
}

async fn create_busdc_quote(
    state: AppState,
    wallet_address: String,
    cash_amount: u128,
) -> Result<Json<TransferDepositQuoteResponse>, ApiError> {
    let config = match deposits::ResolvedDepositConfig::from_chain_config(&state.chain_config) {
        Ok(config) => config,
        Err(_) => {
            return Ok(Json(TransferDepositQuoteResponse::pending(
                wallet_address,
                TransferDepositAsset::Busdc,
                cash_amount,
                "projection_pending",
            )))
        }
    };
    let quote_id = Uuid::new_v4().to_string();
    let reference = deposit_reference(&quote_id);
    let now = Utc::now();
    let expires_at = quote_expires_at(&state, now)?;
    state
        .store
        .insert_transfer_deposit_quote(TransferDepositQuoteRow {
            quote_id: quote_id.clone(),
            wallet_address: wallet_address.clone(),
            asset: TransferDepositAsset::Busdc.as_str().to_owned(),
            cash_amount,
            transfer_amount: cash_amount,
            price: None,
            destination: config.vault_token_account.clone(),
            mint: Some(config.mint.clone()),
            reference: reference.clone(),
            expires_at,
            used_signature: None,
            created_at: now,
        })
        .await;
    state.persist_cash_projection().await?;

    Ok(Json(TransferDepositQuoteResponse {
        wallet_address,
        asset: TransferDepositAsset::Busdc.as_str(),
        currency: BUSDC_CURRENCY,
        decimals: config.decimals,
        cash_amount: cash_amount.to_string(),
        quote_id: Some(quote_id),
        reference: Some(reference),
        transfer_amount: Some(cash_amount.to_string()),
        price: None,
        expires_at: Some(expires_at),
        destination: Some(config.vault_token_account),
        mint: Some(config.mint),
        status: "ready",
    }))
}

async fn create_sol_quote(
    state: AppState,
    wallet_address: String,
    cash_amount: u128,
) -> Result<Json<TransferDepositQuoteResponse>, ApiError> {
    let config = match deposits::ResolvedSolDepositConfig::from_chain_config(&state.chain_config) {
        Ok(config) => config,
        Err(_) => {
            return Ok(Json(TransferDepositQuoteResponse::pending(
                wallet_address,
                TransferDepositAsset::Sol,
                cash_amount,
                "projection_pending",
            )))
        }
    };
    let price = state
        .sol_deposit_price_provider
        .sol_usdt_price(&config.price_symbol)
        .await?;
    let lamports = deposits::lamports_for_cash_amount(cash_amount, price)?;
    let client = deposits::rpc_client(&state)?;
    if !deposits::has_cash_reserve(&state, &client, &config.deposit, cash_amount).await? {
        return Ok(Json(TransferDepositQuoteResponse {
            wallet_address,
            asset: TransferDepositAsset::Sol.as_str(),
            currency: BUSDC_CURRENCY,
            decimals: config.deposit.decimals,
            cash_amount: cash_amount.to_string(),
            quote_id: None,
            reference: None,
            transfer_amount: Some(lamports.to_string()),
            price: Some(price.to_string()),
            expires_at: None,
            destination: Some(config.treasury),
            mint: None,
            status: "liquidity_pending",
        }));
    }

    let quote_id = Uuid::new_v4().to_string();
    let reference = deposit_reference(&quote_id);
    let now = Utc::now();
    let expires_at = quote_expires_at(&state, now)?;
    state
        .store
        .insert_transfer_deposit_quote(TransferDepositQuoteRow {
            quote_id: quote_id.clone(),
            wallet_address: wallet_address.clone(),
            asset: TransferDepositAsset::Sol.as_str().to_owned(),
            cash_amount,
            transfer_amount: u128::from(lamports),
            price: Some(price),
            destination: config.treasury.clone(),
            mint: None,
            reference: reference.clone(),
            expires_at,
            used_signature: None,
            created_at: now,
        })
        .await;
    state.persist_cash_projection().await?;

    Ok(Json(TransferDepositQuoteResponse {
        wallet_address,
        asset: TransferDepositAsset::Sol.as_str(),
        currency: BUSDC_CURRENCY,
        decimals: config.deposit.decimals,
        cash_amount: cash_amount.to_string(),
        quote_id: Some(quote_id),
        reference: Some(reference),
        transfer_amount: Some(lamports.to_string()),
        price: Some(price.to_string()),
        expires_at: Some(expires_at),
        destination: Some(config.treasury),
        mint: None,
        status: "ready",
    }))
}

fn parse_cash_amount(value: &str) -> Result<u128, ApiError> {
    let amount = value
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::bad_request("invalid_cash_amount", "Cash amount is invalid."))?;
    if amount == 0 {
        return Err(ApiError::bad_request(
            "invalid_cash_amount",
            "Cash amount cannot be zero.",
        ));
    }
    Ok(amount)
}

fn quote_expires_at(state: &AppState, now: DateTime<Utc>) -> Result<DateTime<Utc>, ApiError> {
    Ok(now
        + chrono::Duration::seconds(
            i64::try_from(state.chain_config.sol_deposit_quote_ttl_seconds)
                .map_err(ApiError::internal)?,
        ))
}

fn deposit_reference(quote_id: &str) -> String {
    format!("bm:{quote_id}")
}

fn verify_busdc_transfer(
    transaction: &Value,
    quote: &TransferDepositQuoteRow,
    config: &deposits::ResolvedDepositConfig,
) -> Result<u64, ApiError> {
    verify_transaction_ok(transaction)?;
    if quote.destination != config.vault_token_account
        || quote.mint.as_deref() != Some(&config.mint)
    {
        return Err(ApiError::bad_request(
            "transfer_deposit_destination_mismatch",
            "Quote destination does not match the current config.",
        ));
    }
    if !has_reference_memo(transaction, &quote.reference) {
        return Err(ApiError::bad_request(
            "transfer_deposit_reference_missing",
            "Transfer memo/reference is missing or invalid.",
        ));
    }
    let slot = transaction_slot(transaction)?;
    for instruction in deposits::parsed_instructions(transaction) {
        if !deposits::is_spl_transfer_checked(instruction) {
            continue;
        }
        let info = instruction.pointer("/parsed/info").ok_or_else(|| {
            ApiError::bad_request(
                "transfer_deposit_parse_failed",
                "Transfer could not be parsed.",
            )
        })?;
        let mint = deposits::string_field(info, "mint", "transfer_deposit_missing_mint")?;
        let destination =
            deposits::string_field(info, "destination", "transfer_deposit_missing_destination")?;
        let decimals = info
            .pointer("/tokenAmount/decimals")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                ApiError::bad_request(
                    "transfer_deposit_missing_decimals",
                    "Transfer decimals are missing.",
                )
            })?;
        let amount = info
            .pointer("/tokenAmount/amount")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::bad_request(
                    "transfer_deposit_missing_amount",
                    "Transfer amount is missing.",
                )
            })?
            .parse::<u128>()
            .map_err(|_| {
                ApiError::bad_request(
                    "transfer_deposit_invalid_amount",
                    "Transfer amount is invalid.",
                )
            })?;
        if mint == config.mint
            && destination == quote.destination
            && decimals == u64::from(config.decimals)
            && amount == quote.transfer_amount
        {
            return Ok(slot);
        }
    }

    Err(ApiError::bad_request(
        "transfer_deposit_transfer_not_found",
        "BUSDC transfer matching the quote was not found.",
    ))
}

fn verify_sol_transfer(
    transaction: &Value,
    quote: &TransferDepositQuoteRow,
) -> Result<u64, ApiError> {
    verify_transaction_ok(transaction)?;
    if !has_reference_memo(transaction, &quote.reference) {
        return Err(ApiError::bad_request(
            "transfer_deposit_reference_missing",
            "Transfer memo/reference is missing or invalid.",
        ));
    }
    let slot = transaction_slot(transaction)?;
    for instruction in deposits::parsed_instructions(transaction) {
        if !deposits::is_system_transfer(instruction) {
            continue;
        }
        let info = instruction.pointer("/parsed/info").ok_or_else(|| {
            ApiError::bad_request(
                "transfer_deposit_parse_failed",
                "Transfer could not be parsed.",
            )
        })?;
        let destination =
            deposits::string_field(info, "destination", "transfer_deposit_missing_destination")?;
        let lamports = info
            .get("lamports")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                ApiError::bad_request("transfer_deposit_missing_lamports", "Lamports are missing.")
            })?;
        if destination == quote.destination && u128::from(lamports) == quote.transfer_amount {
            return Ok(slot);
        }
    }

    Err(ApiError::bad_request(
        "transfer_deposit_transfer_not_found",
        "SOL transfer matching the quote was not found.",
    ))
}

fn verify_transaction_ok(transaction: &Value) -> Result<(), ApiError> {
    if transaction
        .pointer("/meta/err")
        .is_some_and(|value| !value.is_null())
    {
        return Err(ApiError::bad_request(
            "deposit_transaction_failed",
            "Deposit transaction failed.",
        ));
    }
    Ok(())
}

fn transaction_slot(transaction: &Value) -> Result<u64, ApiError> {
    transaction
        .get("slot")
        .and_then(Value::as_u64)
        .ok_or_else(|| ApiError::bad_request("deposit_missing_slot", "Deposit slot was not found."))
}

fn has_reference_memo(transaction: &Value, reference: &str) -> bool {
    deposits::parsed_instructions(transaction)
        .iter()
        .any(|instruction| {
            is_memo_instruction(instruction) && memo_text(instruction) == Some(reference)
        })
}

fn transfer_deposit_quote_id_from_transaction(transaction: &Value) -> Result<String, ApiError> {
    deposits::parsed_instructions(transaction)
        .iter()
        .filter(|instruction| is_memo_instruction(instruction))
        .filter_map(|instruction| memo_text(instruction))
        .find_map(|memo| {
            memo.strip_prefix("bm:")
                .filter(|quote_id| !quote_id.is_empty())
        })
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError::bad_request(
                "transfer_deposit_reference_missing",
                "Transfer memo/reference is missing or invalid.",
            )
        })
}

fn is_memo_instruction(instruction: &Value) -> bool {
    instruction
        .get("programId")
        .and_then(Value::as_str)
        .is_some_and(|program_id| {
            program_id == MEMO_PROGRAM_ADDRESS || program_id == LEGACY_MEMO_PROGRAM_ADDRESS
        })
        || instruction
            .get("program")
            .and_then(Value::as_str)
            .is_some_and(|program| program == "spl-memo" || program == "memo")
}

fn memo_text(instruction: &Value) -> Option<&str> {
    instruction
        .get("parsed")
        .and_then(Value::as_str)
        .or_else(|| {
            instruction
                .pointer("/parsed/info/memo")
                .and_then(Value::as_str)
        })
        .or_else(|| instruction.pointer("/parsed/info").and_then(Value::as_str))
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransferDepositQuoteRequest {
    asset: TransferDepositAsset,
    cash_amount: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransferDepositRequest {
    quote_id: Option<String>,
    signature: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TransferDepositQuoteResponse {
    wallet_address: String,
    asset: &'static str,
    currency: &'static str,
    decimals: u8,
    cash_amount: String,
    quote_id: Option<String>,
    reference: Option<String>,
    transfer_amount: Option<String>,
    price: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    destination: Option<String>,
    mint: Option<String>,
    status: &'static str,
}

impl TransferDepositQuoteResponse {
    fn pending(
        wallet_address: String,
        asset: TransferDepositAsset,
        cash_amount: u128,
        status: &'static str,
    ) -> Self {
        Self {
            wallet_address,
            asset: asset.as_str(),
            currency: BUSDC_CURRENCY,
            decimals: 6,
            cash_amount: cash_amount.to_string(),
            quote_id: None,
            reference: None,
            transfer_amount: None,
            price: None,
            expires_at: None,
            destination: None,
            mint: None,
            status,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct TransferDepositVerificationResponse {
    wallet_address: String,
    signature: String,
    quote_id: String,
    asset: String,
    currency: &'static str,
    decimals: u8,
    cash_balance: String,
    deposited_amount: String,
    transfer_amount: String,
    price: Option<String>,
    status: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;
    use basingamarket_chain::TOKEN_PROGRAM_ADDRESS;
    use serde_json::json;

    const WALLET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const MINT: &str = "So11111111111111111111111111111111111111112";
    const VAULT: &str = "11111111111111111111111111111111";
    const SOURCE: &str = "SysvarRent111111111111111111111111111111111";
    const TREASURY: &str = "SysvarC1ock11111111111111111111111111111111";

    fn busdc_quote() -> TransferDepositQuoteRow {
        TransferDepositQuoteRow {
            quote_id: "quote-1".to_owned(),
            wallet_address: WALLET.to_owned(),
            asset: "BUSDC".to_owned(),
            cash_amount: 2_500_000,
            transfer_amount: 2_500_000,
            price: None,
            destination: VAULT.to_owned(),
            mint: Some(MINT.to_owned()),
            reference: "bm:quote-1".to_owned(),
            expires_at: Utc::now() + chrono::Duration::seconds(60),
            used_signature: None,
            created_at: Utc::now(),
        }
    }

    fn sol_quote() -> TransferDepositQuoteRow {
        TransferDepositQuoteRow {
            quote_id: "quote-2".to_owned(),
            wallet_address: WALLET.to_owned(),
            asset: "SOL".to_owned(),
            cash_amount: 1_000_000,
            transfer_amount: 6_666_667,
            price: Some(150_000_000),
            destination: TREASURY.to_owned(),
            mint: None,
            reference: "bm:quote-2".to_owned(),
            expires_at: Utc::now() + chrono::Duration::seconds(60),
            used_signature: None,
            created_at: Utc::now(),
        }
    }

    fn deposit_config() -> deposits::ResolvedDepositConfig {
        deposits::ResolvedDepositConfig {
            mint: MINT.to_owned(),
            decimals: 6,
            vault_token_account: VAULT.to_owned(),
        }
    }

    fn busdc_transaction(reference: &str, amount: &str, destination: &str, mint: &str) -> Value {
        json!({
            "slot": 42,
            "meta": { "err": null },
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": SOURCE, "signer": true, "writable": true },
                        { "pubkey": VAULT, "signer": false, "writable": true }
                    ],
                    "instructions": [
                        {
                            "program": "spl-memo",
                            "programId": MEMO_PROGRAM_ADDRESS,
                            "parsed": reference
                        },
                        {
                            "program": "spl-token",
                            "programId": TOKEN_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transferChecked",
                                "info": {
                                    "source": SOURCE,
                                    "mint": mint,
                                    "destination": destination,
                                    "authority": SOURCE,
                                    "tokenAmount": {
                                        "amount": amount,
                                        "decimals": 6
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        })
    }

    fn sol_transaction(reference: &str, lamports: u64, destination: &str) -> Value {
        json!({
            "slot": 99,
            "meta": { "err": null },
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": SOURCE, "signer": true, "writable": true },
                        { "pubkey": TREASURY, "signer": false, "writable": true }
                    ],
                    "instructions": [
                        {
                            "program": "spl-memo",
                            "programId": MEMO_PROGRAM_ADDRESS,
                            "parsed": reference
                        },
                        {
                            "program": "system",
                            "programId": deposits::SYSTEM_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transfer",
                                "info": {
                                    "source": SOURCE,
                                    "destination": destination,
                                    "lamports": lamports
                                }
                            }
                        }
                    ]
                }
            }
        })
    }

    #[test]
    fn verifies_manual_busdc_transfer_with_reference() {
        let slot = verify_busdc_transfer(
            &busdc_transaction("bm:quote-1", "2500000", VAULT, MINT),
            &busdc_quote(),
            &deposit_config(),
        )
        .unwrap();

        assert_eq!(slot, 42);
    }

    #[test]
    fn extracts_transfer_quote_id_from_reference_memo() {
        let quote_id = transfer_deposit_quote_id_from_transaction(&busdc_transaction(
            "bm:quote-1",
            "2500000",
            VAULT,
            MINT,
        ))
        .unwrap();

        assert_eq!(quote_id, "quote-1");
    }

    #[test]
    fn rejects_signature_only_transfer_without_reference_memo() {
        let error = transfer_deposit_quote_id_from_transaction(&busdc_transaction(
            "wrong-reference",
            "2500000",
            VAULT,
            MINT,
        ))
        .unwrap_err();

        assert_eq!(error.code, "transfer_deposit_reference_missing");
    }

    #[test]
    fn rejects_manual_busdc_transfer_without_matching_reference_or_amount() {
        assert_eq!(
            verify_busdc_transfer(
                &busdc_transaction("wrong-reference", "2500000", VAULT, MINT),
                &busdc_quote(),
                &deposit_config(),
            )
            .unwrap_err()
            .code,
            "transfer_deposit_reference_missing"
        );
        assert_eq!(
            verify_busdc_transfer(
                &busdc_transaction("bm:quote-1", "1", VAULT, MINT),
                &busdc_quote(),
                &deposit_config(),
            )
            .unwrap_err()
            .code,
            "transfer_deposit_transfer_not_found"
        );
    }

    #[test]
    fn verifies_manual_sol_transfer_with_reference() {
        let slot = verify_sol_transfer(
            &sol_transaction("bm:quote-2", 6_666_667, TREASURY),
            &sol_quote(),
        )
        .unwrap();

        assert_eq!(slot, 99);
    }

    #[test]
    fn rejects_manual_sol_transfer_with_wrong_treasury_or_lamports() {
        assert_eq!(
            verify_sol_transfer(&sol_transaction("bm:quote-2", 1, TREASURY), &sol_quote())
                .unwrap_err()
                .code,
            "transfer_deposit_transfer_not_found"
        );
        assert_eq!(
            verify_sol_transfer(
                &sol_transaction("bm:quote-2", 6_666_667, WALLET),
                &sol_quote()
            )
            .unwrap_err()
            .code,
            "transfer_deposit_transfer_not_found"
        );
    }
}
