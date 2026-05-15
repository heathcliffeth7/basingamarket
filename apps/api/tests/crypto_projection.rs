use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use basingamarket_api::{build_router, AppState};
use basingamarket_db::{
    CashBalanceRow, CashTradeReservationRow, CashTradeRow, EventMeta, InMemoryProjectionStore,
    ProjectionEngine,
};
use basingamarket_protocol_events::ProtocolEvent;
use basingamarket_realtime::MemoryEventBus;
use chrono::Utc;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

const SCALE: u128 = 1_000_000;
const DEFAULT_VIRTUAL_USDC: u128 = 50_000 * SCALE;
const DEFAULT_VIRTUAL_TICKET: u128 = 100_000 * SCALE;
const UP_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DOWN_OWNER: &str = "So11111111111111111111111111111111111111112";

async fn seeded_app() -> axum::Router {
    let state = AppState::new(
        InMemoryProjectionStore::default(),
        MemoryEventBus::default(),
    )
    .with_auth_config(None);
    let engine = ProjectionEngine::new(state.store.clone());
    engine
        .apply_raw_event(
            EventMeta::fixture(1, 0),
            ProtocolEvent::MarketCreated {
                market_id: 1,
                question_hash: "BTC 5m Crypto Round".to_owned(),
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
                ticket_id: 1,
                market_id: 1,
                round_id: 1,
                owner: UP_OWNER.to_owned(),
                outcome_id: 0,
                stake_amount: 100 * SCALE,
                reward_shares: 100 * SCALE,
                entry_odds: 500_000,
                confidence: 80,
                mood: 1,
            },
        )
        .await
        .unwrap();
    engine
        .apply_raw_event(
            EventMeta::fixture(3, 0),
            ProtocolEvent::TicketMinted {
                ticket_id: 2,
                market_id: 1,
                round_id: 1,
                owner: DOWN_OWNER.to_owned(),
                outcome_id: 1,
                stake_amount: 50 * SCALE,
                reward_shares: 50 * SCALE,
                entry_odds: 500_000,
                confidence: 70,
                mood: 2,
            },
        )
        .await
        .unwrap();

    build_router(state)
}

async fn get_json(app: axum::Router, uri: &str) -> Value {
    let response = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

async fn record_cash_trade(
    store: &InMemoryProjectionStore,
    market_id: u64,
    round_id: u64,
    side: &str,
    net_usdc: u128,
) {
    let now = Utc::now();
    let trade_id = format!("trade-{market_id}-{round_id}-{side}");
    let wallet_address = format!("wallet-{market_id}-{side}");
    store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: wallet_address.clone(),
            cash_balance: net_usdc.saturating_add(SCALE),
            updated_at: now,
        })
        .await;
    store
        .reserve_cash_trade(CashTradeReservationRow {
            trade_id: trade_id.clone(),
            wallet_address: wallet_address.clone(),
            amount: net_usdc,
            released: false,
            completed_signature: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();
    store
        .record_cash_trade(CashTradeRow {
            trade_id,
            wallet_address,
            signature: format!("sig-{market_id}-{round_id}-{side}"),
            mint: "mint".to_owned(),
            vault_token_account: "vault".to_owned(),
            market_id,
            round_id,
            position_lot: "lot".to_owned(),
            lot_id: market_id,
            side: side.to_owned(),
            usdc_in: net_usdc,
            fee_usdc: 0,
            net_usdc,
            tickets_out: net_usdc.saturating_mul(2),
            created_at: now,
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn empty_store_lists_seeded_phase_one_crypto_markets() {
    let state = AppState::new(
        InMemoryProjectionStore::default(),
        MemoryEventBus::default(),
    )
    .with_auth_config(None);
    let app = build_router(state);
    let mut json = Value::Null;

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/markets")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        json = serde_json::from_slice(&body).unwrap();
    }

    let markets = json.as_array().unwrap();
    assert_eq!(markets.len(), 8);
    assert_eq!(markets[0]["market_id"], "1");
    assert_eq!(markets[0]["question_hash"], "BTC 5m Crypto Round");
    assert_eq!(markets[1]["question_hash"], "ETH 5m Crypto Round");
    assert_eq!(markets[2]["question_hash"], "SOL 5m Crypto Round");
    assert_eq!(markets[3]["market_id"], "11");
    assert_eq!(markets[3]["question_hash"], "BTC 1m Crypto Round");
    assert_eq!(markets[4]["question_hash"], "ETH 1m Crypto Round");
    assert_eq!(markets[5]["question_hash"], "SOL 1m Crypto Round");
    assert_eq!(markets[6]["market_id"], "14");
    assert_eq!(markets[6]["question_hash"], "DOGE 5m Crypto Round");
    assert_eq!(markets[7]["market_id"], "15");
    assert_eq!(markets[7]["question_hash"], "DOGE 1m Crypto Round");
    assert!(markets.iter().all(|market| market["status"] == "open"));
    assert!(markets.iter().all(|market| market["market_sequence"] == 15));

    for market in markets {
        let outcomes = market["outcomes"].as_array().unwrap();
        assert_eq!(outcomes.len(), 2);
        assert_eq!(outcomes[0]["label"], "UP");
        assert_eq!(outcomes[1]["label"], "DOWN");
        assert_eq!(outcomes[0]["current_odds"], "500000");
        assert_eq!(outcomes[1]["current_odds"], "500000");
    }
}

#[tokio::test]
async fn one_minute_market_curve_and_rounds_use_sixty_second_windows() {
    let app = build_router(
        AppState::new(
            InMemoryProjectionStore::default(),
            MemoryEventBus::default(),
        )
        .with_auth_config(None),
    );

    let curve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/markets/11/curve")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(curve_response.status(), StatusCode::OK);
    let body = curve_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let curve: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(curve["market_id"], "11");
    assert_eq!(curve["duration_seconds"], 60);

    let rounds_response = app
        .oneshot(
            Request::builder()
                .uri("/markets/11/rounds?limit=3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rounds_response.status(), StatusCode::OK);
    let body = rounds_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let rounds_json: Value = serde_json::from_slice(&body).unwrap();
    let rounds = rounds_json["rounds"].as_array().unwrap();

    assert_eq!(rounds_json["market_id"], "11");
    assert_eq!(rounds_json["duration_seconds"], 60);
    assert_eq!(rounds.len(), 3);
    for pair in rounds.windows(2) {
        let prev = pair[0]["start_at"].as_i64().unwrap();
        let next = pair[1]["start_at"].as_i64().unwrap();
        assert_eq!(next - prev, 60);
    }
}

#[tokio::test]
async fn empty_market_curve_reports_nonzero_virtual_market_cap() {
    let app = build_router(
        AppState::new(
            InMemoryProjectionStore::default(),
            MemoryEventBus::default(),
        )
        .with_auth_config(None),
    );
    let json = get_json(app, "/markets/1/curve").await;
    let sides = json["sides"].as_array().unwrap();

    assert_eq!(sides.len(), 2);
    assert!(sides
        .iter()
        .all(|side| side["market_cap"] == DEFAULT_VIRTUAL_USDC.to_string()));
}

#[tokio::test]
async fn market_curve_returns_up_down_projection_with_fixed_scale_metrics() {
    let response = seeded_app()
        .await
        .oneshot(
            Request::builder()
                .uri("/markets/1/curve")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let sides = json["sides"].as_array().unwrap();
    let up = sides.iter().find(|side| side["side"] == "UP").unwrap();
    let down = sides.iter().find(|side| side["side"] == "DOWN").unwrap();
    let up_volume = 100 * SCALE;
    let up_virtual_usdc = DEFAULT_VIRTUAL_USDC + up_volume;
    let up_virtual_ticket = DEFAULT_VIRTUAL_USDC * DEFAULT_VIRTUAL_TICKET / up_virtual_usdc;
    let up_supply = DEFAULT_VIRTUAL_TICKET - up_virtual_ticket;
    let up_price = up_virtual_usdc * SCALE / up_virtual_ticket;
    let up_market_cap = up_price * DEFAULT_VIRTUAL_TICKET / SCALE;

    assert_eq!(json["market_id"], "1");
    assert_eq!(json["duration_seconds"], 300);
    assert_eq!(sides.len(), 2);
    assert_eq!(up["price"], up_price.to_string());
    assert_eq!(up["best_entry_price"], up_price.to_string());
    assert_eq!(up["best_entry_source"], "fresh_curve");
    assert_eq!(up["fresh_mint_price"], up_price.to_string());
    assert_eq!(up["listed_best_ask_price"], Value::Null);
    assert_eq!(up["last_trade_price"], Value::Null);
    assert_eq!(up["token_supply"], up_supply.to_string());
    assert_eq!(up["market_cap"], up_market_cap.to_string());
    assert_eq!(up["liquidity"], up_volume.to_string());
    assert_eq!(up["volume"], up_volume.to_string());
    assert_eq!(up["virtual_ticket"], up_virtual_ticket.to_string());
    assert_eq!(down["liquidity"], (50 * SCALE).to_string());
    assert_eq!(json["points"].as_array().unwrap().len(), 36);
}

#[tokio::test]
async fn market_curve_accepts_selected_round_start_at() {
    let app = build_router(
        AppState::new(
            InMemoryProjectionStore::default(),
            MemoryEventBus::default(),
        )
        .with_auth_config(None),
    );
    let json = get_json(app, "/markets/1/curve?start_at=1778504700").await;

    assert_eq!(json["market_id"], "1");
    assert_eq!(json["round_id"], "5928349");
}

#[tokio::test]
async fn market_curve_counts_cash_buy_volume_by_market_round_and_side() {
    let store = InMemoryProjectionStore::default();
    let round_id = 5_928_349;
    record_cash_trade(&store, 1, round_id, "UP", 10 * SCALE).await;
    record_cash_trade(&store, 2, round_id, "UP", 20 * SCALE).await;
    record_cash_trade(&store, 1, round_id, "DOWN", 3 * SCALE).await;
    let app = build_router(AppState::new(store, MemoryEventBus::default()).with_auth_config(None));

    let btc = get_json(app.clone(), "/markets/1/curve?start_at=1778504700").await;
    let eth = get_json(app, "/markets/2/curve?start_at=1778504700").await;
    let btc_sides = btc["sides"].as_array().unwrap();
    let eth_sides = eth["sides"].as_array().unwrap();
    let btc_up = btc_sides.iter().find(|side| side["side"] == "UP").unwrap();
    let btc_down = btc_sides
        .iter()
        .find(|side| side["side"] == "DOWN")
        .unwrap();
    let eth_up = eth_sides.iter().find(|side| side["side"] == "UP").unwrap();

    assert_eq!(btc["round_id"], round_id.to_string());
    assert_eq!(btc_up["liquidity"], (10 * SCALE).to_string());
    assert_eq!(btc_down["liquidity"], (3 * SCALE).to_string());
    assert_eq!(eth_up["liquidity"], (20 * SCALE).to_string());
}

#[tokio::test]
async fn market_rounds_returns_same_asset_time_history() {
    let response = seeded_app()
        .await
        .oneshot(
            Request::builder()
                .uri("/markets/1/rounds?limit=6")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let rounds = json["rounds"].as_array().unwrap();

    assert_eq!(json["market_id"], "1");
    assert_eq!(json["duration_seconds"], 300);
    assert_eq!(rounds.len(), 6);
    assert!(rounds.iter().all(|round| round["asset"] == "BTC"));
    assert_eq!(rounds.last().unwrap()["status"], "open");

    for pair in rounds.windows(2) {
        let prev = pair[0]["start_at"].as_i64().unwrap();
        let next = pair[1]["start_at"].as_i64().unwrap();
        assert_eq!(next - prev, 300);
    }
}
