use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_chain::is_valid_solana_signature;
use basingamarket_db::{SolDepositQuoteRow, SolDepositRow};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{deposits, wallet_sessions::require_wallet_owner, ApiError, AppState};

const BUSDC_CURRENCY: &str = "BUSDC";

pub(crate) async fn repair_sol_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(address): Path<String>,
    Json(payload): Json<SolDepositRepairRequest>,
) -> Result<Json<SolDepositRepairResponse>, ApiError> {
    if !sol_deposit_repair_enabled() {
        return Err(ApiError::service_unavailable(
            "sol_deposit_repair_disabled",
            "Devnet SOL deposit repair is disabled.",
        ));
    }

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
    let cash_amount = payload
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

    let config = deposits::ResolvedSolDepositConfig::from_chain_config(&state.chain_config)?;
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
        return Ok(Json(SolDepositRepairResponse::from_existing(
            &existing,
            cash_balance,
            "already_credited",
        )));
    }
    if state.store.get_cash_deposit(&signature).await.is_some()
        || state.store.get_transfer_deposit(&signature).await.is_some()
    {
        return Err(ApiError::bad_request(
            "deposit_signature_already_used",
            "Deposit signature has already been used by another deposit flow.",
        ));
    }

    let client = deposits::rpc_client(&state)?;
    let transaction =
        deposits::fetch_solana_transaction(&client, &state.chain_config, &signature).await?;
    let verified = verify_repair_sol_transfer(&transaction, &wallet_address, &config.treasury)?;
    if !deposits::has_cash_reserve(&state, &client, &config.deposit, cash_amount).await? {
        return Err(ApiError::service_unavailable(
            "sol_deposit_liquidity_pending",
            "App vault BUSDC reserve is too low.",
        ));
    }

    let now = Utc::now();
    let price = implied_price(cash_amount, verified.lamports)?;
    let quote_id = format!("repair-{signature}");
    state
        .store
        .insert_sol_deposit_quote(SolDepositQuoteRow {
            quote_id: quote_id.clone(),
            wallet_address: wallet_address.clone(),
            cash_amount,
            lamports: verified.lamports,
            price,
            treasury: config.treasury.clone(),
            expires_at: now + chrono::Duration::seconds(3600),
            used_signature: None,
            created_at: now,
        })
        .await;
    let row = SolDepositRow {
        wallet_address: wallet_address.clone(),
        signature: signature.clone(),
        quote_id: quote_id.clone(),
        treasury: config.treasury,
        lamports: verified.lamports,
        cash_amount,
        price,
        slot: verified.slot,
        created_at: now,
    };
    let (cash_balance, credited) =
        state
            .store
            .record_sol_deposit(row.clone())
            .await
            .map_err(|error| {
                if error.to_string().contains("quote already used") {
                    ApiError::bad_request("sol_deposit_quote_used", "Quote has already been used.")
                } else {
                    ApiError::internal(error)
                }
            })?;
    if credited {
        state.persist_cash_projection().await?;
    }

    Ok(Json(SolDepositRepairResponse::from_existing(
        &row,
        cash_balance.cash_balance,
        if credited {
            "repaired"
        } else {
            "already_credited"
        },
    )))
}

#[derive(Debug, Deserialize)]
pub(crate) struct SolDepositRepairRequest {
    signature: String,
    cash_amount: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SolDepositRepairResponse {
    wallet_address: String,
    signature: String,
    quote_id: String,
    currency: &'static str,
    decimals: u8,
    cash_balance: String,
    repaired_amount: String,
    lamports: String,
    price: String,
    status: &'static str,
}

impl SolDepositRepairResponse {
    fn from_existing(row: &SolDepositRow, cash_balance: u128, status: &'static str) -> Self {
        Self {
            wallet_address: row.wallet_address.clone(),
            signature: row.signature.clone(),
            quote_id: row.quote_id.clone(),
            currency: BUSDC_CURRENCY,
            decimals: 6,
            cash_balance: cash_balance.to_string(),
            repaired_amount: row.cash_amount.to_string(),
            lamports: row.lamports.to_string(),
            price: row.price.to_string(),
            status,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct VerifiedRepairSolTransfer {
    slot: u64,
    lamports: u64,
}

fn sol_deposit_repair_enabled() -> bool {
    std::env::var("DEV_SOL_DEPOSIT_REPAIR_ENABLED")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn verify_repair_sol_transfer(
    transaction: &Value,
    wallet_address: &str,
    treasury: &str,
) -> Result<VerifiedRepairSolTransfer, ApiError> {
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

    for instruction in deposits::parsed_instructions(transaction) {
        if !deposits::is_system_transfer(instruction) {
            continue;
        }
        let info = instruction.pointer("/parsed/info").ok_or_else(|| {
            ApiError::bad_request(
                "sol_deposit_parse_failed",
                "SOL deposit could not be parsed.",
            )
        })?;
        let source = deposits::string_field(info, "source", "sol_deposit_missing_source")?;
        let destination =
            deposits::string_field(info, "destination", "sol_deposit_missing_destination")?;
        if source != wallet_address || destination != treasury {
            continue;
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
        if lamports == 0 {
            return Err(ApiError::bad_request(
                "sol_deposit_wrong_lamports",
                "SOL transfer amount cannot be zero.",
            ));
        }
        return Ok(VerifiedRepairSolTransfer { slot, lamports });
    }

    Err(ApiError::bad_request(
        "sol_deposit_transfer_not_found",
        "Valid SOL transfer from wallet to treasury was not found.",
    ))
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

fn account_key_pubkey(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("pubkey").and_then(Value::as_str))
}

fn implied_price(cash_amount: u128, lamports: u64) -> Result<u128, ApiError> {
    cash_amount
        .checked_mul(deposits::LAMPORTS_PER_SOL)
        .and_then(|value| value.checked_div(u128::from(lamports)))
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::bad_request("invalid_cash_amount", "Cash amount is invalid."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const WALLET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const TREASURY: &str = "So11111111111111111111111111111111111111112";

    #[test]
    fn repair_transfer_verifies_wallet_treasury_and_lamports() {
        let transaction = json!({
            "slot": 42,
            "meta": { "err": null },
            "transaction": {
                "message": {
                    "accountKeys": [
                        { "pubkey": WALLET, "signer": true },
                        { "pubkey": TREASURY, "signer": false }
                    ],
                    "instructions": [
                        {
                            "program": "system",
                            "programId": deposits::SYSTEM_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transfer",
                                "info": {
                                    "source": WALLET,
                                    "destination": TREASURY,
                                    "lamports": 33333333
                                }
                            }
                        }
                    ]
                }
            }
        });

        let verified = verify_repair_sol_transfer(&transaction, WALLET, TREASURY).unwrap();
        assert_eq!(verified.slot, 42);
        assert_eq!(verified.lamports, 33_333_333);
    }

    #[test]
    fn repair_transfer_rejects_wrong_treasury() {
        let transaction = json!({
            "slot": 42,
            "meta": { "err": null },
            "transaction": {
                "message": {
                    "accountKeys": [{ "pubkey": WALLET, "signer": true }],
                    "instructions": [
                        {
                            "program": "system",
                            "programId": deposits::SYSTEM_PROGRAM_ADDRESS,
                            "parsed": {
                                "type": "transfer",
                                "info": {
                                    "source": WALLET,
                                    "destination": TREASURY,
                                    "lamports": 33333333
                                }
                            }
                        }
                    ]
                }
            }
        });

        let error = verify_repair_sol_transfer(&transaction, WALLET, WALLET).unwrap_err();
        assert_eq!(error.code, "sol_deposit_transfer_not_found");
    }
}
