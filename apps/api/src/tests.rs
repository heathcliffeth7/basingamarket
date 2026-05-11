use axum::http::{header, Method, StatusCode};
use basingamarket_auth::{PrivyAccessTokenClaims, PrivyAuthConfig};
use basingamarket_db::{
    CashBidRow, CashProjectionSnapshot, CashResaleRow, CashTradeReservationRow, CashTradeRow,
    EventMeta, ProjectionEngine,
};
use basingamarket_domain::crypto_rounds::current_round_id;
use basingamarket_protocol_events::ProtocolEvent;
use http_body_util::BodyExt;
use jsonwebtoken::{encode, get_current_timestamp, Algorithm, EncodingKey, Header};
use p256::{
    ecdsa::SigningKey,
    elliptic_curve::rand_core::OsRng,
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
};
use std::sync::OnceLock;
use tower::ServiceExt;

use super::*;

const TEST_APP_ID: &str = "test-privy-app";
const TEST_SOLANA_PUBKEY: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

struct TestEs256Keys {
    signing_pem: String,
    verifying_pem: String,
}

fn test_es256_keys() -> &'static TestEs256Keys {
    static KEYS: OnceLock<TestEs256Keys> = OnceLock::new();
    KEYS.get_or_init(|| {
        let signing_key = SigningKey::random(&mut OsRng);
        TestEs256Keys {
            signing_pem: signing_key
                .to_pkcs8_pem(LineEnding::LF)
                .unwrap()
                .to_string(),
            verifying_pem: signing_key
                .verifying_key()
                .to_public_key_pem(LineEnding::LF)
                .unwrap(),
        }
    })
}

fn app_state() -> AppState {
    AppState::new(
        InMemoryProjectionStore::default(),
        MemoryEventBus::default(),
    )
    .with_auth_config(None)
}

fn ready_cash_chain_config() -> SolanaDevnetConfig {
    SolanaDevnetConfig::from_all_values(
        None,
        None,
        None,
        None,
        None,
        Some(TEST_SOLANA_PUBKEY.to_owned()),
        Some(6),
        Some("So11111111111111111111111111111111111111112".to_owned()),
        None,
        Some("confirmed".to_owned()),
        None,
        None,
        None,
        None,
    )
    .unwrap()
}

fn test_auth_config() -> PrivyAuthConfig {
    PrivyAuthConfig::new(TEST_APP_ID, &test_es256_keys().verifying_pem).unwrap()
}

fn valid_privy_token() -> String {
    let now = get_current_timestamp();
    encode(
        &Header::new(Algorithm::ES256),
        &PrivyAccessTokenClaims {
            aud: TEST_APP_ID.to_owned(),
            exp: now + 3600,
            iat: now,
            iss: "privy.io".to_owned(),
            sid: "session-1".to_owned(),
            sub: "did:privy:user-1".to_owned(),
        },
        &EncodingKey::from_ec_pem(test_es256_keys().signing_pem.as_bytes()).unwrap(),
    )
    .unwrap()
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvVarGuard {
    fn remove(key: &'static str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::remove_var(key);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(previous) = &self.previous {
            std::env::set_var(self.key, previous);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

async fn seeded_state() -> AppState {
    let state = app_state();
    let engine = ProjectionEngine::new(state.store.clone());
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
        .await
        .unwrap();
    engine
        .apply_raw_event(
            EventMeta::fixture(2, 0),
            ProtocolEvent::TicketMinted {
                ticket_id: 7,
                market_id: 1,
                owner: TEST_SOLANA_PUBKEY.to_owned(),
                outcome_id: 0,
                stake_amount: 1_000_000,
                reward_shares: 1_000_000,
                entry_odds: 1_000_000,
                confidence: 80,
                mood: 1,
            },
        )
        .await
        .unwrap();
    state
}

async fn seeded_state_with_auth() -> AppState {
    seeded_state()
        .await
        .with_auth_config(Some(test_auth_config()))
}

async fn seeded_state_with_price(price_header: MarketPriceHeaderResponse) -> AppState {
    let state = app_state().with_price_provider(MarketPriceProvider::static_prices(HashMap::from(
        [(1, price_header)],
    )));
    let engine = ProjectionEngine::new(state.store.clone());
    engine
        .apply_raw_event(
            EventMeta::fixture(1, 0),
            ProtocolEvent::MarketCreated {
                market_id: 1,
                question_hash: "BTC 5m".to_owned(),
                outcome_count: 2,
                open_at: 1_700_000_100,
                trade_until: 1_700_000_400,
            },
        )
        .await
        .unwrap();
    state
}

#[tokio::test]
async fn legacy_cash_trade_backfill_infers_market_id_from_position_lot_pda() {
    let program_id = "3oAve8qsR5oVtqUcsXtSELBVz5CnJifj4UCvM6AiHa2r";
    let market_id = 1u64;
    let round_id = 5_928_349u64;
    let lot_id = 2_904_486_627_900_539_881u64;
    let market_seed = market_id.to_le_bytes();
    let round_seed = round_id.to_le_bytes();
    let lot_seed = lot_id.to_le_bytes();
    let market =
        derive_program_address(&[b"market", &market_seed], program_id, "program_id").unwrap();
    let market_bytes = decode_solana_pubkey(&market, "market").unwrap();
    let round = derive_program_address(
        &[b"round", &market_bytes, &round_seed],
        program_id,
        "program_id",
    )
    .unwrap();
    let round_bytes = decode_solana_pubkey(&round, "round").unwrap();
    let position_lot =
        derive_program_address(&[b"lot", &round_bytes, &lot_seed], program_id, "program_id")
            .unwrap();
    assert_eq!(position_lot, "GD3depRC3z8a8uArS2hJWXxv4AJVLQQxGsK99KKwZpQd");
    let state = app_state().with_chain_config(
        SolanaDevnetConfig::from_values(None, None, None, Some(program_id.to_owned()), None)
            .unwrap(),
    );
    state
        .store
        .replace_cash_projection_snapshot(CashProjectionSnapshot {
            version: 1,
            cash_trades: vec![CashTradeRow {
                trade_id: "trade-1".to_owned(),
                wallet_address: TEST_SOLANA_PUBKEY.to_owned(),
                signature: "cash-buy-signature".to_owned(),
                mint: TEST_SOLANA_PUBKEY.to_owned(),
                vault_token_account: TEST_SOLANA_PUBKEY.to_owned(),
                market_id: 0,
                round_id,
                position_lot,
                lot_id,
                side: "UP".to_owned(),
                usdc_in: 1_000_000,
                fee_usdc: 5_000,
                net_usdc: 995_000,
                tickets_out: 1_989_961,
                created_at: chrono::Utc::now(),
            }],
            ..CashProjectionSnapshot::default()
        })
        .await;

    let backfilled = backfill_legacy_cash_trade_market_ids(&state).await.unwrap();
    let snapshot = state.store.cash_projection_snapshot().await;

    assert_eq!(backfilled, 1);
    assert_eq!(snapshot.cash_trades[0].market_id, 1);
    assert_eq!(
        state.store.cash_trade_side_volume(1, round_id, "UP").await,
        995_000
    );
}

fn price_header_fixture(state: &'static str) -> MarketPriceHeaderResponse {
    MarketPriceHeaderResponse {
        asset: "BTC".to_owned(),
        asset_image_url: "/visuals/crypto/btc.svg".to_owned(),
        duration_seconds: 300,
        settlement_source: "Binance Spot BTCUSDT 5m".to_owned(),
        symbol: "BTCUSDT".to_owned(),
        round_id: "5666667".to_owned(),
        start_at: 1_700_000_100,
        end_at: 1_700_000_400,
        open_price: Some("35567280000".to_owned()),
        current_price: (state == "live").then(|| "35580000000".to_owned()),
        close_price: (state == "closed").then(|| "35559990000".to_owned()),
        price_display_state: state,
        fetched_at: "2026-05-10T00:00:00Z".to_owned(),
    }
}

#[tokio::test]
async fn orderbook_groups_active_bids_and_listed_asks_by_side() {
    let state = seeded_state().await;
    let engine = ProjectionEngine::new(state.store.clone());
    engine
        .apply_raw_event(
            EventMeta::fixture(3, 0),
            ProtocolEvent::TicketMinted {
                ticket_id: 8,
                market_id: 1,
                owner: "So11111111111111111111111111111111111111112".to_owned(),
                outcome_id: 1,
                stake_amount: 2_000_000,
                reward_shares: 2_000_000,
                entry_odds: 500_000,
                confidence: 70,
                mood: 2,
            },
        )
        .await
        .unwrap();
    let round_id = current_round_id(chrono::Utc::now().timestamp(), 300).unwrap();
    state
        .store
        .list_ticket(7, 800_000, &EventMeta::fixture(4, 0))
        .await
        .unwrap();
    state
        .store
        .list_ticket(8, 600_000, &EventMeta::fixture(5, 0))
        .await
        .unwrap();
    let now = chrono::Utc::now();
    state
        .store
        .replace_cash_projection_snapshot(CashProjectionSnapshot {
            version: 1,
            cash_trades: vec![
                CashTradeRow {
                    trade_id: "trade-up".to_owned(),
                    wallet_address: TEST_SOLANA_PUBKEY.to_owned(),
                    signature: "cash-buy-up".to_owned(),
                    mint: TEST_SOLANA_PUBKEY.to_owned(),
                    vault_token_account: TEST_SOLANA_PUBKEY.to_owned(),
                    market_id: 1,
                    round_id,
                    position_lot: "lot-up".to_owned(),
                    lot_id: 7,
                    side: "UP".to_owned(),
                    usdc_in: 1_000_000,
                    fee_usdc: 0,
                    net_usdc: 1_000_000,
                    tickets_out: 1_000_000,
                    created_at: now,
                },
                CashTradeRow {
                    trade_id: "trade-down".to_owned(),
                    wallet_address: "So11111111111111111111111111111111111111112".to_owned(),
                    signature: "cash-buy-down".to_owned(),
                    mint: TEST_SOLANA_PUBKEY.to_owned(),
                    vault_token_account: TEST_SOLANA_PUBKEY.to_owned(),
                    market_id: 1,
                    round_id,
                    position_lot: "lot-down".to_owned(),
                    lot_id: 8,
                    side: "DOWN".to_owned(),
                    usdc_in: 1_000_000,
                    fee_usdc: 0,
                    net_usdc: 1_000_000,
                    tickets_out: 2_000_000,
                    created_at: now,
                },
            ],
            cash_bids: vec![
                CashBidRow {
                    bid_id: "bid-low".to_owned(),
                    market_id: 1,
                    round_id,
                    side: "UP".to_owned(),
                    buyer_wallet: TEST_SOLANA_PUBKEY.to_owned(),
                    price_per_ticket: 600_000,
                    max_usdc: 1_200_000,
                    remaining_usdc: 1_200_000,
                    status: "active".to_owned(),
                    created_at: now,
                    updated_at: now,
                },
                CashBidRow {
                    bid_id: "bid-high".to_owned(),
                    market_id: 1,
                    round_id,
                    side: "UP".to_owned(),
                    buyer_wallet: TEST_SOLANA_PUBKEY.to_owned(),
                    price_per_ticket: 700_000,
                    max_usdc: 1_400_000,
                    remaining_usdc: 1_400_000,
                    status: "active".to_owned(),
                    created_at: now,
                    updated_at: now,
                },
                CashBidRow {
                    bid_id: "bid-cancelled".to_owned(),
                    market_id: 1,
                    round_id,
                    side: "DOWN".to_owned(),
                    buyer_wallet: TEST_SOLANA_PUBKEY.to_owned(),
                    price_per_ticket: 900_000,
                    max_usdc: 1_000_000,
                    remaining_usdc: 1_000_000,
                    status: "cancelled".to_owned(),
                    created_at: now,
                    updated_at: now,
                },
            ],
            ..CashProjectionSnapshot::default()
        })
        .await;

    let response = build_router(state)
        .oneshot(
            Request::builder()
                .uri(format!("/rounds/{round_id}/orderbook?market_id=1"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["state"], "live");
    assert_eq!(json["sides"][0]["side"], "UP");
    assert_eq!(json["sides"][0]["best_bid_price"], "700000");
    assert_eq!(json["sides"][0]["bids"][0]["bid_id"], "bid-high");
    assert_eq!(json["sides"][0]["bids"][1]["bid_id"], "bid-low");
    assert_eq!(json["sides"][0]["asks"][0]["lot_id"], "7");
    assert_eq!(json["sides"][1]["side"], "DOWN");
    assert_eq!(json["sides"][1]["bids"].as_array().unwrap().len(), 0);
    assert_eq!(json["sides"][1]["asks"][0]["lot_id"], "8");
}

#[tokio::test]
async fn markets_empty_db_seeds_phase_one_protocol_markets() {
    let app = build_router(app_state());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/markets")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    let markets = json.as_array().unwrap();
    assert_eq!(markets.len(), 6);
    assert_eq!(markets[0]["question_hash"], "BTC 5m Crypto Round");
    assert_eq!(markets[1]["question_hash"], "ETH 5m Crypto Round");
    assert_eq!(markets[2]["question_hash"], "SOL 5m Crypto Round");
    assert_eq!(markets[3]["question_hash"], "BTC 1m Crypto Round");
    assert_eq!(markets[4]["question_hash"], "ETH 1m Crypto Round");
    assert_eq!(markets[5]["question_hash"], "SOL 1m Crypto Round");
}

#[tokio::test]
async fn missing_market_returns_404() {
    let app = build_router(app_state());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/markets/404")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn profile_cash_without_projection_returns_pending_without_fake_amount() {
    let app = build_router(app_state());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/cash"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], TEST_SOLANA_PUBKEY);
    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["decimals"], 6);
    assert_eq!(json["cash_balance"], Value::Null);
    assert_eq!(json["status"], "projection_pending");
}

#[tokio::test]
async fn profile_cash_without_row_returns_zero_when_cash_config_is_ready() {
    let state = app_state().with_chain_config(ready_cash_chain_config());
    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/cash"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], TEST_SOLANA_PUBKEY);
    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["decimals"], 6);
    assert_eq!(json["cash_balance"], "0");
    assert_eq!(json["status"], "ready");
}

#[tokio::test]
async fn profile_cash_returns_normalized_wallet_and_string_amount() {
    let state = app_state();
    state
        .store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_SOLANA_PUBKEY.to_owned(),
            cash_balance: 8_490_000,
            updated_at: chrono::Utc::now(),
        })
        .await;
    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/cash"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], TEST_SOLANA_PUBKEY);
    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["decimals"], 6);
    assert_eq!(json["cash_balance"], "8490000");
    assert_eq!(json["status"], "ready");
}

#[tokio::test]
async fn busdc_mint_requires_authentication() {
    let state = app_state().with_auth_config(Some(test_auth_config()));
    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn busdc_mint_credits_fifty_thousand_and_cash_reports_busdc() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
    let app = build_router(state);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["minted_amount"], "50000000000");
    assert_eq!(json["cash_balance"], "50000000000");
    assert_eq!(json["daily_mints_used"], 1);
    assert_eq!(json["daily_mints_limit"], 5);
    assert_eq!(json["status"], "credited");

    let status_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mint-status"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status_body = status_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let status_json: Value = serde_json::from_slice(&status_body).unwrap();
    assert_eq!(status_json["currency"], "BUSDC");
    assert_eq!(status_json["mint_amount"], "50000000000");
    assert_eq!(status_json["daily_mints_used"], 1);
    assert_eq!(status_json["daily_mints_remaining"], 4);
    assert_eq!(status_json["daily_mints_limit"], 5);
    assert_eq!(status_json["status"], "ready");

    let cash_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/cash"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let cash_body = cash_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let cash_json: Value = serde_json::from_slice(&cash_body).unwrap();
    assert_eq!(cash_json["currency"], "BUSDC");
    assert_eq!(cash_json["cash_balance"], "50000000000");
}

#[tokio::test]
async fn busdc_mint_requires_reserve_backing_config() {
    let _guard = EnvVarGuard::remove("SOLANA_CASH_MINT_AUTHORITY_KEYPAIR");
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_chain_config(ready_cash_chain_config());
    let store = state.store.clone();
    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "busdc_mint_reserve_unavailable");
    assert!(store.get_cash_balance(TEST_SOLANA_PUBKEY).await.is_none());
}

#[tokio::test]
async fn busdc_mint_rejects_sixth_daily_mint() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
    let app = build_router(state);

    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", valid_privy_token()),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["code"], "busdc_mint_limit_exceeded");
}

#[tokio::test]
async fn open_market_response_includes_open_and_current_price_header() {
    let app = build_router(seeded_state_with_price(price_header_fixture("live")).await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/markets/1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["price_header"]["asset"], "BTC");
    assert_eq!(json["price_header"]["open_price"], "35567280000");
    assert_eq!(json["price_header"]["current_price"], "35580000000");
    assert_eq!(json["price_header"]["close_price"], Value::Null);
    assert_eq!(json["price_header"]["price_display_state"], "live");
}

#[tokio::test]
async fn closed_market_response_keeps_close_price_without_current_price() {
    let app = build_router(seeded_state_with_price(price_header_fixture("closed")).await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/markets/1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["price_header"]["open_price"], "35567280000");
    assert_eq!(json["price_header"]["current_price"], Value::Null);
    assert_eq!(json["price_header"]["close_price"], "35559990000");
    assert_eq!(json["price_header"]["price_display_state"], "closed");
}

#[tokio::test]
async fn canvas_reads_projection_without_raw_replay() {
    let app = build_router(seeded_state().await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/markets/1/canvas")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["market_id"], "1");
    assert_eq!(json["market_sequence"], 13);
    assert_eq!(json["canvas_version"], 13);
    assert_eq!(json["width"], 1200);
    assert_eq!(json["height"], 630);
    assert_eq!(json["regions"][0]["outcome_id"], "0");
    assert_eq!(json["nodes"][0]["ticket_id"], "7");
    assert_eq!(json["nodes"][0]["outcome_id"], "0");
    assert_eq!(json["nodes"][0]["owner"], TEST_SOLANA_PUBKEY);
    assert_eq!(json["nodes"][0]["original_caller"], TEST_SOLANA_PUBKEY);
    assert_eq!(json["nodes"][0]["mood"], "optimistic");
    assert_eq!(json["nodes"][0]["status"], "active");
}

#[tokio::test]
async fn share_render_creates_pending_job_and_event() {
    let state = seeded_state_with_auth().await;
    let bus = state.bus.clone();
    let app = build_router(state);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/share/7/render")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let share_card_id = json["share_card_id"].as_str().unwrap();
    assert_eq!(json["status"], "pending");

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/share/{share_card_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["kind"], "ticket");
    assert_eq!(json["ticket_id"], "7");
    assert_eq!(json["status"], "pending");
    assert_eq!(
        bus.events_for_topic(topics::SHARE_RENDER_REQUESTED)
            .await
            .len(),
        1
    );
}

#[tokio::test]
async fn listing_endpoint_requires_auth_with_json_body() {
    let app = build_router(seeded_state_with_auth().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/tickets/7/list")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "seller_wallet": TEST_SOLANA_PUBKEY,
                        "price_per_ticket": "500000",
                        "market_id": 1,
                        "round_id": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn market_buy_endpoint_requires_auth_with_json_body() {
    let app = build_router(seeded_state_with_auth().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rounds/1/market-buy")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "buyer_wallet": TEST_SOLANA_PUBKEY,
                        "side": "UP",
                        "usdc_in": "1000000",
                        "market_id": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_post_without_token_returns_401() {
    let app = build_router(seeded_state_with_auth().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/share/7/render")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_post_with_invalid_token_returns_401() {
    let app = build_router(seeded_state_with_auth().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/share/7/render")
                .header(header::AUTHORIZATION, "Bearer invalid-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_post_without_auth_config_returns_503() {
    let app = build_router(seeded_state().await);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/share/7/render")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn share_card_not_found_returns_404() {
    let app = build_router(seeded_state().await);
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/share/{}", Uuid::new_v4()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cors_allows_vite_dev_origins() {
    let app = build_router(app_state());
    for method in [Method::GET, Method::DELETE] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/markets")
                    .header(header::ORIGIN, "http://localhost:5173")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, method.as_str())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "http://localhost:5173"
        );
    }
}
