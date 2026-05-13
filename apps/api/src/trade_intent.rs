use std::{fs, path::PathBuf, process::Command, time::Duration};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use basingamarket_chain::{
    decode_solana_pubkey, derive_associated_token_address, derive_program_address,
    encode_base58_bytes, is_valid_solana_signature, normalize_base58_pubkey, SolanaDevnetConfig,
    TOKEN_PROGRAM_ADDRESS,
};
use basingamarket_db::{CashTradeReservationRow, CashTradeRow, TicketRow};
use basingamarket_domain::crypto_rounds::{DEFAULT_VIRTUAL_TICKET, DEFAULT_VIRTUAL_USDC};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    deposits::{self, ResolvedDepositConfig},
    wallet_sessions::require_wallet_owner,
    ApiError, AppState,
};

const SCALE: u64 = 1_000_000;
const BPS_DENOMINATOR: u64 = 10_000;
const SYSTEM_PROGRAM_ADDRESS: &str = "11111111111111111111111111111111";
const DEFAULT_BUY_SLIPPAGE_BPS: u16 = 100;
const DEFAULT_MARKET_ID: u64 = 1;
const DEFAULT_CASH_BUY_KEYPAIR: &str = "~/.config/solana/basingamarket-devnet-vault-owner.json";

#[derive(Debug, Deserialize)]
pub(crate) struct BuyIntentRequest {
    buyer_wallet: String,
    side: IntentSide,
    usdc_in: String,
    market_id: Option<u64>,
    slippage_bps: Option<u16>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "UPPERCASE")]
enum IntentSide {
    Up,
    Down,
}

impl IntentSide {
    fn as_program_variant(self) -> u8 {
        match self {
            Self::Up => 0,
            Self::Down => 1,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Up => "UP",
            Self::Down => "DOWN",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct BuyIntentResponse {
    cluster: String,
    program_id: String,
    round: String,
    position_lot: String,
    lot_id: String,
    quote: BuyIntentQuote,
    instruction: BuyIntentInstruction,
}

#[derive(Debug, Serialize)]
struct BuyIntentQuote {
    side: &'static str,
    usdc_in: String,
    fee_usdc: String,
    net_usdc: String,
    tickets_out: String,
    min_tickets_out: String,
    fresh_price_before: String,
    fresh_price_after: String,
}

#[derive(Debug, Serialize)]
struct BuyIntentInstruction {
    program_id: String,
    accounts: Vec<InstructionAccount>,
    data_base64: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CashBuyResponse {
    status: &'static str,
    cluster: String,
    program_id: String,
    round: String,
    position_lot: String,
    lot_id: String,
    signature: String,
    explorer_url: String,
    cash_balance: String,
    quote: BuyIntentQuote,
}

#[derive(Debug, Serialize)]
pub(crate) struct MarketBuyResponse {
    status: &'static str,
    execution_type: &'static str,
    signature: String,
    explorer_url: String,
    spent_usdc: String,
    received_tickets: String,
    lot_id: String,
    cash_balance: String,
}

#[derive(Debug, Serialize)]
struct InstructionAccount {
    pubkey: String,
    is_signer: bool,
    is_writable: bool,
}

#[derive(Debug)]
struct GlobalConfigState {
    usdc_mint: String,
    buy_fee_bps: u16,
}

#[derive(Debug)]
struct RoundState {
    start_at: i64,
    batch_until: i64,
    end_at: i64,
    status: u8,
    up: CurveState,
    down: CurveState,
}

#[derive(Debug, Clone, Copy)]
struct CurveState {
    virtual_usdc: u64,
    virtual_ticket: u64,
}

#[derive(Debug, Clone, Copy)]
struct BuyQuote {
    fee_usdc: u64,
    net_usdc: u64,
    tickets_out: u64,
    min_tickets_out: u64,
    fresh_price_before: u64,
    fresh_price_after: u64,
}

pub(crate) async fn create_buy_intent(
    State(state): State<AppState>,
    Path(round_id): Path<u64>,
    Json(input): Json<BuyIntentRequest>,
) -> Result<Json<BuyIntentResponse>, ApiError> {
    let prepared = prepare_buy(&state, round_id, &input).await?;
    let buyer_usdc_account =
        derive_associated_token_address(&prepared.buyer_wallet, &prepared.global_state.usdc_mint)
            .map_err(ApiError::internal)?;

    Ok(Json(BuyIntentResponse {
        cluster: state.chain_config.cluster.clone(),
        program_id: prepared.program_id.clone(),
        round: prepared.round.clone(),
        position_lot: prepared.position_lot.clone(),
        lot_id: prepared.lot_id.to_string(),
        quote: buy_intent_quote(input.side, prepared.usdc_in, prepared.quote),
        instruction: BuyIntentInstruction {
            program_id: prepared.program_id.clone(),
            accounts: buy_fresh_accounts(BuyFreshAccounts {
                global: prepared.global,
                round: prepared.round,
                position_lot: prepared.position_lot,
                usdc_mint: prepared.global_state.usdc_mint,
                buyer_usdc_account,
                round_vault: prepared.round_vault,
                fee_vault: prepared.fee_vault,
                buyer: prepared.buyer_wallet,
            }),
            data_base64: BASE64.encode(buy_fresh_data(
                prepared.lot_id,
                input.side,
                prepared.usdc_in,
                prepared.quote.min_tickets_out,
            )),
        },
    }))
}

pub(crate) async fn execute_cash_buy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(round_id): Path<u64>,
    Json(input): Json<BuyIntentRequest>,
) -> Result<Json<CashBuyResponse>, ApiError> {
    let buyer_wallet = normalize_base58_pubkey(&input.buyer_wallet, "buyer_wallet")
        .map_err(|_| ApiError::bad_request("invalid_buyer_wallet", "Buyer wallet gecersiz."))?;
    require_wallet_owner(&state, &headers, &buyer_wallet)?;
    execute_cash_buy_inner(&state, round_id, input)
        .await
        .map(Json)
}

pub(crate) async fn execute_market_buy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(round_id): Path<u64>,
    Json(input): Json<BuyIntentRequest>,
) -> Result<Json<MarketBuyResponse>, ApiError> {
    let buyer_wallet = normalize_base58_pubkey(&input.buyer_wallet, "buyer_wallet")
        .map_err(|_| ApiError::bad_request("invalid_buyer_wallet", "Buyer wallet gecersiz."))?;
    require_wallet_owner(&state, &headers, &buyer_wallet)?;
    let usdc_in = parse_positive_u64(&input.usdc_in)?;
    let market_id = input.market_id.unwrap_or(DEFAULT_MARKET_ID);
    crate::secondary_resale::ensure_round_live(&state, market_id, round_id).await?;

    let cash_balance = state
        .store
        .get_cash_balance(&buyer_wallet)
        .await
        .map(|row| row.cash_balance)
        .unwrap_or(0);
    if cash_balance < u128::from(usdc_in) {
        return Err(ApiError::bad_request(
            "insufficient_cash_balance",
            "BUSDC bakiyesi yetersiz.",
        ));
    }

    let fresh_price = projected_fresh_price(&state, market_id, round_id, input.side).await;
    let asks = state.store.listed_cash_asks(market_id, round_id).await;
    if let Some(ask) = best_market_buy_ask(
        &asks,
        input.side,
        &buyer_wallet,
        fresh_price,
        u128::from(usdc_in),
    ) {
        let price_per_ticket = u64::try_from(ask.listed_price.unwrap_or_default())
            .map_err(|_| ApiError::bad_request("amount_too_large", "Amount u64 sinirini asti."))?;
        let execution = crate::secondary_resale::execute_buy_listing_for_market_buy(
            &state,
            ask.ticket_id,
            buyer_wallet,
            price_per_ticket,
            market_id,
            round_id,
        )
        .await?;
        return Ok(Json(MarketBuyResponse {
            status: "confirmed",
            execution_type: "listed_ask",
            signature: execution.signature,
            explorer_url: execution.explorer_url,
            spent_usdc: execution.gross_usdc.to_string(),
            received_tickets: execution.received_tickets.to_string(),
            lot_id: execution.ticket_id.to_string(),
            cash_balance: execution.buyer_cash_balance.to_string(),
        }));
    }

    let response = execute_cash_buy_inner(&state, round_id, input).await?;
    Ok(Json(MarketBuyResponse {
        status: response.status,
        execution_type: "fresh_curve",
        signature: response.signature,
        explorer_url: response.explorer_url,
        spent_usdc: response.quote.usdc_in,
        received_tickets: response.quote.tickets_out,
        lot_id: response.lot_id,
        cash_balance: response.cash_balance,
    }))
}

async fn execute_cash_buy_inner(
    state: &AppState,
    round_id: u64,
    input: BuyIntentRequest,
) -> Result<CashBuyResponse, ApiError> {
    let prepared = prepare_buy(state, round_id, &input).await?;
    let config = resolve_cash_buy_config(state)?;
    if prepared.global_state.usdc_mint != config.deposit.mint {
        return Err(ApiError::service_unavailable(
            "cash_buy_mint_mismatch",
            "BUSDC mint config ile program mint eslesmiyor.",
        ));
    }
    let cash_balance = state
        .store
        .get_cash_balance(&prepared.buyer_wallet)
        .await
        .map(|row| row.cash_balance)
        .unwrap_or(0);
    if cash_balance < u128::from(prepared.usdc_in) {
        return Err(ApiError::bad_request(
            "insufficient_cash_balance",
            "BUSDC bakiyesi yetersiz.",
        ));
    }
    ensure_cash_buy_liquidity(state, &config).await?;

    let trade_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    state
        .store
        .reserve_cash_trade(CashTradeReservationRow {
            trade_id: trade_id.clone(),
            wallet_address: prepared.buyer_wallet.clone(),
            amount: u128::from(prepared.usdc_in),
            released: false,
            completed_signature: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .map_err(|error| cash_trade_store_error(error, "insufficient_cash_balance"))?;

    let signature = match submit_cash_buy(&config, &prepared, input.side) {
        Ok(signature) => signature,
        Err(error) => {
            let _ = state.store.release_cash_trade_reservation(&trade_id).await;
            let _ = state.persist_cash_projection().await;
            return Err(error);
        }
    };
    let (balance, recorded) = state
        .store
        .record_cash_trade(CashTradeRow {
            trade_id,
            wallet_address: prepared.buyer_wallet.clone(),
            signature: signature.clone(),
            mint: config.deposit.mint.clone(),
            vault_token_account: config.deposit.vault_token_account.clone(),
            market_id: prepared.market_id,
            round_id,
            position_lot: prepared.position_lot.clone(),
            lot_id: prepared.lot_id,
            side: input.side.as_str().to_owned(),
            usdc_in: u128::from(prepared.usdc_in),
            fee_usdc: u128::from(prepared.quote.fee_usdc),
            net_usdc: u128::from(prepared.quote.net_usdc),
            tickets_out: u128::from(prepared.quote.tickets_out),
            created_at: Utc::now(),
        })
        .await
        .map_err(ApiError::internal)?;
    if recorded {
        state.persist_cash_projection().await?;
    }

    Ok(CashBuyResponse {
        status: if recorded {
            "confirmed"
        } else {
            "already_confirmed"
        },
        cluster: state.chain_config.cluster.clone(),
        program_id: prepared.program_id,
        round: prepared.round,
        position_lot: prepared.position_lot,
        lot_id: prepared.lot_id.to_string(),
        signature: signature.clone(),
        explorer_url: solana_explorer_tx_url(&signature),
        cash_balance: balance.cash_balance.to_string(),
        quote: buy_intent_quote(input.side, prepared.usdc_in, prepared.quote),
    })
}

struct PreparedBuy {
    program_id: String,
    buyer_wallet: String,
    usdc_in: u64,
    market_id: u64,
    global: String,
    round: String,
    position_lot: String,
    lot_id: u64,
    round_vault: String,
    fee_vault: String,
    global_state: GlobalConfigState,
    quote: BuyQuote,
}

async fn prepare_buy(
    state: &AppState,
    round_id: u64,
    input: &BuyIntentRequest,
) -> Result<PreparedBuy, ApiError> {
    let program_id = state.chain_config.program_id.clone().ok_or_else(|| {
        ApiError::service_unavailable("program_not_configured", "Solana program id hazir degil.")
    })?;
    let buyer_wallet = normalize_base58_pubkey(&input.buyer_wallet, "buyer_wallet")
        .map_err(|_| ApiError::bad_request("invalid_buyer_wallet", "Buyer wallet gecersiz."))?;
    let usdc_in = parse_positive_u64(&input.usdc_in)?;
    let slippage_bps = input.slippage_bps.unwrap_or(DEFAULT_BUY_SLIPPAGE_BPS);
    if slippage_bps >= BPS_DENOMINATOR as u16 {
        return Err(ApiError::bad_request(
            "invalid_slippage",
            "Slippage bps gecersiz.",
        ));
    }
    let market_id = input.market_id.unwrap_or(DEFAULT_MARKET_ID);

    let global = derive_program_address(&[b"global"], &program_id, "program_id")
        .map_err(ApiError::internal)?;
    let market_seed = market_id.to_le_bytes();
    let market = derive_program_address(&[b"market", &market_seed], &program_id, "program_id")
        .map_err(ApiError::internal)?;
    let market_bytes = decode_solana_pubkey(&market, "market").map_err(ApiError::internal)?;
    let round_seed = round_id.to_le_bytes();
    let round = derive_program_address(
        &[b"round", &market_bytes, &round_seed],
        &program_id,
        "program_id",
    )
    .map_err(ApiError::internal)?;
    let round_bytes = decode_solana_pubkey(&round, "round").map_err(ApiError::internal)?;

    fetch_required_account(
        &state.chain_config,
        &program_id,
        "program_not_deployed",
        "Solana program devnet'e deploy edilmemis.",
    )
    .await?;
    let global_state = fetch_global_config(&state.chain_config, &global).await?;
    fetch_required_account(
        &state.chain_config,
        &market,
        "market_not_initialized",
        "Devnet market config initialize edilmemis.",
    )
    .await?;
    let round_state = match fetch_round(&state.chain_config, &round).await {
        Ok(round_state) => round_state,
        Err(error) if error.code == "round_not_initialized" => {
            crate::devnet_round_bootstrap::enqueue_current_round_if_live(
                state,
                market_id,
                round_id,
                Utc::now().timestamp(),
            )
            .await;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    validate_round_tradeable(&round_state)?;

    let curve = match input.side {
        IntentSide::Up => round_state.up,
        IntentSide::Down => round_state.down,
    };
    let quote = quote_buy(curve, usdc_in, global_state.buy_fee_bps, slippage_bps)?;

    let lot_id = lot_id_from_uuid(Uuid::new_v4());
    let lot_seed = lot_id.to_le_bytes();
    let position_lot = derive_program_address(
        &[b"lot", &round_bytes, &lot_seed],
        &program_id,
        "program_id",
    )
    .map_err(ApiError::internal)?;
    let round_vault = derive_associated_token_address(&round, &global_state.usdc_mint)
        .map_err(ApiError::internal)?;
    let fee_vault = derive_associated_token_address(&global, &global_state.usdc_mint)
        .map_err(ApiError::internal)?;

    Ok(PreparedBuy {
        program_id,
        buyer_wallet,
        usdc_in,
        market_id,
        global,
        round,
        position_lot,
        lot_id,
        round_vault,
        fee_vault,
        global_state,
        quote,
    })
}

struct BuyFreshAccounts {
    global: String,
    round: String,
    position_lot: String,
    usdc_mint: String,
    buyer_usdc_account: String,
    round_vault: String,
    fee_vault: String,
    buyer: String,
}

fn buy_fresh_accounts(accounts: BuyFreshAccounts) -> Vec<InstructionAccount> {
    vec![
        writable(accounts.global, false),
        writable(accounts.round, false),
        writable(accounts.position_lot, false),
        readonly(accounts.usdc_mint, false),
        writable(accounts.buyer_usdc_account, false),
        writable(accounts.round_vault, false),
        writable(accounts.fee_vault, false),
        writable(accounts.buyer, true),
        readonly(TOKEN_PROGRAM_ADDRESS.to_owned(), false),
        readonly(SYSTEM_PROGRAM_ADDRESS.to_owned(), false),
    ]
}

fn buy_intent_quote(side: IntentSide, usdc_in: u64, quote: BuyQuote) -> BuyIntentQuote {
    BuyIntentQuote {
        side: side.as_str(),
        usdc_in: usdc_in.to_string(),
        fee_usdc: quote.fee_usdc.to_string(),
        net_usdc: quote.net_usdc.to_string(),
        tickets_out: quote.tickets_out.to_string(),
        min_tickets_out: quote.min_tickets_out.to_string(),
        fresh_price_before: quote.fresh_price_before.to_string(),
        fresh_price_after: quote.fresh_price_after.to_string(),
    }
}

#[derive(Debug)]
pub(crate) struct ResolvedCashBuyConfig {
    pub(crate) deposit: ResolvedDepositConfig,
    pub(crate) cashier_keypair_path: String,
    pub(crate) rpc_url: String,
    pub(crate) script_path: PathBuf,
    pub(crate) env_path: PathBuf,
}

pub(crate) fn resolve_cash_buy_config(state: &AppState) -> Result<ResolvedCashBuyConfig, ApiError> {
    let deposit = ResolvedDepositConfig::from_chain_config(&state.chain_config)?;
    let keypair_path = std::env::var("SOLANA_TRADE_CASHIER_KEYPAIR")
        .or_else(|_| std::env::var("SOLANA_WITHDRAW_VAULT_OWNER_KEYPAIR"))
        .unwrap_or_else(|_| DEFAULT_CASH_BUY_KEYPAIR.to_owned());
    let keypair_owner = vault_owner_from_keypair(&keypair_path)?;
    if state.chain_config.deposit_vault_owner.as_deref() != Some(keypair_owner.as_str()) {
        return Err(ApiError::service_unavailable(
            "cash_buy_setup_pending",
            "Cash buy setup pending: vault owner keypair config ile eslesmiyor.",
        ));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .unwrap_or(manifest_dir.as_path())
        .to_path_buf();
    Ok(ResolvedCashBuyConfig {
        deposit,
        cashier_keypair_path: keypair_path,
        rpc_url: state.chain_config.rpc_url.clone(),
        script_path: std::env::var("SOLANA_CASH_BUY_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join("apps/web/scripts/cash-buy-devnet.mjs")),
        env_path: std::env::var("SOLANA_CASH_BUY_ENV_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join(".env")),
    })
}

fn submit_cash_buy(
    config: &ResolvedCashBuyConfig,
    prepared: &PreparedBuy,
    side: IntentSide,
) -> Result<String, ApiError> {
    let output = Command::new("node")
        .arg(&config.script_path)
        .arg("--program-id")
        .arg(&prepared.program_id)
        .arg("--global")
        .arg(&prepared.global)
        .arg("--round")
        .arg(&prepared.round)
        .arg("--position-lot")
        .arg(&prepared.position_lot)
        .arg("--usdc-mint")
        .arg(&config.deposit.mint)
        .arg("--cash-vault")
        .arg(&config.deposit.vault_token_account)
        .arg("--round-vault")
        .arg(&prepared.round_vault)
        .arg("--fee-vault")
        .arg(&prepared.fee_vault)
        .arg("--cashier-keypair")
        .arg(&config.cashier_keypair_path)
        .arg("--lot-id")
        .arg(prepared.lot_id.to_string())
        .arg("--side")
        .arg(side.as_str())
        .arg("--position-owner")
        .arg(&prepared.buyer_wallet)
        .arg("--usdc-in")
        .arg(prepared.usdc_in.to_string())
        .arg("--min-tickets-out")
        .arg(prepared.quote.min_tickets_out.to_string())
        .arg("--env")
        .arg(&config.env_path)
        .arg("--rpc-url")
        .arg(&config.rpc_url)
        .output()
        .map_err(ApiError::internal)?;
    if !output.status.success() {
        tracing::warn!(
            stderr = %String::from_utf8_lossy(&output.stderr),
            "cash buy script failed"
        );
        return Err(ApiError::service_unavailable(
            "cash_buy_transaction_failed",
            "Vault cash buy transaction tamamlanamadi.",
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_script_signature(&stdout).ok_or_else(|| {
        ApiError::service_unavailable(
            "cash_buy_transaction_failed",
            "Vault cash buy transaction signature okunamadi.",
        )
    })
}

async fn ensure_cash_buy_liquidity(
    state: &AppState,
    config: &ResolvedCashBuyConfig,
) -> Result<(), ApiError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(state.chain_config.request_timeout_ms))
        .build()
        .map_err(ApiError::internal)?;
    if deposits::has_cash_reserve(state, &client, &config.deposit, 0).await? {
        return Ok(());
    }

    Err(ApiError::service_unavailable(
        "cash_buy_liquidity_pending",
        "Vault BUSDC reserve yetersiz. App/admin devnet BUSDC reserve ekleyin.",
    ))
}

fn vault_owner_from_keypair(keypair_path: &str) -> Result<String, ApiError> {
    let path = expand_home(keypair_path);
    let text = fs::read_to_string(&path).map_err(|_| {
        ApiError::service_unavailable(
            "cash_buy_setup_pending",
            "Cash buy setup pending: vault owner keypair okunamadi.",
        )
    })?;
    let bytes: Vec<u8> = serde_json::from_str(&text).map_err(ApiError::internal)?;
    if bytes.len() != 64 {
        return Err(ApiError::service_unavailable(
            "cash_buy_setup_pending",
            "Cash buy setup pending: vault owner keypair gecersiz.",
        ));
    }
    Ok(encode_base58_bytes(&bytes[32..64]))
}

pub(crate) fn parse_script_signature(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.strip_prefix("Transaction: ")
            .map(str::trim)
            .filter(|value| is_valid_solana_signature(value))
            .map(ToOwned::to_owned)
    })
}

pub(crate) fn solana_explorer_tx_url(signature: &str) -> String {
    format!("https://explorer.solana.com/tx/{signature}?cluster=devnet")
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

pub(crate) fn cash_trade_store_error(
    error: basingamarket_db::DbError,
    insufficient_code: &'static str,
) -> ApiError {
    let message = error.to_string();
    if message.contains("cash balance insufficient") {
        return ApiError::bad_request(insufficient_code, "BUSDC bakiyesi yetersiz.");
    }
    ApiError::internal(error)
}

fn writable(pubkey: String, is_signer: bool) -> InstructionAccount {
    InstructionAccount {
        pubkey,
        is_signer,
        is_writable: true,
    }
}

fn readonly(pubkey: String, is_signer: bool) -> InstructionAccount {
    InstructionAccount {
        pubkey,
        is_signer,
        is_writable: false,
    }
}

async fn fetch_global_config(
    config: &SolanaDevnetConfig,
    address: &str,
) -> Result<GlobalConfigState, ApiError> {
    let data = fetch_account_data(
        config,
        address,
        "global_config_not_initialized",
        "Devnet global config initialize edilmemis.",
    )
    .await?;
    if data.len() < 160 {
        return Err(ApiError::service_unavailable(
            "global_config_invalid",
            "Global config account okunamadi.",
        ));
    }
    Ok(GlobalConfigState {
        usdc_mint: basingamarket_chain::encode_base58_bytes(read_array::<32>(&data, 72)?),
        buy_fee_bps: read_u16(&data, 136)?,
    })
}

async fn fetch_round(config: &SolanaDevnetConfig, address: &str) -> Result<RoundState, ApiError> {
    let data = fetch_account_data(
        config,
        address,
        "round_not_initialized",
        "Devnet round is not initialized.",
    )
    .await?;
    if data.len() < 219 {
        return Err(ApiError::service_unavailable(
            "round_account_invalid",
            "Round account okunamadi.",
        ));
    }
    Ok(RoundState {
        start_at: read_i64(&data, 48)?,
        batch_until: read_i64(&data, 56)?,
        end_at: read_i64(&data, 64)?,
        status: data[88],
        up: read_curve(&data, 90)?,
        down: read_curve(&data, 122)?,
    })
}

async fn fetch_account_data(
    config: &SolanaDevnetConfig,
    address: &str,
    missing_code: &'static str,
    missing_message: &'static str,
) -> Result<Vec<u8>, ApiError> {
    let value = fetch_account_info(config, address).await?;
    let encoded = value
        .pointer("/result/value/data/0")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::not_found(missing_code, missing_message))?;
    BASE64.decode(encoded).map_err(|_| {
        ApiError::service_unavailable("account_decode_failed", "Devnet account decode edilemedi.")
    })
}

async fn fetch_required_account(
    config: &SolanaDevnetConfig,
    address: &str,
    missing_code: &'static str,
    missing_message: &'static str,
) -> Result<(), ApiError> {
    let value = fetch_account_info(config, address).await?;
    if value.pointer("/result/value").is_none_or(Value::is_null) {
        return Err(ApiError::not_found(missing_code, missing_message));
    }
    Ok(())
}

async fn fetch_account_info(config: &SolanaDevnetConfig, address: &str) -> Result<Value, ApiError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.request_timeout_ms))
        .build()
        .map_err(ApiError::internal)?;
    let response = client
        .post(&config.rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [
                address,
                { "encoding": "base64", "commitment": config.deposit_commitment }
            ]
        }))
        .send()
        .await
        .map_err(ApiError::internal)?;
    let value: Value = response.json().await.map_err(ApiError::internal)?;
    if let Some(error) = value.get("error") {
        tracing::warn!(address, error = %error, "Solana RPC account fetch failed");
        return Err(ApiError::service_unavailable(
            "solana_rpc_error",
            "Solana RPC account verisi donmedi.",
        ));
    }
    Ok(value)
}

fn validate_round_tradeable(round: &RoundState) -> Result<(), ApiError> {
    let now = chrono::Utc::now().timestamp();
    if round.status != 0 {
        return Err(ApiError::bad_request("round_not_open", "Round open degil."));
    }
    if now <= round.batch_until {
        return Err(ApiError::bad_request(
            "opening_batch_active",
            "Opening batch henuz bitmedi.",
        ));
    }
    if now < round.start_at || now >= round.end_at {
        return Err(ApiError::bad_request(
            "round_not_live",
            "Round live trading disinda.",
        ));
    }
    Ok(())
}

fn quote_buy(
    curve: CurveState,
    usdc_in: u64,
    fee_bps: u16,
    slippage_bps: u16,
) -> Result<BuyQuote, ApiError> {
    let fee_usdc = fee_amount(usdc_in, fee_bps)?;
    let net_usdc = usdc_in.checked_sub(fee_usdc).ok_or_else(overflow)?;
    let k = (curve.virtual_usdc as u128)
        .checked_mul(curve.virtual_ticket as u128)
        .ok_or_else(overflow)?;
    let new_virtual_usdc = curve
        .virtual_usdc
        .checked_add(net_usdc)
        .ok_or_else(overflow)?;
    let new_virtual_ticket = u64::try_from(
        k.checked_div(new_virtual_usdc as u128)
            .ok_or_else(overflow)?,
    )
    .map_err(|_| overflow())?;
    let tickets_out = curve
        .virtual_ticket
        .checked_sub(new_virtual_ticket)
        .ok_or_else(overflow)?;
    if tickets_out == 0 {
        return Err(ApiError::bad_request(
            "zero_tickets_out",
            "Bu amount ticket uretmiyor.",
        ));
    }
    let min_tickets_out =
        tickets_out.saturating_mul(BPS_DENOMINATOR - u64::from(slippage_bps)) / BPS_DENOMINATOR;

    Ok(BuyQuote {
        fee_usdc,
        net_usdc,
        tickets_out,
        min_tickets_out,
        fresh_price_before: fixed_price(curve.virtual_usdc, curve.virtual_ticket),
        fresh_price_after: fixed_price(new_virtual_usdc, new_virtual_ticket),
    })
}

fn buy_fresh_data(lot_id: u64, side: IntentSide, usdc_in: u64, min_tickets_out: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(33);
    data.extend_from_slice(&anchor_discriminator("buy_fresh"));
    data.extend_from_slice(&lot_id.to_le_bytes());
    data.push(side.as_program_variant());
    data.extend_from_slice(&usdc_in.to_le_bytes());
    data.extend_from_slice(&min_tickets_out.to_le_bytes());
    data
}

fn anchor_discriminator(name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("global:{name}"));
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&hash[..8]);
    discriminator
}

fn lot_id_from_uuid(uuid: Uuid) -> u64 {
    let bytes = uuid.as_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("uuid has 16 bytes"))
}

fn read_curve(data: &[u8], offset: usize) -> Result<CurveState, ApiError> {
    Ok(CurveState {
        virtual_usdc: read_u64(data, offset)?,
        virtual_ticket: read_u64(data, offset + 8)?,
    })
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, ApiError> {
    Ok(u16::from_le_bytes(
        read_array::<2>(data, offset)?.to_owned(),
    ))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64, ApiError> {
    Ok(u64::from_le_bytes(
        read_array::<8>(data, offset)?.to_owned(),
    ))
}

fn read_i64(data: &[u8], offset: usize) -> Result<i64, ApiError> {
    Ok(i64::from_le_bytes(
        read_array::<8>(data, offset)?.to_owned(),
    ))
}

fn read_array<const N: usize>(data: &[u8], offset: usize) -> Result<&[u8; N], ApiError> {
    data.get(offset..offset + N)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| {
            ApiError::service_unavailable(
                "account_decode_failed",
                "Devnet account decode edilemedi.",
            )
        })
}

fn fee_amount(amount: u64, fee_bps: u16) -> Result<u64, ApiError> {
    u64::try_from((amount as u128) * (fee_bps as u128) / (BPS_DENOMINATOR as u128))
        .map_err(|_| overflow())
}

fn fixed_price(virtual_usdc: u64, virtual_ticket: u64) -> u64 {
    if virtual_ticket == 0 {
        return 0;
    }
    virtual_usdc.saturating_mul(SCALE) / virtual_ticket
}

async fn projected_fresh_price(
    state: &AppState,
    market_id: u64,
    round_id: u64,
    side: IntentSide,
) -> u128 {
    let outcome_id = match side {
        IntentSide::Up => 0,
        IntentSide::Down => 1,
    };
    let outcome_volume = state
        .store
        .get_outcomes(market_id)
        .await
        .into_iter()
        .find(|outcome| outcome.outcome_id == outcome_id)
        .map(|outcome| outcome.total_stake)
        .unwrap_or(0);
    let cash_volume = state
        .store
        .cash_trade_side_volume(market_id, round_id, side.as_str())
        .await;
    projected_curve_price(outcome_volume.saturating_add(cash_volume))
}

fn projected_curve_price(volume: u128) -> u128 {
    let virtual_usdc = DEFAULT_VIRTUAL_USDC.saturating_add(volume);
    let k = DEFAULT_VIRTUAL_USDC.saturating_mul(DEFAULT_VIRTUAL_TICKET);
    let virtual_ticket = k
        .checked_div(virtual_usdc)
        .unwrap_or(DEFAULT_VIRTUAL_TICKET);
    if virtual_ticket == 0 {
        return 0;
    }
    virtual_usdc.saturating_mul(u128::from(SCALE)) / virtual_ticket
}

fn best_market_buy_ask<'a>(
    asks: &'a [TicketRow],
    side: IntentSide,
    buyer_wallet: &str,
    fresh_price: u128,
    max_usdc: u128,
) -> Option<&'a TicketRow> {
    asks.iter()
        .filter(|ask| ask.current_owner != buyer_wallet)
        .filter(|ask| ticket_side(ask.outcome_id) == Some(side.as_str()))
        .find(|ask| {
            let Some(price) = ask.listed_price else {
                return false;
            };
            price <= fresh_price
                && listing_total_price(ask.stake_amount, price)
                    .map(|total| total <= max_usdc)
                    .unwrap_or(false)
        })
}

fn ticket_side(outcome_id: u8) -> Option<&'static str> {
    match outcome_id {
        0 => Some("UP"),
        1 => Some("DOWN"),
        _ => None,
    }
}

fn listing_total_price(tickets: u128, price_per_ticket: u128) -> Option<u128> {
    tickets
        .checked_mul(price_per_ticket)
        .and_then(|value| value.checked_div(u128::from(SCALE)))
}

fn parse_positive_u64(value: &str) -> Result<u64, ApiError> {
    let amount = value
        .parse::<u64>()
        .map_err(|_| ApiError::bad_request("invalid_usdc_in", "BUSDC amount gecersiz."))?;
    if amount == 0 {
        return Err(ApiError::bad_request(
            "invalid_usdc_in",
            "BUSDC amount sifirdan buyuk olmali.",
        ));
    }
    Ok(amount)
}

fn overflow() -> ApiError {
    ApiError::bad_request("arithmetic_overflow", "Amount hesaplamasi tasma uretti.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use basingamarket_domain::TicketStatus;

    #[test]
    fn market_buy_ask_selection_skips_self_expensive_and_oversized_asks() {
        let buyer = "buyer-wallet";
        let asks = vec![
            ticket_row(1, 0, buyer, 400_000, 1_000_000),
            ticket_row(2, 0, "seller-a", 700_000, 1_000_000),
            ticket_row(3, 0, "seller-b", 450_000, 3_000_000),
            ticket_row(4, 1, "seller-c", 300_000, 1_000_000),
            ticket_row(5, 0, "seller-d", 450_000, 1_000_000),
        ];

        let selected = best_market_buy_ask(&asks, IntentSide::Up, buyer, 500_000, 1_000_000);

        assert_eq!(selected.map(|ticket| ticket.ticket_id), Some(5));
    }

    fn ticket_row(
        ticket_id: u64,
        outcome_id: u8,
        owner: &str,
        listed_price: u128,
        stake_amount: u128,
    ) -> TicketRow {
        let now = Utc::now();
        TicketRow {
            ticket_id,
            market_id: 1,
            round_id: 1,
            outcome_id,
            original_caller: owner.to_owned(),
            current_owner: owner.to_owned(),
            stake_amount,
            reward_shares: stake_amount,
            entry_odds: listed_price,
            cost_basis_usdc: listing_total_price(stake_amount, listed_price).unwrap_or(0),
            settlement_value_usdc: None,
            listed_price: Some(listed_price),
            status: TicketStatus::Listed,
            claimed: false,
            confidence: 0,
            mood: 0,
            created_slot: 0,
            created_at: now,
            updated_at: now,
        }
    }
}
