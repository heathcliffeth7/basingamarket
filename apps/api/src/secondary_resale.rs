use std::{path::PathBuf, process::Command};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use basingamarket_chain::{
    decode_solana_pubkey, derive_associated_token_address, derive_program_address,
    normalize_base58_pubkey,
};
use basingamarket_db::{CashBidRow, CashResaleRow, CashTradeRow, EventMeta, TicketRow};
use basingamarket_domain::{crypto_rounds::round_window, MarketStatus, TicketStatus, SCALE};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    trade_intent::{
        cash_trade_store_error, parse_script_signature, resolve_cash_buy_config,
        solana_explorer_tx_url, ResolvedCashBuyConfig,
    },
    wallet_sessions::require_wallet_owner,
    ApiError, AppState,
};

const BPS_DENOMINATOR: u128 = 10_000;
const DEFAULT_MARKET_ID: u64 = 1;
const DEFAULT_RESALE_FEE_BPS: u16 = 50;

#[derive(Debug, Deserialize)]
pub(crate) struct ListTicketRequest {
    seller_wallet: String,
    price_per_ticket: String,
    market_id: Option<u64>,
    round_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CancelListingRequest {
    seller_wallet: String,
    market_id: Option<u64>,
    round_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BuyListingRequest {
    buyer_wallet: String,
    max_price_per_ticket: String,
    market_id: Option<u64>,
    round_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateBidRequest {
    buyer_wallet: String,
    market_id: Option<u64>,
    side: TradeSide,
    price_per_ticket: String,
    max_usdc: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CancelBidRequest {
    buyer_wallet: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct InstantSellRequest {
    seller_wallet: String,
    market_id: Option<u64>,
    round_id: Option<u64>,
    min_price_per_ticket: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BidQuery {
    market_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OrderBookQuery {
    market_id: Option<u64>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum TradeSide {
    Up,
    Down,
}

impl TradeSide {
    fn as_str(self) -> &'static str {
        match self {
            Self::Up => "UP",
            Self::Down => "DOWN",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ListingResponse {
    status: &'static str,
    ticket_id: String,
    signature: String,
    explorer_url: String,
    price_per_ticket: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CancelListingResponse {
    status: &'static str,
    ticket_id: String,
    signature: String,
    explorer_url: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CashBidResponse {
    bid_id: String,
    market_id: String,
    round_id: String,
    side: String,
    buyer_wallet: String,
    price_per_ticket: String,
    max_usdc: String,
    remaining_usdc: String,
    status: String,
    cash_balance: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BidBookResponse {
    round_id: String,
    bids: Vec<CashBidResponse>,
}

#[derive(Debug, Serialize)]
pub(crate) struct OrderBookResponse {
    market_id: String,
    round_id: String,
    updated_at: String,
    state: &'static str,
    sides: Vec<OrderBookSideResponse>,
}

#[derive(Debug, Serialize)]
pub(crate) struct OrderBookSideResponse {
    side: &'static str,
    bids: Vec<OrderBookBidResponse>,
    asks: Vec<OrderBookAskResponse>,
    best_bid_price: Option<String>,
    best_ask_price: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct OrderBookBidResponse {
    bid_id: String,
    price_per_ticket: String,
    remaining_usdc: String,
    available_tickets: String,
    total_usdc: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct OrderBookAskResponse {
    lot_id: String,
    price_per_ticket: String,
    ticket_amount: String,
    total_usdc: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CashResaleResponse {
    status: &'static str,
    ticket_id: String,
    buyer_lot_id: Option<String>,
    signature: String,
    explorer_url: String,
    gross_usdc: String,
    seller_receives: String,
    resale_fee: String,
    early_flip_fee: String,
    seller_cash_balance: String,
    buyer_cash_balance: String,
}

#[derive(Debug)]
struct LotContext {
    ticket: TicketRow,
    market_id: u64,
    round_id: u64,
    side: String,
    position_lot: String,
    global: String,
    round: String,
    round_vault: String,
    fee_vault: String,
}

#[derive(Debug)]
struct RoundAddresses {
    global: String,
    round: String,
    round_vault: String,
    fee_vault: String,
}

pub(crate) struct BuyListingExecution {
    pub(crate) ticket_id: u64,
    pub(crate) signature: String,
    pub(crate) explorer_url: String,
    pub(crate) gross_usdc: u128,
    pub(crate) received_tickets: u128,
    pub(crate) buyer_cash_balance: u128,
    buyer_lot_id: Option<u64>,
    resale_fee: u128,
    early_flip_fee: u128,
    seller_receives: u128,
    seller_cash_balance: u128,
}

pub(crate) async fn list_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(ticket_id): Path<u64>,
    Json(input): Json<ListTicketRequest>,
) -> Result<Json<ListingResponse>, ApiError> {
    let seller_wallet = normalize_wallet(&input.seller_wallet, "seller_wallet")?;
    require_wallet_owner(&state, &headers, &seller_wallet).await?;
    let price_per_ticket = parse_positive_u64(&input.price_per_ticket, "price_per_ticket")?;
    let context = lot_context(
        &state,
        ticket_id,
        input.market_id,
        input.round_id,
        Some(&seller_wallet),
    )
    .await?;
    ensure_owner(&context.ticket, &seller_wallet)?;
    ensure_tradeable_ticket(&context.ticket)?;

    let config = resolve_cash_buy_config(&state)?;
    let signature = submit_secondary_resale(
        &config,
        SecondaryScriptArgs::List {
            program_id: program_id(&state)?,
            global: context.global.clone(),
            round: context.round.clone(),
            position_lot: context.position_lot.clone(),
            seller_wallet: seller_wallet.clone(),
            price_per_ticket,
        },
    )?;
    state
        .store
        .list_ticket(
            ticket_id,
            u128::from(price_per_ticket),
            &api_event_meta(&signature),
        )
        .await
        .map_err(ApiError::internal)?;
    state.persist_cash_projection().await?;
    invalidate_market_cache(&state, context.market_id).await;

    Ok(Json(ListingResponse {
        status: "listed",
        ticket_id: ticket_id.to_string(),
        signature: signature.clone(),
        explorer_url: solana_explorer_tx_url(&signature),
        price_per_ticket: price_per_ticket.to_string(),
    }))
}

pub(crate) async fn cancel_listing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(ticket_id): Path<u64>,
    Json(input): Json<CancelListingRequest>,
) -> Result<Json<CancelListingResponse>, ApiError> {
    let seller_wallet = normalize_wallet(&input.seller_wallet, "seller_wallet")?;
    require_wallet_owner(&state, &headers, &seller_wallet).await?;
    let context = lot_context(
        &state,
        ticket_id,
        input.market_id,
        input.round_id,
        Some(&seller_wallet),
    )
    .await?;
    ensure_owner(&context.ticket, &seller_wallet)?;
    if !matches!(context.ticket.status, TicketStatus::Listed) {
        return Err(ApiError::bad_request(
            "listing_not_active",
            "Ticket su an listelenmis degil.",
        ));
    }

    let config = resolve_cash_buy_config(&state)?;
    let signature = submit_secondary_resale(
        &config,
        SecondaryScriptArgs::Cancel {
            program_id: program_id(&state)?,
            global: context.global.clone(),
            round: context.round.clone(),
            position_lot: context.position_lot.clone(),
            seller_wallet: seller_wallet.clone(),
        },
    )?;
    state
        .store
        .cancel_ticket_listing(ticket_id, &api_event_meta(&signature))
        .await
        .map_err(ApiError::internal)?;
    state.persist_cash_projection().await?;
    invalidate_market_cache(&state, context.market_id).await;

    Ok(Json(CancelListingResponse {
        status: "cancelled",
        ticket_id: ticket_id.to_string(),
        signature: signature.clone(),
        explorer_url: solana_explorer_tx_url(&signature),
    }))
}

pub(crate) async fn buy_listing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(ticket_id): Path<u64>,
    Json(input): Json<BuyListingRequest>,
) -> Result<Json<CashResaleResponse>, ApiError> {
    let buyer_wallet = normalize_wallet(&input.buyer_wallet, "buyer_wallet")?;
    require_wallet_owner(&state, &headers, &buyer_wallet).await?;
    let max_price_per_ticket =
        parse_positive_u64(&input.max_price_per_ticket, "max_price_per_ticket")?;
    let execution = execute_buy_listing_internal(
        &state,
        ticket_id,
        buyer_wallet,
        max_price_per_ticket,
        input.market_id,
        input.round_id,
    )
    .await?;
    Ok(Json(buy_listing_response(execution)))
}

pub(crate) async fn execute_buy_listing_for_market_buy(
    state: &AppState,
    ticket_id: u64,
    buyer_wallet: String,
    max_price_per_ticket: u64,
    market_id: u64,
    round_id: u64,
) -> Result<BuyListingExecution, ApiError> {
    execute_buy_listing_internal(
        state,
        ticket_id,
        buyer_wallet,
        max_price_per_ticket,
        Some(market_id),
        Some(round_id),
    )
    .await
}

async fn execute_buy_listing_internal(
    state: &AppState,
    ticket_id: u64,
    buyer_wallet: String,
    max_price_per_ticket: u64,
    market_id: Option<u64>,
    round_id: Option<u64>,
) -> Result<BuyListingExecution, ApiError> {
    let context = lot_context(state, ticket_id, market_id, round_id, None).await?;
    ensure_round_live(state, context.market_id, context.round_id).await?;
    ensure_tradeable_ticket(&context.ticket)?;
    let price_per_ticket = context.ticket.listed_price.ok_or_else(|| {
        ApiError::bad_request("listing_not_active", "Ticket su an listelenmis degil.")
    })?;
    if price_per_ticket > u128::from(max_price_per_ticket) {
        return Err(ApiError::bad_request(
            "slippage",
            "Listed price max fiyati asti.",
        ));
    }
    if context.ticket.current_owner == buyer_wallet {
        return Err(ApiError::bad_request(
            "self_buy",
            "Kendi ticket'ini alamazsin.",
        ));
    }
    let gross_usdc = listing_total_price(context.ticket.stake_amount, price_per_ticket)?;
    let buyer_cash_balance = state
        .store
        .get_cash_balance(&buyer_wallet)
        .await
        .map(|row| row.cash_balance)
        .unwrap_or(0);
    if buyer_cash_balance < gross_usdc {
        return Err(ApiError::bad_request(
            "insufficient_cash_balance",
            "BUSDC bakiyesi yetersiz.",
        ));
    }
    let fees = resale_fees(gross_usdc, context.ticket.updated_at)?;
    let config = resolve_cash_buy_config(state)?;

    let signature = submit_secondary_resale(
        &config,
        SecondaryScriptArgs::BuyListing {
            program_id: program_id(state)?,
            global: context.global.clone(),
            round: context.round.clone(),
            position_lot: context.position_lot.clone(),
            usdc_mint: config.deposit.mint.clone(),
            cash_vault: config.deposit.vault_token_account.clone(),
            round_vault: context.round_vault.clone(),
            fee_vault: context.fee_vault.clone(),
            buyer_wallet: buyer_wallet.clone(),
            max_price_per_ticket,
        },
    )?;
    let row = CashResaleRow {
        sale_id: Uuid::new_v4().to_string(),
        signature: signature.clone(),
        bid_id: None,
        market_id: context.market_id,
        round_id: context.round_id,
        seller_wallet: context.ticket.current_owner.clone(),
        buyer_wallet: buyer_wallet.clone(),
        source_lot_id: ticket_id,
        buyer_lot_id: None,
        side: context.side.clone(),
        tickets_sold: context.ticket.stake_amount,
        gross_usdc,
        resale_fee: fees.resale_fee,
        early_flip_fee: fees.early_flip_fee,
        seller_receives: fees.seller_receives,
        created_at: Utc::now(),
    };
    let (seller_balance, buyer_balance, recorded) = state
        .store
        .record_cash_resale(row)
        .await
        .map_err(|error| cash_trade_store_error(error, "insufficient_cash_balance"))?;
    if recorded {
        state.persist_cash_projection().await?;
    }
    invalidate_market_cache(state, context.market_id).await;

    Ok(BuyListingExecution {
        ticket_id,
        buyer_lot_id: None,
        explorer_url: solana_explorer_tx_url(&signature),
        signature,
        gross_usdc,
        received_tickets: context.ticket.stake_amount,
        resale_fee: fees.resale_fee,
        early_flip_fee: fees.early_flip_fee,
        seller_receives: fees.seller_receives,
        seller_cash_balance: seller_balance.cash_balance,
        buyer_cash_balance: buyer_balance.cash_balance,
    })
}

pub(crate) async fn create_bid(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(round_id): Path<u64>,
    Json(input): Json<CreateBidRequest>,
) -> Result<Json<CashBidResponse>, ApiError> {
    let buyer_wallet = normalize_wallet(&input.buyer_wallet, "buyer_wallet")?;
    require_wallet_owner(&state, &headers, &buyer_wallet).await?;
    let market_id = input.market_id.unwrap_or(DEFAULT_MARKET_ID);
    ensure_round_live(&state, market_id, round_id).await?;
    let price_per_ticket = parse_positive_u128(&input.price_per_ticket, "price_per_ticket")?;
    let max_usdc = parse_positive_u128(&input.max_usdc, "max_usdc")?;
    let now = Utc::now();
    let row = CashBidRow {
        bid_id: Uuid::new_v4().to_string(),
        market_id,
        round_id,
        side: input.side.as_str().to_owned(),
        buyer_wallet: buyer_wallet.clone(),
        price_per_ticket,
        max_usdc,
        remaining_usdc: max_usdc,
        status: "active".to_owned(),
        created_at: now,
        updated_at: now,
    };
    let balance = state
        .store
        .insert_cash_bid(row.clone())
        .await
        .map_err(|error| cash_trade_store_error(error, "insufficient_cash_balance"))?;
    state.persist_cash_projection().await?;

    Ok(Json(CashBidResponse::from_row(
        row,
        Some(balance.cash_balance),
    )))
}

pub(crate) async fn list_bids(
    State(state): State<AppState>,
    Path(round_id): Path<u64>,
    Query(query): Query<BidQuery>,
) -> Result<Json<BidBookResponse>, ApiError> {
    let market_id = query.market_id.unwrap_or(DEFAULT_MARKET_ID);
    let bids = state
        .store
        .active_cash_bids(market_id, round_id)
        .await
        .into_iter()
        .map(|row| CashBidResponse::from_row(row, None))
        .collect();
    Ok(Json(BidBookResponse {
        round_id: round_id.to_string(),
        bids,
    }))
}

pub(crate) async fn get_orderbook(
    State(state): State<AppState>,
    Path(round_id): Path<u64>,
    Query(query): Query<OrderBookQuery>,
) -> Result<Json<OrderBookResponse>, ApiError> {
    let market_id = query.market_id.unwrap_or(DEFAULT_MARKET_ID);
    let live = is_round_live(&state, market_id, round_id).await?;
    if !live {
        return Ok(Json(OrderBookResponse {
            market_id: market_id.to_string(),
            round_id: round_id.to_string(),
            updated_at: Utc::now().to_rfc3339(),
            state: "round_closed",
            sides: empty_orderbook_sides(),
        }));
    }

    let bids = state.store.active_cash_bids(market_id, round_id).await;
    let asks = state.store.listed_cash_asks(market_id, round_id).await;
    Ok(Json(OrderBookResponse {
        market_id: market_id.to_string(),
        round_id: round_id.to_string(),
        updated_at: Utc::now().to_rfc3339(),
        state: "live",
        sides: vec![
            orderbook_side("UP", &bids, &asks),
            orderbook_side("DOWN", &bids, &asks),
        ],
    }))
}

pub(crate) async fn cancel_bid(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((_round_id, bid_id)): Path<(u64, String)>,
    Json(input): Json<CancelBidRequest>,
) -> Result<Json<CashBidResponse>, ApiError> {
    let buyer_wallet = normalize_wallet(&input.buyer_wallet, "buyer_wallet")?;
    require_wallet_owner(&state, &headers, &buyer_wallet).await?;
    let balance = state
        .store
        .cancel_cash_bid(&bid_id, &buyer_wallet)
        .await
        .map_err(ApiError::internal)?;
    state.persist_cash_projection().await?;
    Ok(Json(CashBidResponse {
        bid_id,
        market_id: String::new(),
        round_id: String::new(),
        side: String::new(),
        buyer_wallet,
        price_per_ticket: "0".to_owned(),
        max_usdc: "0".to_owned(),
        remaining_usdc: "0".to_owned(),
        status: "cancelled".to_owned(),
        cash_balance: Some(balance.cash_balance.to_string()),
    }))
}

pub(crate) async fn instant_sell(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(ticket_id): Path<u64>,
    Json(input): Json<InstantSellRequest>,
) -> Result<Json<CashResaleResponse>, ApiError> {
    let seller_wallet = normalize_wallet(&input.seller_wallet, "seller_wallet")?;
    require_wallet_owner(&state, &headers, &seller_wallet).await?;
    let context = lot_context(
        &state,
        ticket_id,
        input.market_id,
        input.round_id,
        Some(&seller_wallet),
    )
    .await?;
    ensure_owner(&context.ticket, &seller_wallet)?;
    ensure_tradeable_ticket(&context.ticket)?;
    let bid = state
        .store
        .best_cash_bid(context.market_id, context.round_id, &context.side)
        .await
        .ok_or_else(|| ApiError::bad_request("no_active_bid", "Bu side icin hazir buyer yok."))?;
    if bid.buyer_wallet == seller_wallet {
        return Err(ApiError::bad_request(
            "self_buy",
            "Kendi bid'ine satis yapamazsin.",
        ));
    }
    if let Some(min_price) = input.min_price_per_ticket.as_deref() {
        let min_price = parse_positive_u128(min_price, "min_price_per_ticket")?;
        if bid.price_per_ticket < min_price {
            return Err(ApiError::bad_request(
                "slippage",
                "Best bid min fiyatin altinda.",
            ));
        }
    }
    let max_tickets = bid
        .remaining_usdc
        .checked_mul(SCALE)
        .and_then(|value| value.checked_div(bid.price_per_ticket))
        .ok_or_else(overflow)?;
    let tickets_to_sell = context.ticket.stake_amount.min(max_tickets);
    let gross_usdc = listing_total_price(tickets_to_sell, bid.price_per_ticket)?;
    if tickets_to_sell == 0 || gross_usdc == 0 {
        return Err(ApiError::bad_request(
            "bid_too_small",
            "Best bid bu lot icin fill uretmiyor.",
        ));
    }
    let sold_all = tickets_to_sell == context.ticket.stake_amount;
    let buyer_lot_id = if sold_all {
        None
    } else {
        Some(lot_id_from_uuid(Uuid::new_v4()))
    };
    let buyer_lot_address = if let Some(buyer_lot_id) = buyer_lot_id {
        let round_bytes =
            decode_solana_pubkey(&context.round, "round").map_err(ApiError::internal)?;
        let lot_seed = buyer_lot_id.to_le_bytes();
        derive_program_address(
            &[b"lot", &round_bytes, &lot_seed],
            &program_id(&state)?,
            "program_id",
        )
        .map_err(ApiError::internal)?
    } else {
        context.position_lot.clone()
    };
    let fees = resale_fees(gross_usdc, context.ticket.updated_at)?;
    let config = resolve_cash_buy_config(&state)?;
    let signature = submit_secondary_resale(
        &config,
        SecondaryScriptArgs::InstantSell {
            program_id: program_id(&state)?,
            global: context.global.clone(),
            round: context.round.clone(),
            seller_lot: context.position_lot.clone(),
            buyer_lot: buyer_lot_address,
            usdc_mint: config.deposit.mint.clone(),
            cash_vault: config.deposit.vault_token_account.clone(),
            round_vault: context.round_vault.clone(),
            fee_vault: context.fee_vault.clone(),
            seller_wallet: seller_wallet.clone(),
            buyer_wallet: bid.buyer_wallet.clone(),
            buyer_lot_id: buyer_lot_id.unwrap_or(0),
            tickets_to_sell: u64_from_u128(tickets_to_sell, "tickets_to_sell")?,
            gross_usdc: u64_from_u128(gross_usdc, "gross_usdc")?,
        },
    )?;
    let row = CashResaleRow {
        sale_id: Uuid::new_v4().to_string(),
        signature: signature.clone(),
        bid_id: Some(bid.bid_id.clone()),
        market_id: context.market_id,
        round_id: context.round_id,
        seller_wallet,
        buyer_wallet: bid.buyer_wallet.clone(),
        source_lot_id: ticket_id,
        buyer_lot_id,
        side: context.side.clone(),
        tickets_sold: tickets_to_sell,
        gross_usdc,
        resale_fee: fees.resale_fee,
        early_flip_fee: fees.early_flip_fee,
        seller_receives: fees.seller_receives,
        created_at: Utc::now(),
    };
    let (seller_balance, buyer_balance, recorded) = state
        .store
        .record_cash_resale(row)
        .await
        .map_err(ApiError::internal)?;
    if recorded {
        state.persist_cash_projection().await?;
    }
    invalidate_market_cache(&state, context.market_id).await;

    Ok(Json(resale_response(ResaleResponseInput {
        status: if sold_all { "sold" } else { "partially_sold" },
        ticket_id,
        buyer_lot_id,
        signature,
        gross_usdc,
        fees,
        seller_cash_balance: seller_balance.cash_balance,
        buyer_cash_balance: buyer_balance.cash_balance,
    })))
}

fn submit_secondary_resale(
    config: &ResolvedCashBuyConfig,
    args: SecondaryScriptArgs,
) -> Result<String, ApiError> {
    let script_path = resale_script_path(config);
    let mut command = Command::new("node");
    command
        .arg(script_path)
        .arg("--mode")
        .arg(args.mode())
        .arg("--cashier-keypair")
        .arg(&config.cashier_keypair_path)
        .arg("--env")
        .arg(&config.env_path)
        .arg("--rpc-url")
        .arg(&config.rpc_url);

    match args {
        SecondaryScriptArgs::List {
            program_id,
            global,
            round,
            position_lot,
            seller_wallet,
            price_per_ticket,
        } => {
            command
                .arg("--program-id")
                .arg(program_id)
                .arg("--global")
                .arg(global)
                .arg("--round")
                .arg(round)
                .arg("--position-lot")
                .arg(position_lot)
                .arg("--seller-wallet")
                .arg(seller_wallet)
                .arg("--price-per-ticket")
                .arg(price_per_ticket.to_string());
        }
        SecondaryScriptArgs::Cancel {
            program_id,
            global,
            round,
            position_lot,
            seller_wallet,
        } => {
            command
                .arg("--program-id")
                .arg(program_id)
                .arg("--global")
                .arg(global)
                .arg("--round")
                .arg(round)
                .arg("--position-lot")
                .arg(position_lot)
                .arg("--seller-wallet")
                .arg(seller_wallet);
        }
        SecondaryScriptArgs::BuyListing {
            program_id,
            global,
            round,
            position_lot,
            usdc_mint,
            cash_vault,
            round_vault,
            fee_vault,
            buyer_wallet,
            max_price_per_ticket,
        } => {
            command
                .arg("--program-id")
                .arg(program_id)
                .arg("--global")
                .arg(global)
                .arg("--round")
                .arg(round)
                .arg("--position-lot")
                .arg(position_lot)
                .arg("--usdc-mint")
                .arg(usdc_mint)
                .arg("--cash-vault")
                .arg(cash_vault)
                .arg("--round-vault")
                .arg(round_vault)
                .arg("--fee-vault")
                .arg(fee_vault)
                .arg("--buyer-wallet")
                .arg(buyer_wallet)
                .arg("--max-price-per-ticket")
                .arg(max_price_per_ticket.to_string());
        }
        SecondaryScriptArgs::InstantSell {
            program_id,
            global,
            round,
            seller_lot,
            buyer_lot,
            usdc_mint,
            cash_vault,
            round_vault,
            fee_vault,
            seller_wallet,
            buyer_wallet,
            buyer_lot_id,
            tickets_to_sell,
            gross_usdc,
        } => {
            command
                .arg("--program-id")
                .arg(program_id)
                .arg("--global")
                .arg(global)
                .arg("--round")
                .arg(round)
                .arg("--seller-lot")
                .arg(seller_lot)
                .arg("--buyer-lot")
                .arg(buyer_lot)
                .arg("--usdc-mint")
                .arg(usdc_mint)
                .arg("--cash-vault")
                .arg(cash_vault)
                .arg("--round-vault")
                .arg(round_vault)
                .arg("--fee-vault")
                .arg(fee_vault)
                .arg("--seller-wallet")
                .arg(seller_wallet)
                .arg("--buyer-wallet")
                .arg(buyer_wallet)
                .arg("--buyer-lot-id")
                .arg(buyer_lot_id.to_string())
                .arg("--tickets-to-sell")
                .arg(tickets_to_sell.to_string())
                .arg("--gross-usdc")
                .arg(gross_usdc.to_string());
        }
    }

    let output = command.output().map_err(ApiError::internal)?;
    if !output.status.success() {
        tracing::warn!(
            stderr = %String::from_utf8_lossy(&output.stderr),
            "secondary resale script failed"
        );
        return Err(ApiError::service_unavailable(
            "secondary_resale_transaction_failed",
            "Secondary resale transaction tamamlanamadi.",
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_script_signature(&stdout).ok_or_else(|| {
        ApiError::service_unavailable(
            "secondary_resale_transaction_failed",
            "Secondary resale transaction signature okunamadi.",
        )
    })
}

#[allow(clippy::large_enum_variant)]
enum SecondaryScriptArgs {
    List {
        program_id: String,
        global: String,
        round: String,
        position_lot: String,
        seller_wallet: String,
        price_per_ticket: u64,
    },
    Cancel {
        program_id: String,
        global: String,
        round: String,
        position_lot: String,
        seller_wallet: String,
    },
    BuyListing {
        program_id: String,
        global: String,
        round: String,
        position_lot: String,
        usdc_mint: String,
        cash_vault: String,
        round_vault: String,
        fee_vault: String,
        buyer_wallet: String,
        max_price_per_ticket: u64,
    },
    InstantSell {
        program_id: String,
        global: String,
        round: String,
        seller_lot: String,
        buyer_lot: String,
        usdc_mint: String,
        cash_vault: String,
        round_vault: String,
        fee_vault: String,
        seller_wallet: String,
        buyer_wallet: String,
        buyer_lot_id: u64,
        tickets_to_sell: u64,
        gross_usdc: u64,
    },
}

impl SecondaryScriptArgs {
    fn mode(&self) -> &'static str {
        match self {
            Self::List { .. } => "list",
            Self::Cancel { .. } => "cancel",
            Self::BuyListing { .. } => "buy-listing",
            Self::InstantSell { .. } => "instant-sell",
        }
    }
}

async fn lot_context(
    state: &AppState,
    ticket_id: u64,
    market_id: Option<u64>,
    round_id: Option<u64>,
    expected_owner: Option<&str>,
) -> Result<LotContext, ApiError> {
    let ticket = state
        .store
        .get_ticket(ticket_id)
        .await
        .ok_or_else(|| ApiError::not_found("ticket_not_found", "Ticket bulunamadi."))?;
    if let Some(owner) = expected_owner {
        ensure_owner(&ticket, owner)?;
    }
    let side = side_from_outcome(ticket.outcome_id)?;
    let chain = chain_context_for_lot(state, ticket_id, market_id, round_id).await?;
    if chain.market_id != ticket.market_id {
        return Err(ApiError::bad_request(
            "lot_market_mismatch",
            "Ticket market bilgisi uyumsuz.",
        ));
    }
    Ok(LotContext {
        ticket,
        market_id: chain.market_id,
        round_id: chain.round_id,
        side,
        position_lot: chain.position_lot,
        global: chain.addresses.global,
        round: chain.addresses.round,
        round_vault: chain.addresses.round_vault,
        fee_vault: chain.addresses.fee_vault,
    })
}

struct ChainLotContext {
    market_id: u64,
    round_id: u64,
    position_lot: String,
    addresses: RoundAddresses,
}

async fn chain_context_for_lot(
    state: &AppState,
    lot_id: u64,
    market_id: Option<u64>,
    round_id: Option<u64>,
) -> Result<ChainLotContext, ApiError> {
    if let Some(row) = state.store.cash_trade_for_lot(lot_id).await {
        return chain_context_from_cash_trade(state, row, lot_id).await;
    }
    if let Some(row) = state.store.cash_resale_for_buyer_lot(lot_id).await {
        let addresses = round_addresses(state, row.market_id, row.round_id)?;
        let position_lot = derive_lot_address(state, &addresses.round, lot_id)?;
        return Ok(ChainLotContext {
            market_id: row.market_id,
            round_id: row.round_id,
            position_lot,
            addresses,
        });
    }
    let market_id = market_id.unwrap_or(DEFAULT_MARKET_ID);
    let round_id = round_id.ok_or_else(|| {
        ApiError::bad_request(
            "round_id_required",
            "Bu ticket icin round bilgisi bulunamadi; round_id gerekli.",
        )
    })?;
    let addresses = round_addresses(state, market_id, round_id)?;
    let position_lot = derive_lot_address(state, &addresses.round, lot_id)?;
    Ok(ChainLotContext {
        market_id,
        round_id,
        position_lot,
        addresses,
    })
}

async fn chain_context_from_cash_trade(
    state: &AppState,
    row: CashTradeRow,
    lot_id: u64,
) -> Result<ChainLotContext, ApiError> {
    let addresses = round_addresses(state, row.market_id, row.round_id)?;
    let position_lot = if row.lot_id == lot_id {
        row.position_lot
    } else {
        derive_lot_address(state, &addresses.round, lot_id)?
    };
    Ok(ChainLotContext {
        market_id: row.market_id,
        round_id: row.round_id,
        position_lot,
        addresses,
    })
}

fn round_addresses(
    state: &AppState,
    market_id: u64,
    round_id: u64,
) -> Result<RoundAddresses, ApiError> {
    let program_id = program_id(state)?;
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
    let deposit = resolve_cash_buy_config(state)?.deposit;
    let round_vault =
        derive_associated_token_address(&round, &deposit.mint).map_err(ApiError::internal)?;
    let fee_vault =
        derive_associated_token_address(&global, &deposit.mint).map_err(ApiError::internal)?;
    Ok(RoundAddresses {
        global,
        round,
        round_vault,
        fee_vault,
    })
}

fn derive_lot_address(state: &AppState, round: &str, lot_id: u64) -> Result<String, ApiError> {
    let round_bytes = decode_solana_pubkey(round, "round").map_err(ApiError::internal)?;
    let lot_seed = lot_id.to_le_bytes();
    derive_program_address(
        &[b"lot", &round_bytes, &lot_seed],
        &program_id(state)?,
        "program_id",
    )
    .map_err(ApiError::internal)
}

pub(crate) async fn ensure_round_live(
    state: &AppState,
    market_id: u64,
    round_id: u64,
) -> Result<(), ApiError> {
    if is_round_live(state, market_id, round_id).await? {
        return Ok(());
    }
    Err(ApiError::bad_request(
        "round_not_live",
        "Round live trading disinda.",
    ))
}

async fn is_round_live(state: &AppState, market_id: u64, round_id: u64) -> Result<bool, ApiError> {
    let market = state
        .store
        .get_market(market_id)
        .await
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market bulunamadi."))?;
    let stream = crate::crypto_projection::phase_one_stream_for_market_id(market_id)
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market stream bulunamadi."))?;
    let (start_at, end_at) =
        round_window(round_id, stream.duration_seconds).map_err(ApiError::internal)?;
    let now = Utc::now().timestamp();
    Ok(market.status == MarketStatus::Open && now >= start_at && now < end_at)
}

fn ensure_tradeable_ticket(ticket: &TicketRow) -> Result<(), ApiError> {
    if ticket.claimed
        || matches!(
            ticket.status,
            TicketStatus::Claimable
                | TicketStatus::Refundable
                | TicketStatus::Claimed
                | TicketStatus::Lost
                | TicketStatus::Cancelled
        )
    {
        return Err(ApiError::bad_request(
            "ticket_not_tradeable",
            "Ticket artik trade edilemez.",
        ));
    }
    Ok(())
}

fn ensure_owner(ticket: &TicketRow, owner: &str) -> Result<(), ApiError> {
    if ticket.current_owner != owner {
        return Err(ApiError::bad_request(
            "wallet_mismatch",
            "Wallet bu ticket'in current owner'i degil.",
        ));
    }
    Ok(())
}

fn listing_total_price(tickets: u128, price_per_ticket: u128) -> Result<u128, ApiError> {
    tickets
        .checked_mul(price_per_ticket)
        .and_then(|value| value.checked_div(SCALE))
        .ok_or_else(overflow)
}

fn empty_orderbook_sides() -> Vec<OrderBookSideResponse> {
    vec![
        OrderBookSideResponse {
            side: "UP",
            bids: Vec::new(),
            asks: Vec::new(),
            best_bid_price: None,
            best_ask_price: None,
        },
        OrderBookSideResponse {
            side: "DOWN",
            bids: Vec::new(),
            asks: Vec::new(),
            best_bid_price: None,
            best_ask_price: None,
        },
    ]
}

fn orderbook_side(
    side: &'static str,
    bids: &[CashBidRow],
    asks: &[TicketRow],
) -> OrderBookSideResponse {
    let bid_rows: Vec<_> = bids
        .iter()
        .filter(|bid| bid.side == side)
        .map(|bid| {
            let available_tickets = bid
                .remaining_usdc
                .checked_mul(SCALE)
                .and_then(|value| value.checked_div(bid.price_per_ticket))
                .unwrap_or(0);
            OrderBookBidResponse {
                bid_id: bid.bid_id.clone(),
                price_per_ticket: bid.price_per_ticket.to_string(),
                remaining_usdc: bid.remaining_usdc.to_string(),
                available_tickets: available_tickets.to_string(),
                total_usdc: bid.remaining_usdc.to_string(),
            }
        })
        .collect();
    let mut ask_rows: Vec<_> = asks
        .iter()
        .filter(|ask| matches!(side_from_outcome(ask.outcome_id).as_deref(), Ok(label) if label == side))
        .filter_map(|ask| {
            let price = ask.listed_price?;
            let total = listing_total_price(ask.stake_amount, price).ok()?;
            Some(OrderBookAskResponse {
                lot_id: ask.ticket_id.to_string(),
                price_per_ticket: price.to_string(),
                ticket_amount: ask.stake_amount.to_string(),
                total_usdc: total.to_string(),
            })
        })
        .collect();
    ask_rows.sort_by(|left, right| {
        price_key(&left.price_per_ticket)
            .cmp(&price_key(&right.price_per_ticket))
            .then_with(|| left.lot_id.cmp(&right.lot_id))
    });

    OrderBookSideResponse {
        side,
        best_bid_price: bid_rows.first().map(|row| row.price_per_ticket.clone()),
        best_ask_price: ask_rows.first().map(|row| row.price_per_ticket.clone()),
        bids: bid_rows,
        asks: ask_rows,
    }
}

fn price_key(value: &str) -> u128 {
    value.parse::<u128>().unwrap_or(u128::MAX)
}

#[derive(Clone, Copy)]
struct ResaleFees {
    resale_fee: u128,
    early_flip_fee: u128,
    seller_receives: u128,
}

fn resale_fees(
    gross_usdc: u128,
    last_transfer_at: chrono::DateTime<Utc>,
) -> Result<ResaleFees, ApiError> {
    let resale_fee = gross_usdc
        .checked_mul(u128::from(DEFAULT_RESALE_FEE_BPS))
        .and_then(|value| value.checked_div(BPS_DENOMINATOR))
        .ok_or_else(overflow)?;
    let held_seconds = Utc::now()
        .signed_duration_since(last_transfer_at)
        .num_seconds()
        .max(0);
    let early_bps = if held_seconds < 10 {
        500u128
    } else if held_seconds < 30 {
        300u128
    } else if held_seconds < 60 {
        100u128
    } else {
        0u128
    };
    let early_flip_fee = gross_usdc
        .checked_mul(early_bps)
        .and_then(|value| value.checked_div(BPS_DENOMINATOR))
        .ok_or_else(overflow)?;
    let seller_receives = gross_usdc
        .checked_sub(resale_fee)
        .and_then(|value| value.checked_sub(early_flip_fee))
        .ok_or_else(overflow)?;
    Ok(ResaleFees {
        resale_fee,
        early_flip_fee,
        seller_receives,
    })
}

struct ResaleResponseInput {
    status: &'static str,
    ticket_id: u64,
    buyer_lot_id: Option<u64>,
    signature: String,
    gross_usdc: u128,
    fees: ResaleFees,
    seller_cash_balance: u128,
    buyer_cash_balance: u128,
}

fn resale_response(input: ResaleResponseInput) -> CashResaleResponse {
    CashResaleResponse {
        status: input.status,
        ticket_id: input.ticket_id.to_string(),
        buyer_lot_id: input.buyer_lot_id.map(|value| value.to_string()),
        explorer_url: solana_explorer_tx_url(&input.signature),
        signature: input.signature,
        gross_usdc: input.gross_usdc.to_string(),
        seller_receives: input.fees.seller_receives.to_string(),
        resale_fee: input.fees.resale_fee.to_string(),
        early_flip_fee: input.fees.early_flip_fee.to_string(),
        seller_cash_balance: input.seller_cash_balance.to_string(),
        buyer_cash_balance: input.buyer_cash_balance.to_string(),
    }
}

fn buy_listing_response(execution: BuyListingExecution) -> CashResaleResponse {
    CashResaleResponse {
        status: "bought_listing",
        ticket_id: execution.ticket_id.to_string(),
        buyer_lot_id: execution.buyer_lot_id.map(|value| value.to_string()),
        explorer_url: execution.explorer_url,
        signature: execution.signature,
        gross_usdc: execution.gross_usdc.to_string(),
        seller_receives: execution.seller_receives.to_string(),
        resale_fee: execution.resale_fee.to_string(),
        early_flip_fee: execution.early_flip_fee.to_string(),
        seller_cash_balance: execution.seller_cash_balance.to_string(),
        buyer_cash_balance: execution.buyer_cash_balance.to_string(),
    }
}

fn resale_script_path(config: &ResolvedCashBuyConfig) -> PathBuf {
    std::env::var("SOLANA_SECONDARY_RESALE_SCRIPT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            config
                .script_path
                .with_file_name("secondary-resale-devnet.mjs")
        })
}

fn api_event_meta(signature: &str) -> EventMeta {
    EventMeta {
        cluster: "devnet".to_owned(),
        program_id: String::new(),
        slot: 0,
        block_hash: "api-secondary-resale".to_owned(),
        signature: signature.to_owned(),
        instruction_index: 0,
    }
}

async fn invalidate_market_cache(state: &AppState, market_id: u64) {
    let _ = market_id;
    state.cache.flush().await;
}

fn normalize_wallet(value: &str, field: &'static str) -> Result<String, ApiError> {
    normalize_base58_pubkey(value, field)
        .map_err(|_| ApiError::bad_request("invalid_wallet", "Wallet address gecersiz."))
}

fn program_id(state: &AppState) -> Result<String, ApiError> {
    state.chain_config.program_id.clone().ok_or_else(|| {
        ApiError::service_unavailable("program_not_configured", "Solana program id hazir degil.")
    })
}

fn side_from_outcome(outcome_id: u8) -> Result<String, ApiError> {
    match outcome_id {
        0 => Ok("UP".to_owned()),
        1 => Ok("DOWN".to_owned()),
        _ => Err(ApiError::bad_request(
            "invalid_side",
            "Ticket side gecersiz.",
        )),
    }
}

fn parse_positive_u64(value: &str, field: &'static str) -> Result<u64, ApiError> {
    u64_from_u128(parse_positive_u128(value, field)?, field)
}

fn parse_positive_u128(value: &str, field: &'static str) -> Result<u128, ApiError> {
    let parsed = value
        .parse::<u128>()
        .map_err(|_| ApiError::bad_request("invalid_amount", "Amount gecersiz."))?;
    if parsed == 0 {
        return Err(ApiError::bad_request(
            "invalid_amount",
            "Amount sifirdan buyuk olmali.",
        ));
    }
    if field.is_empty() {
        return Err(overflow());
    }
    Ok(parsed)
}

fn u64_from_u128(value: u128, _field: &'static str) -> Result<u64, ApiError> {
    u64::try_from(value)
        .map_err(|_| ApiError::bad_request("amount_too_large", "Amount u64 sinirini asti."))
}

fn lot_id_from_uuid(uuid: Uuid) -> u64 {
    let bytes = uuid.as_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("uuid has 16 bytes"))
}

fn overflow() -> ApiError {
    ApiError::bad_request("arithmetic_overflow", "Amount hesaplamasi tasma uretti.")
}

impl CashBidResponse {
    fn from_row(row: CashBidRow, cash_balance: Option<u128>) -> Self {
        Self {
            bid_id: row.bid_id,
            market_id: row.market_id.to_string(),
            round_id: row.round_id.to_string(),
            side: row.side,
            buyer_wallet: row.buyer_wallet,
            price_per_ticket: row.price_per_ticket.to_string(),
            max_usdc: row.max_usdc.to_string(),
            remaining_usdc: row.remaining_usdc.to_string(),
            status: row.status,
            cash_balance: cash_balance.map(|value| value.to_string()),
        }
    }
}
