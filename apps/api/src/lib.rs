use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::Arc};

mod busdc_mints;
mod chain_status;
mod crypto_projection;
mod deposit_repairs;
mod deposits;
mod error;
mod health;
mod http_config;
mod metrics;
mod protocol_markets;
mod secondary_resale;
mod sol_deposit_price;
mod trade_intent;
mod transfer_deposits;
mod withdrawals;

use axum::{
    body::Body,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Request},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use basingamarket_auth::{
    normalize_solana_pubkey, parse_bearer_token, AuthError, PrivyAuthConfig, VerifiedPrivyClaims,
};
use basingamarket_chain::{decode_solana_pubkey, derive_program_address, SolanaDevnetConfig};
use basingamarket_db::{
    CanvasObjectRow, CashBalanceRow, CashTradeRow, InMemoryProjectionStore, MarketRow, OutcomeRow,
    ShareCardRow, ShareCardStatus, TicketRow,
};
use basingamarket_domain::{
    crypto_rounds::{all_protocol_stream_configs, MarketStreamConfig},
    MarketStatus, TicketStatus,
};
use basingamarket_market_data::binance::{
    binance_symbol_for_asset, BinanceClient, BinanceTickerPrice,
};
use basingamarket_realtime::{
    topics, CacheKey, EventEnvelope, EventPublisher, MemoryCache, MemoryEventBus,
};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) use error::ApiError;
pub use sol_deposit_price::SolDepositPriceProvider;

#[derive(Debug, Clone)]
pub struct AppState {
    pub store: InMemoryProjectionStore,
    pub bus: MemoryEventBus,
    pub cache: MemoryCache,
    pub auth: Option<PrivyAuthConfig>,
    pub price_provider: MarketPriceProvider,
    pub sol_deposit_price_provider: SolDepositPriceProvider,
    pub chain_config: SolanaDevnetConfig,
    pub(crate) busdc_reserve_backer: BusdcReserveBacker,
    projection_store_path: Option<Arc<PathBuf>>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum BusdcReserveBacker {
    Script,
    #[cfg(test)]
    MockSuccess,
}

impl AppState {
    pub fn new(store: InMemoryProjectionStore, bus: MemoryEventBus) -> Self {
        let chain_config =
            SolanaDevnetConfig::from_env().expect("only Solana devnet runtime config is supported");
        Self {
            store,
            bus,
            cache: MemoryCache::default(),
            auth: PrivyAuthConfig::from_env().ok(),
            price_provider: MarketPriceProvider::disabled(),
            sol_deposit_price_provider: SolDepositPriceProvider::binance(),
            chain_config,
            busdc_reserve_backer: BusdcReserveBacker::Script,
            projection_store_path: None,
        }
    }

    pub fn with_auth_config(mut self, auth: Option<PrivyAuthConfig>) -> Self {
        self.auth = auth;
        self
    }

    pub fn with_price_provider(mut self, price_provider: MarketPriceProvider) -> Self {
        self.price_provider = price_provider;
        self
    }

    pub fn with_sol_deposit_price_provider(
        mut self,
        price_provider: SolDepositPriceProvider,
    ) -> Self {
        self.sol_deposit_price_provider = price_provider;
        self
    }

    pub fn with_chain_config(mut self, chain_config: SolanaDevnetConfig) -> Self {
        self.chain_config = chain_config;
        self
    }

    pub fn with_projection_store_path(mut self, path: Option<PathBuf>) -> Self {
        self.projection_store_path = path.map(Arc::new);
        self
    }

    #[cfg(test)]
    pub(crate) fn with_busdc_reserve_backer(mut self, backer: BusdcReserveBacker) -> Self {
        self.busdc_reserve_backer = backer;
        self
    }

    pub(crate) async fn persist_cash_projection(&self) -> Result<(), ApiError> {
        if let Some(path) = &self.projection_store_path {
            self.store
                .save_cash_projection_snapshot(path.as_ref())
                .await
                .map_err(ApiError::internal)?;
        }
        Ok(())
    }
}

pub async fn backfill_legacy_cash_trade_market_ids(state: &AppState) -> anyhow::Result<usize> {
    let Some(program_id) = state.chain_config.program_id.as_deref() else {
        return Ok(0);
    };
    let market_ids = all_protocol_stream_configs()
        .into_iter()
        .map(|stream| stream.market_id)
        .collect::<Vec<_>>();
    let backfilled = state
        .store
        .backfill_cash_trade_market_ids(|row| {
            infer_legacy_cash_trade_market_id(row, program_id, &market_ids)
        })
        .await;
    if backfilled > 0 {
        state
            .persist_cash_projection()
            .await
            .map_err(|_| anyhow::anyhow!("failed to persist cash trade market_id backfill"))?;
    }
    Ok(backfilled)
}

fn infer_legacy_cash_trade_market_id(
    row: &CashTradeRow,
    program_id: &str,
    market_ids: &[u64],
) -> Option<u64> {
    if row.market_id != 0 || row.position_lot.trim().is_empty() {
        return None;
    }
    let round_seed = row.round_id.to_le_bytes();
    let lot_seed = row.lot_id.to_le_bytes();

    for market_id in market_ids {
        let market_seed = market_id.to_le_bytes();
        let market =
            derive_program_address(&[b"market", &market_seed], program_id, "program_id").ok()?;
        let market_bytes = decode_solana_pubkey(&market, "market").ok()?;
        let round = derive_program_address(
            &[b"round", &market_bytes, &round_seed],
            program_id,
            "program_id",
        )
        .ok()?;
        let round_bytes = decode_solana_pubkey(&round, "round").ok()?;
        let position_lot =
            derive_program_address(&[b"lot", &round_bytes, &lot_seed], program_id, "program_id")
                .ok()?;
        if position_lot == row.position_lot {
            return Some(*market_id);
        }
    }

    None
}

#[derive(Debug, Clone)]
pub enum MarketPriceProvider {
    Disabled,
    Static(Arc<HashMap<u64, MarketPriceHeaderResponse>>),
    Binance(BinanceClient),
}

impl MarketPriceProvider {
    pub fn disabled() -> Self {
        Self::Disabled
    }

    pub fn binance() -> Self {
        Self::Binance(BinanceClient::default())
    }

    pub fn static_prices(prices: HashMap<u64, MarketPriceHeaderResponse>) -> Self {
        Self::Static(Arc::new(prices))
    }

    async fn price_header_for_market(
        &self,
        market: &MarketRow,
    ) -> Option<MarketPriceHeaderResponse> {
        match self {
            Self::Disabled => None,
            Self::Static(prices) => prices.get(&market.market_id).cloned(),
            Self::Binance(client) => binance_price_header_for_market(client, market).await,
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .route("/chain/status", get(chain_status::chain_status))
        .route("/metrics", get(metrics::metrics))
        .route("/markets", get(list_markets))
        .route("/markets/{id}", get(get_market))
        .route("/markets/{id}/curve", get(get_market_curve))
        .route("/markets/{id}/rounds", get(get_market_rounds))
        .route(
            "/rounds/{round_id}/buy-intent",
            post(trade_intent::create_buy_intent),
        )
        .route(
            "/rounds/{round_id}/cash-buy",
            post(trade_intent::execute_cash_buy),
        )
        .route(
            "/rounds/{round_id}/market-buy",
            post(trade_intent::execute_market_buy),
        )
        .route("/markets/{id}/canvas", get(get_canvas))
        .route("/markets/{id}/tickets", get(get_market_tickets))
        .route("/tickets/{id}", get(get_ticket))
        .route("/tickets/{id}/list", post(secondary_resale::list_ticket))
        .route(
            "/tickets/{id}/cancel-listing",
            post(secondary_resale::cancel_listing),
        )
        .route(
            "/tickets/{id}/buy-listing",
            post(secondary_resale::buy_listing),
        )
        .route(
            "/tickets/{id}/instant-sell",
            post(secondary_resale::instant_sell),
        )
        .route(
            "/rounds/{round_id}/bids",
            get(secondary_resale::list_bids).post(secondary_resale::create_bid),
        )
        .route(
            "/rounds/{round_id}/orderbook",
            get(secondary_resale::get_orderbook),
        )
        .route(
            "/rounds/{round_id}/bids/{bid_id}",
            delete(secondary_resale::cancel_bid),
        )
        .route("/share/{ticket_id}/render", post(request_share_render))
        .route("/share/{share_card_id}", get(get_share_card))
        .route("/deposit/config", get(deposits::get_deposit_config))
        .route("/deposit/liquidity", get(deposits::get_deposit_liquidity))
        .route("/withdraw/config", get(withdrawals::get_withdraw_config))
        .route("/profiles/{address}/cash", get(get_profile_cash))
        .route(
            "/profiles/{address}/busdc-mint-status",
            get(busdc_mints::get_busdc_mint_status),
        )
        .route(
            "/profiles/{address}/busdc-mints",
            post(busdc_mints::mint_busdc),
        )
        .route(
            "/profiles/{address}/withdrawal-quotes",
            post(withdrawals::create_withdrawal_quote),
        )
        .route(
            "/profiles/{address}/withdrawals",
            post(withdrawals::verify_withdrawal),
        )
        .route(
            "/profiles/{address}/withdrawals/latest",
            get(withdrawals::get_latest_withdrawal),
        )
        .route(
            "/profiles/{address}/sol-deposit-quote",
            get(deposits::get_sol_deposit_quote),
        )
        .route(
            "/profiles/{address}/sol-deposits",
            post(deposits::verify_profile_sol_deposit),
        )
        .route(
            "/profiles/{address}/sol-deposit-repairs",
            post(deposit_repairs::repair_sol_deposit),
        )
        .route(
            "/profiles/{address}/transfer-deposit-quotes",
            post(transfer_deposits::create_transfer_deposit_quote),
        )
        .route(
            "/profiles/{address}/transfer-deposits",
            post(transfer_deposits::verify_transfer_deposit),
        )
        .route(
            "/profiles/{address}/deposits",
            post(deposits::verify_profile_deposit),
        )
        .route("/profiles/{address}", get(get_profile))
        .route("/ws/markets/{id}", get(ws_market))
        .layer(http_config::cors_layer())
        .layer(middleware::from_fn(add_request_id))
        .with_state(state)
}

pub async fn serve(bind_addr: SocketAddr, state: AppState) -> anyhow::Result<()> {
    protocol_markets::seed_phase_one_protocol_markets(&state.store).await?;
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

async fn ensure_phase_one_protocol_markets(state: &AppState) -> Result<(), ApiError> {
    let inserted = protocol_markets::seed_phase_one_protocol_markets(&state.store)
        .await
        .map_err(ApiError::internal)?;
    if inserted {
        state.cache.flush().await;
    }
    Ok(())
}

async fn list_markets(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    if let Some(cached) = state.cache.get(CacheKey::market_list()).await {
        return Ok(Json(cached));
    }

    let markets = state.store.list_markets().await;
    let market_sequence = state.store.indexer_cursor().await.unwrap_or(0);
    let mut response = Vec::with_capacity(markets.len());
    for market in markets {
        let outcomes = state.store.get_outcomes(market.market_id).await;
        response.push(market_response_from_rows(&state, market, outcomes, market_sequence).await);
    }
    let value = serde_json::to_value(response).map_err(ApiError::internal)?;
    state
        .cache
        .set_json(CacheKey::market_list(), value.clone(), 10)
        .await;
    Ok(Json(value))
}

async fn get_market(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let cache_key = CacheKey::market_detail(id);
    if let Some(cached) = state.cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let market = state
        .store
        .get_market(id)
        .await
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market bulunamadi."))?;
    let outcomes = state.store.get_outcomes(id).await;
    let market_sequence = state
        .store
        .indexer_cursor()
        .await
        .unwrap_or(market.created_slot);
    let response = market_response_from_rows(&state, market, outcomes, market_sequence).await;
    let value = serde_json::to_value(response).map_err(ApiError::internal)?;
    state.cache.set_json(cache_key, value.clone(), 10).await;
    Ok(Json(value))
}

async fn get_market_curve(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Query(query): Query<crypto_projection::CurveQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let market = state
        .store
        .get_market(id)
        .await
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market bulunamadi."))?;
    let outcomes = state.store.get_outcomes(id).await;
    let now_ts = chrono::Utc::now().timestamp();
    let round_id = crypto_projection::market_curve_round_id(&market, now_ts, query.start_at)
        .ok_or_else(|| ApiError::not_found("curve_not_found", "Curve projection bulunamadi."))?;
    let cash_volumes = crypto_projection::CashCurveVolumes {
        up: state.store.cash_trade_side_volume(id, round_id, "UP").await,
        down: state
            .store
            .cash_trade_side_volume(id, round_id, "DOWN")
            .await,
    };
    let response = crypto_projection::market_curve_response(
        &market,
        &outcomes,
        now_ts,
        query.start_at,
        cash_volumes,
    )
    .ok_or_else(|| ApiError::not_found("curve_not_found", "Curve projection bulunamadi."))?;

    serde_json::to_value(response)
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_market_rounds(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Query(query): Query<crypto_projection::RoundHistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let market = state
        .store
        .get_market(id)
        .await
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market bulunamadi."))?;
    let response = crypto_projection::round_history_response(
        &market,
        query.limit,
        chrono::Utc::now().timestamp(),
    )
    .ok_or_else(|| ApiError::not_found("rounds_not_found", "Round history bulunamadi."))?;

    serde_json::to_value(response)
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_canvas(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let cache_key = CacheKey::market_canvas(id);
    if let Some(cached) = state.cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let market = state
        .store
        .get_market(id)
        .await
        .ok_or_else(|| ApiError::not_found("market_not_found", "Market bulunamadi."))?;
    let outcomes = state.store.get_outcomes(id).await;
    let tickets_by_id: HashMap<_, _> = state
        .store
        .get_tickets_for_market(id)
        .await
        .into_iter()
        .map(|ticket| (ticket.ticket_id, ticket))
        .collect();
    let market_sequence = state
        .store
        .indexer_cursor()
        .await
        .unwrap_or(market.created_slot);
    let value = serde_json::to_value(CanvasResponse {
        market_id: id.to_string(),
        market_sequence,
        canvas_version: market_sequence,
        width: 1200,
        height: 630,
        regions: canvas_regions(outcomes),
        nodes: state
            .store
            .get_canvas(id)
            .await
            .into_iter()
            .map(|object| {
                let ticket = tickets_by_id.get(&object.ticket_id);
                CanvasNodeResponse::from_rows(object, ticket)
            })
            .collect(),
    })
    .map_err(ApiError::internal)?;
    state.cache.set_json(cache_key, value.clone(), 5).await;
    Ok(Json(value))
}

async fn get_market_tickets(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    if state.store.get_market(id).await.is_none() {
        return Err(ApiError::not_found(
            "market_not_found",
            "Market bulunamadi.",
        ));
    }

    let tickets: Vec<_> = state
        .store
        .get_tickets_for_market(id)
        .await
        .into_iter()
        .map(TicketResponse::from)
        .collect();
    serde_json::to_value(tickets)
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_ticket(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let cache_key = CacheKey::ticket_detail(id);
    if let Some(cached) = state.cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let ticket = state
        .store
        .get_ticket(id)
        .await
        .ok_or_else(|| ApiError::not_found("ticket_not_found", "Ticket bulunamadi."))?;
    let value = serde_json::to_value(TicketResponse::from(ticket)).map_err(ApiError::internal)?;
    state.cache.set_json(cache_key, value.clone(), 5).await;
    Ok(Json(value))
}

async fn request_share_render(
    State(state): State<AppState>,
    Path(ticket_id): Path<u64>,
    headers: HeaderMap,
) -> Result<Json<ShareRenderResponse>, ApiError> {
    let _session = require_privy_session(&state, &headers)?;
    let row = state
        .store
        .create_share_card(ticket_id)
        .await
        .map_err(|_| ApiError::not_found("ticket_not_found", "Ticket bulunamadi."))?;
    let envelope = EventEnvelope::new(
        topics::SHARE_RENDER_REQUESTED,
        json!({
            "share_card_id": row.id.to_string(),
            "ticket_id": ticket_id.to_string()
        }),
    )
    .with_ticket(ticket_id);
    state
        .bus
        .publish(topics::SHARE_RENDER_REQUESTED, envelope)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(ShareRenderResponse::from(row)))
}

async fn get_share_card(
    State(state): State<AppState>,
    Path(share_card_id): Path<Uuid>,
) -> Result<Json<ShareCardResponse>, ApiError> {
    let row = state
        .store
        .get_share_card(share_card_id)
        .await
        .ok_or_else(|| ApiError::not_found("share_card_not_found", "Share card bulunamadi."))?;

    Ok(Json(ShareCardResponse::from(row)))
}

async fn get_profile(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let profile = state.store.get_profile(&wallet_address).await;

    Ok(Json(json!({
        "wallet_address": wallet_address,
        "display_name": profile.as_ref().and_then(|profile| profile.display_name.clone()),
        "avatar_url": profile.and_then(|profile| profile.avatar_url)
    })))
}

async fn get_profile_cash(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<CashBalanceResponse>, ApiError> {
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let cash_balance = state.store.get_cash_balance(&wallet_address).await;

    Ok(Json(CashBalanceResponse::from_projection(
        wallet_address,
        cash_balance,
        state.chain_config.deposit_status() == "ready",
    )))
}

async fn ws_market(Path(id): Path<u64>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, id))
}

async fn handle_socket(mut socket: WebSocket, market_id: u64) {
    let message = json!({
        "market_id": market_id.to_string(),
        "sequence": 0,
        "canvas_version": 0,
        "type": "canvas_updated",
        "payload": { "ready": true }
    });
    let _ = socket.send(Message::Text(message.to_string().into())).await;
}

fn require_privy_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<VerifiedPrivyClaims, ApiError> {
    let auth = state
        .auth
        .as_ref()
        .ok_or_else(ApiError::auth_not_configured)?;
    let token = parse_bearer_token(
        headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
    )
    .map_err(|_| ApiError::unauthorized())?;
    auth.verify_access_token(token)
        .map_err(|error| match error {
            AuthError::MissingAuthConfig | AuthError::InvalidVerificationKey => {
                ApiError::auth_not_configured()
            }
            _ => ApiError::unauthorized(),
        })
}

async fn add_request_id(mut request: Request<Body>, next: Next) -> Response {
    let request_id = Uuid::new_v4().to_string();
    request.extensions_mut().insert(request_id.clone());
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    response
}

#[derive(Debug, Serialize)]
struct CashBalanceResponse {
    wallet_address: String,
    currency: &'static str,
    decimals: u8,
    cash_balance: Option<String>,
    status: &'static str,
}

impl CashBalanceResponse {
    fn from_projection(
        wallet_address: String,
        cash_balance: Option<CashBalanceRow>,
        cash_config_ready: bool,
    ) -> Self {
        match cash_balance {
            Some(row) => Self {
                wallet_address,
                currency: "BUSDC",
                decimals: 6,
                cash_balance: Some(row.cash_balance.to_string()),
                status: "ready",
            },
            None if cash_config_ready => Self {
                wallet_address,
                currency: "BUSDC",
                decimals: 6,
                cash_balance: Some("0".to_owned()),
                status: "ready",
            },
            None => Self {
                wallet_address,
                currency: "BUSDC",
                decimals: 6,
                cash_balance: None,
                status: "projection_pending",
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MarketPriceHeaderResponse {
    asset: String,
    asset_image_url: String,
    duration_seconds: u64,
    settlement_source: String,
    symbol: String,
    round_id: String,
    start_at: i64,
    end_at: i64,
    open_price: Option<String>,
    current_price: Option<String>,
    close_price: Option<String>,
    price_display_state: &'static str,
    fetched_at: String,
}

#[derive(Debug, Serialize)]
struct MarketResponse {
    market_id: String,
    market_sequence: u64,
    question_hash: String,
    price_header: Option<MarketPriceHeaderResponse>,
    status: String,
    outcome_count: u8,
    open_at: u64,
    trade_until: u64,
    winning_outcome: Option<u8>,
    outcomes: Vec<OutcomeResponse>,
}

impl MarketResponse {
    fn from_rows(
        market: MarketRow,
        outcomes: Vec<OutcomeRow>,
        market_sequence: u64,
        price_header: Option<MarketPriceHeaderResponse>,
    ) -> Self {
        Self {
            market_id: market.market_id.to_string(),
            market_sequence,
            question_hash: market.question_hash,
            price_header,
            status: format!("{:?}", market.status).to_ascii_lowercase(),
            outcome_count: market.outcome_count,
            open_at: market.open_at,
            trade_until: market.trade_until,
            winning_outcome: market.winning_outcome,
            outcomes: outcomes.into_iter().map(OutcomeResponse::from).collect(),
        }
    }
}

async fn market_response_from_rows(
    state: &AppState,
    market: MarketRow,
    outcomes: Vec<OutcomeRow>,
    market_sequence: u64,
) -> MarketResponse {
    let price_header = state.price_provider.price_header_for_market(&market).await;
    MarketResponse::from_rows(market, outcomes, market_sequence, price_header)
}

async fn binance_price_header_for_market(
    client: &BinanceClient,
    market: &MarketRow,
) -> Option<MarketPriceHeaderResponse> {
    let stream = crypto_projection::phase_one_stream_for_market_id(market.market_id)?;
    let now_ts = chrono::Utc::now().timestamp();
    let live = market.status == MarketStatus::Open;
    let (round_id, start_at, end_at) =
        crypto_projection::price_round_window(market, &stream, now_ts, live, None)?;
    let symbol = binance_symbol_for_asset(stream.asset).ok()?.to_owned();
    let mut response = empty_price_header(&stream, symbol.clone(), round_id, start_at, end_at);

    let snapshot = client
        .fetch_round_snapshot(stream.asset, start_at, stream.duration_seconds)
        .await;

    if live {
        if let Ok(snapshot) = snapshot {
            response.open_price = Some(snapshot.start_price.to_string());
        }
        match client.fetch_ticker_price(&symbol).await {
            Ok(BinanceTickerPrice { price, .. }) if response.open_price.is_some() => {
                response.current_price = Some(price.to_string());
                response.price_display_state = "live";
            }
            Ok(BinanceTickerPrice { price, .. }) => {
                response.current_price = Some(price.to_string());
            }
            Err(_) => {}
        }
        return Some(response);
    }

    if let Ok(snapshot) = snapshot {
        response.open_price = Some(snapshot.start_price.to_string());
        response.close_price = Some(snapshot.end_price.to_string());
        response.price_display_state = "closed";
    }

    Some(response)
}

fn empty_price_header(
    stream: &MarketStreamConfig,
    symbol: String,
    round_id: u64,
    start_at: i64,
    end_at: i64,
) -> MarketPriceHeaderResponse {
    MarketPriceHeaderResponse {
        asset: stream.asset.to_string(),
        asset_image_url: crypto_projection::asset_image_url(stream.asset).to_owned(),
        duration_seconds: stream.duration_seconds,
        settlement_source: stream.settlement_source.to_string(),
        symbol,
        round_id: round_id.to_string(),
        start_at,
        end_at,
        open_price: None,
        current_price: None,
        close_price: None,
        price_display_state: "unavailable",
        fetched_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[derive(Debug, Serialize)]
struct OutcomeResponse {
    outcome_id: u8,
    label: String,
    total_stake: String,
    total_reward_shares: String,
    current_odds: String,
}

impl From<OutcomeRow> for OutcomeResponse {
    fn from(row: OutcomeRow) -> Self {
        Self {
            outcome_id: row.outcome_id,
            label: row.label,
            total_stake: row.total_stake.to_string(),
            total_reward_shares: row.total_reward_shares.to_string(),
            current_odds: row.current_odds.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
struct TicketResponse {
    ticket_id: String,
    market_id: String,
    outcome_id: u8,
    original_caller: String,
    current_owner: String,
    stake_amount: String,
    token_amount: String,
    reward_shares: String,
    entry_odds: String,
    cost_basis_usdc: String,
    avg_entry_price: String,
    settlement_value_usdc: Option<String>,
    realized_pnl_usdc: Option<String>,
    listed_price: Option<String>,
    status: String,
    claimed: bool,
    confidence: u16,
    mood: u8,
}

impl From<TicketRow> for TicketResponse {
    fn from(row: TicketRow) -> Self {
        let token_amount = ticket_token_amount(&row);
        let cost_basis_usdc = ticket_cost_basis_usdc(&row, token_amount);
        let avg_entry_price = avg_entry_price(cost_basis_usdc, token_amount);
        let settlement_value_usdc = row.settlement_value_usdc;
        Self {
            ticket_id: row.ticket_id.to_string(),
            market_id: row.market_id.to_string(),
            outcome_id: row.outcome_id,
            original_caller: row.original_caller,
            current_owner: row.current_owner,
            stake_amount: row.stake_amount.to_string(),
            token_amount: token_amount.to_string(),
            reward_shares: row.reward_shares.to_string(),
            entry_odds: row.entry_odds.to_string(),
            cost_basis_usdc: cost_basis_usdc.to_string(),
            avg_entry_price: avg_entry_price.to_string(),
            settlement_value_usdc: settlement_value_usdc.map(|amount| amount.to_string()),
            realized_pnl_usdc: settlement_value_usdc
                .map(|amount| signed_delta_string(amount, cost_basis_usdc)),
            listed_price: row.listed_price.map(|amount| amount.to_string()),
            status: format!("{:?}", row.status).to_ascii_lowercase(),
            claimed: row.claimed,
            confidence: row.confidence,
            mood: row.mood,
        }
    }
}

fn ticket_token_amount(row: &TicketRow) -> u128 {
    if row.reward_shares > 0 {
        row.reward_shares
    } else {
        row.stake_amount
    }
}

fn ticket_cost_basis_usdc(row: &TicketRow, token_amount: u128) -> u128 {
    if row.cost_basis_usdc > 0 {
        return row.cost_basis_usdc;
    }
    token_amount
        .checked_mul(row.entry_odds)
        .and_then(|value| value.checked_div(basingamarket_domain::SCALE))
        .unwrap_or(0)
}

fn avg_entry_price(cost_basis_usdc: u128, token_amount: u128) -> u128 {
    if token_amount == 0 {
        return 0;
    }
    cost_basis_usdc
        .checked_mul(basingamarket_domain::SCALE)
        .and_then(|value| value.checked_div(token_amount))
        .unwrap_or(0)
}

fn signed_delta_string(value: u128, cost: u128) -> String {
    if value >= cost {
        (value - cost).to_string()
    } else {
        format!("-{}", cost - value)
    }
}

#[derive(Debug, Serialize)]
struct CanvasResponse {
    market_id: String,
    market_sequence: u64,
    canvas_version: u64,
    width: u16,
    height: u16,
    regions: Vec<CanvasRegionResponse>,
    nodes: Vec<CanvasNodeResponse>,
}

#[derive(Debug, Serialize)]
struct CanvasRegionResponse {
    outcome_id: String,
    label: String,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    total_stake: String,
    current_odds: String,
    state: &'static str,
}

#[derive(Debug, Serialize)]
struct CanvasNodeResponse {
    ticket_id: String,
    outcome_id: String,
    x: i32,
    y: i32,
    radius: u16,
    z_index: i32,
    owner: String,
    owner_display: String,
    current_owner: String,
    original_caller: String,
    original_caller_display: String,
    avatar_url: Option<String>,
    mood: &'static str,
    confidence: u16,
    listed: bool,
    listed_price: Option<String>,
    last_transfer_at: Option<String>,
    status: &'static str,
}

impl CanvasNodeResponse {
    fn from_rows(row: CanvasObjectRow, ticket: Option<&TicketRow>) -> Self {
        let current_owner = ticket
            .map(|ticket| ticket.current_owner.clone())
            .unwrap_or_else(|| row.current_owner.clone());
        let original_caller = ticket
            .map(|ticket| ticket.original_caller.clone())
            .unwrap_or_else(|| row.original_caller.clone());
        let listed = ticket
            .map(|ticket| {
                ticket.listed_price.is_some() || matches!(ticket.status, TicketStatus::Listed)
            })
            .unwrap_or(row.listed);
        let last_transfer_at = (current_owner != original_caller).then(|| {
            ticket
                .map_or(row.updated_at, |ticket| ticket.updated_at)
                .to_rfc3339()
        });

        Self {
            ticket_id: row.ticket_id.to_string(),
            outcome_id: ticket
                .map(|ticket| ticket.outcome_id.to_string())
                .unwrap_or_else(|| "unknown".to_owned()),
            x: row.x,
            y: row.y,
            radius: row.radius,
            z_index: row.z_index,
            owner: current_owner.clone(),
            owner_display: short_address(&current_owner),
            current_owner,
            original_caller: original_caller.clone(),
            original_caller_display: short_address(&original_caller),
            avatar_url: row.avatar_url,
            mood: public_mood(row.mood),
            confidence: row.confidence,
            listed,
            listed_price: ticket
                .and_then(|ticket| ticket.listed_price)
                .map(|amount| amount.to_string()),
            last_transfer_at,
            status: public_canvas_ticket_status(ticket, listed),
        }
    }
}

#[derive(Debug, Serialize)]
struct ShareRenderResponse {
    share_card_id: String,
    status: &'static str,
}

impl From<ShareCardRow> for ShareRenderResponse {
    fn from(row: ShareCardRow) -> Self {
        Self {
            share_card_id: row.id.to_string(),
            status: public_share_status(row.status),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ShareCardResponse {
    id: String,
    kind: &'static str,
    ticket_id: Option<String>,
    status: &'static str,
    svg_hash: Option<String>,
    png_url: Option<String>,
    error_message: Option<String>,
    created_at: String,
    updated_at: String,
}

impl From<ShareCardRow> for ShareCardResponse {
    fn from(row: ShareCardRow) -> Self {
        Self {
            id: row.id.to_string(),
            kind: "ticket",
            ticket_id: Some(row.ticket_id.to_string()),
            status: public_share_status(row.status),
            svg_hash: row.svg_hash,
            png_url: row.png_url,
            error_message: row.error_message,
            created_at: row.created_at.to_rfc3339(),
            updated_at: row.updated_at.to_rfc3339(),
        }
    }
}

fn canvas_regions(outcomes: Vec<OutcomeRow>) -> Vec<CanvasRegionResponse> {
    let count = outcomes.len().max(1);
    outcomes
        .into_iter()
        .enumerate()
        .map(|(index, outcome)| {
            let (x, y, width, height) = match count {
                1 => (0, 0, 1200, 630),
                2 => ((index as u16) * 600, 0, 600, 630),
                3 => ((index as u16) * 400, 0, 400, 630),
                4 => (
                    ((index % 2) as u16) * 600,
                    ((index / 2) as u16) * 315,
                    600,
                    315,
                ),
                _ => {
                    let width = 1200 / count as u16;
                    ((index as u16) * width, 0, width, 630)
                }
            };

            CanvasRegionResponse {
                outcome_id: outcome.outcome_id.to_string(),
                label: outcome.label,
                x,
                y,
                width,
                height,
                total_stake: outcome.total_stake.to_string(),
                current_odds: outcome.current_odds.to_string(),
                state: "open",
            }
        })
        .collect()
}

fn public_mood(mood: u8) -> &'static str {
    match mood {
        1 => "optimistic",
        2 => "anxious",
        3 => "euphoric",
        _ => "neutral",
    }
}

fn public_canvas_ticket_status(ticket: Option<&TicketRow>, listed: bool) -> &'static str {
    match ticket.map(|ticket| ticket.status) {
        Some(TicketStatus::Listed) => "listed",
        Some(TicketStatus::Claimable) => "won",
        Some(TicketStatus::Claimed) => "claimed",
        Some(TicketStatus::Lost | TicketStatus::Cancelled) => "lost",
        Some(TicketStatus::Active) | None => {
            if listed {
                "listed"
            } else {
                "active"
            }
        }
    }
}

fn public_share_status(status: ShareCardStatus) -> &'static str {
    match status {
        ShareCardStatus::Pending => "pending",
        ShareCardStatus::Processing => "rendering",
        ShareCardStatus::Completed => "ready",
        ShareCardStatus::Failed => "failed",
    }
}

fn short_address(address: &str) -> String {
    if address.len() <= 12 {
        return address.to_owned();
    }
    format!("{}...{}", &address[..6], &address[address.len() - 4..])
}

#[cfg(test)]
mod tests;
