use axum::http::StatusCode;
use basingamarket_db::{
    CashBalanceRow, CashTradeReservationRow, CashTradeRow, InMemoryProjectionStore,
    ProjectionEngine,
};
use basingamarket_protocol_events::ProtocolEvent;
use http_body_util::BodyExt;
use tower::ServiceExt;

use super::*;

const WALLET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const OTHER: &str = "So11111111111111111111111111111111111111112";

fn closed_header(round_id: u64, close_price: u128) -> MarketPriceHeaderResponse {
    let start_at = (round_id * 300) as i64;
    MarketPriceHeaderResponse {
        asset: "BTC".to_owned(),
        asset_image_url: "/visuals/crypto/btc.svg".to_owned(),
        duration_seconds: 300,
        settlement_source: "Binance Spot BTCUSDT 5m".to_owned(),
        symbol: "BTCUSDT".to_owned(),
        round_id: round_id.to_string(),
        start_at,
        end_at: start_at + 300,
        open_price: Some("100000000".to_owned()),
        current_price: None,
        close_price: Some(close_price.to_string()),
        price_display_state: "closed",
        fetched_at: "2026-05-10T00:00:00Z".to_owned(),
    }
}

async fn state_with_price(round_id: u64, close_price: u128) -> AppState {
    let state = AppState::new(
        InMemoryProjectionStore::default(),
        MemoryEventBus::default(),
    )
    .with_auth_config(None)
    .with_price_provider(MarketPriceProvider::static_prices(HashMap::from([(
        1,
        closed_header(round_id, close_price),
    )])));
    ProjectionEngine::new(state.store.clone())
        .apply_raw_event(
            EventMeta::fixture(1, 0),
            ProtocolEvent::MarketCreated {
                market_id: 1,
                question_hash: "BTC 5m".to_owned(),
                outcome_count: 2,
                open_at: 0,
                trade_until: 100,
            },
        )
        .await
        .unwrap();
    state
}

async fn cash_ticket(state: &AppState, wallet: &str, lot_id: u64, round_id: u64, side: &str) {
    let now = chrono::Utc::now();
    let amount = 20_000_000;
    state
        .store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: wallet.to_owned(),
            cash_balance: amount,
            updated_at: now,
        })
        .await;
    let trade_id = format!("trade-{lot_id}");
    state
        .store
        .reserve_cash_trade(CashTradeReservationRow {
            trade_id: trade_id.clone(),
            wallet_address: wallet.to_owned(),
            amount,
            released: false,
            completed_signature: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();
    state
        .store
        .record_cash_trade(CashTradeRow {
            trade_id,
            wallet_address: wallet.to_owned(),
            signature: format!("cash-buy-{lot_id}"),
            mint: WALLET.to_owned(),
            vault_token_account: WALLET.to_owned(),
            market_id: 1,
            round_id,
            position_lot: format!("lot-{lot_id}"),
            lot_id,
            side: side.to_owned(),
            usdc_in: amount,
            fee_usdc: 0,
            net_usdc: amount,
            tickets_out: amount,
            created_at: now,
        })
        .await
        .unwrap();
}

async fn original_call_ticket(state: &AppState, ticket_id: u64, round_id: u64) {
    let engine = ProjectionEngine::new(state.store.clone());
    engine
        .apply_raw_event(
            EventMeta::fixture(2, 0),
            ProtocolEvent::TicketMinted {
                ticket_id,
                market_id: 1,
                round_id,
                stake_amount: 20_000_000,
                reward_shares: 20_000_000,
                owner: WALLET.to_owned(),
                outcome_id: 0,
                entry_odds: 1_000_000,
                confidence: 90,
                mood: 1,
            },
        )
        .await
        .unwrap();
    engine
        .apply_raw_event(
            EventMeta::fixture(3, 0),
            ProtocolEvent::TicketSold {
                ticket_id,
                from: WALLET.to_owned(),
                to: OTHER.to_owned(),
                price: 20_000_000,
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn ticket_query_settles_only_selected_round_with_realized_pnl() {
    let round_id = 5_666_667;
    let state = state_with_price(round_id, 200_000_000).await;
    cash_ticket(&state, WALLET, 100, round_id, "UP").await;
    cash_ticket(&state, OTHER, 101, round_id, "DOWN").await;
    cash_ticket(&state, WALLET, 102, round_id + 1, "UP").await;
    let app = build_router(state.clone());

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/markets/1/tickets?round_id={round_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json[0]["status"], "won");
    assert_eq!(json[0]["settlement_value_usdc"], "40000000");
    assert_eq!(json[0]["realized_pnl_usdc"], "20000000");
    assert_eq!(json[1]["status"], "lost");
    assert_eq!(json[1]["realized_pnl_usdc"], "-20000000");
    assert_eq!(
        state.store.get_ticket(102).await.unwrap().status,
        TicketStatus::Active
    );
}

#[tokio::test]
async fn profile_tickets_filter_wallet_and_settle_related_rounds() {
    let round_id = 5_666_670;
    let state = state_with_price(round_id, 200_000_000).await;
    cash_ticket(&state, WALLET, 300, round_id, "UP").await;
    cash_ticket(&state, OTHER, 301, round_id, "DOWN").await;
    original_call_ticket(&state, 302, round_id).await;
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{WALLET}/tickets"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let tickets = json.as_array().unwrap();
    let ids: Vec<_> = tickets
        .iter()
        .map(|ticket| ticket["ticket_id"].as_str().unwrap())
        .collect();

    assert!(ids.contains(&"300"));
    assert!(ids.contains(&"302"));
    assert!(!ids.contains(&"301"));
    assert_eq!(
        tickets
            .iter()
            .find(|ticket| ticket["ticket_id"] == "300")
            .unwrap()["status"],
        "won"
    );
    assert_eq!(
        tickets
            .iter()
            .find(|ticket| ticket["ticket_id"] == "302")
            .unwrap()["current_owner"],
        OTHER
    );
}

#[tokio::test]
async fn ticket_query_marks_low_liquidity_round_refundable() {
    let round_id = 5_666_668;
    let state = state_with_price(round_id, 200_000_000).await;
    cash_ticket(&state, WALLET, 200, round_id, "UP").await;
    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/markets/1/tickets?round_id={round_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json[0]["status"], "refundable");
    assert_eq!(json[0]["settlement_value_usdc"], "20000000");
    assert_eq!(json[0]["realized_pnl_usdc"], "0");
}
