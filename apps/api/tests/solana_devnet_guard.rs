use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use basingamarket_api::{build_router, AppState};
use basingamarket_auth::{PrivyAccessTokenClaims, PrivyAuthConfig};
use basingamarket_chain::{decode_solana_pubkey, encode_base58_bytes, SolanaDevnetConfig};
use basingamarket_db::{CashBalanceRow, InMemoryProjectionStore};
use basingamarket_domain::crypto_rounds::current_round_id;
use basingamarket_realtime::MemoryEventBus;
use ed25519_dalek::{Signer, SigningKey as Ed25519SigningKey};
use http_body_util::BodyExt;
use jsonwebtoken::{encode, get_current_timestamp, Algorithm, EncodingKey, Header};
use p256::{
    ecdsa::SigningKey,
    elliptic_curve::rand_core::OsRng,
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

const TEST_SOLANA_PUBKEY: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TEST_PROGRAM_ID: &str = "3oAve8qsR5oVtqUcsXtSELBVz5CnJifj4UCvM6AiHa2r";
const TEST_APP_ID: &str = "test-privy-app";

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

fn wallet_fixture(seed: u8) -> (String, Ed25519SigningKey) {
    let signing_key = Ed25519SigningKey::from_bytes(&[seed; 32]);
    let wallet = encode_base58_bytes(signing_key.verifying_key().as_bytes());
    (wallet, signing_key)
}

async fn wallet_session_token(
    app: &Router,
    wallet: &str,
    signing_key: &Ed25519SigningKey,
) -> String {
    std::env::set_var(
        "BM_WALLET_SESSION_SECRET",
        "test-wallet-session-secret-at-least-32-bytes",
    );
    let auth_header = format!("Bearer {}", valid_privy_token());
    let challenge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/wallet-challenges")
                .header(header::AUTHORIZATION, &auth_header)
                .header("content-type", "application/json")
                .body(Body::from(json!({ "wallet_address": wallet }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = challenge_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let challenge: Value = serde_json::from_slice(&body).unwrap();
    let signature = signing_key.sign(challenge["message"].as_str().unwrap().as_bytes());
    let signature = encode_base58_bytes(&signature.to_bytes());
    let session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/wallet-sessions")
                .header(header::AUTHORIZATION, &auth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "challenge_id": challenge["challenge_id"],
                        "wallet_address": wallet,
                        "signature": signature
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = session_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let session: Value = serde_json::from_slice(&body).unwrap();
    session["wallet_session_token"].as_str().unwrap().to_owned()
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

fn ready_cash_chain_config_with_rpc(rpc_url: String) -> SolanaDevnetConfig {
    SolanaDevnetConfig::from_all_values(
        None,
        Some(rpc_url),
        None,
        None,
        Some(2_000),
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

fn ready_cash_chain_config_with_program_rpc(rpc_url: String) -> SolanaDevnetConfig {
    SolanaDevnetConfig::from_all_values(
        None,
        Some(rpc_url),
        None,
        Some(TEST_PROGRAM_ID.to_owned()),
        Some(2_000),
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

async fn spawn_rpc_once(body: Value) -> String {
    spawn_rpc_sequence(vec![body]).await
}

async fn spawn_rpc_sequence(bodies: Vec<Value>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        for body in bodies {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer).await.unwrap();
            let body = body.to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    format!("http://{addr}")
}

fn encoded_global_config_account() -> String {
    let mut bytes = vec![0_u8; 160];
    let mint = decode_solana_pubkey(TEST_SOLANA_PUBKEY, "test_mint").unwrap();
    bytes[72..104].copy_from_slice(&mint);
    bytes[136..138].copy_from_slice(&0_u16.to_le_bytes());
    BASE64.encode(bytes)
}

fn encoded_round_account(start_at: i64, batch_until: i64, end_at: i64) -> String {
    let mut bytes = vec![0_u8; 224];
    bytes[48..56].copy_from_slice(&start_at.to_le_bytes());
    bytes[56..64].copy_from_slice(&batch_until.to_le_bytes());
    bytes[64..72].copy_from_slice(&end_at.to_le_bytes());
    bytes[88] = 0;
    bytes[90..98].copy_from_slice(&50_000_000_000_u64.to_le_bytes());
    bytes[98..106].copy_from_slice(&100_000_000_000_u64.to_le_bytes());
    bytes[122..130].copy_from_slice(&50_000_000_000_u64.to_le_bytes());
    bytes[130..138].copy_from_slice(&100_000_000_000_u64.to_le_bytes());
    BASE64.encode(bytes)
}

fn rpc_account_data(encoded: String) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "context": { "slot": 1 },
            "value": {
                "data": [encoded, "base64"]
            }
        }
    })
}

fn rpc_existing_account() -> Value {
    rpc_account_data(BASE64.encode([0_u8]))
}

fn rpc_missing_account() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "context": { "slot": 1 },
            "value": null
        }
    })
}

async fn post_buy_intent(rpc_url: String) -> (StatusCode, Value) {
    let state = app_state().with_chain_config(ready_cash_chain_config_with_program_rpc(rpc_url));
    post_buy_intent_on_state(&state, current_5m_round_id()).await
}

async fn post_buy_intent_on_state(state: &AppState, round_id: u64) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rounds/{round_id}/buy-intent"))
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
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    (status, json)
}

async fn get_bootstrap_requests(state: &AppState) -> Value {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/_devnet/round-bootstrap-requests")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

async fn delete_bootstrap_request(state: &AppState, market_id: u64, round_id: u64) -> StatusCode {
    build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!(
                    "/_devnet/round-bootstrap-requests/{market_id}/{round_id}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

fn current_5m_round_id() -> u64 {
    current_round_id(chrono::Utc::now().timestamp(), 300).unwrap()
}

#[tokio::test]
async fn chain_status_reports_solana_devnet_readiness_shape() {
    let chain_config = SolanaDevnetConfig {
        rpc_url: "http://127.0.0.1:9".to_owned(),
        request_timeout_ms: 1,
        ..Default::default()
    };
    let state = app_state().with_chain_config(chain_config);
    let response = build_router(state)
        .oneshot(
            Request::builder()
                .uri("/chain/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["cluster"], "devnet");
    assert_eq!(json["rpc_url"], "http://127.0.0.1:9");
    assert_eq!(json["program_status"], "projection_pending");
}

#[tokio::test]
async fn deposit_config_reports_pending_when_cash_env_is_missing() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .uri("/deposit/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["cluster"], "devnet");
    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["decimals"], 6);
    assert_eq!(json["status"], "projection_pending");
    assert!(json["mint"].is_null());
}

#[tokio::test]
async fn buy_intent_route_is_registered() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rounds/5928300/buy-intent")
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
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_ne!(status, StatusCode::NOT_FOUND);
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "program_not_configured");
}

#[tokio::test]
async fn cash_buy_route_is_registered_and_requires_auth() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rounds/5928300/cash-buy")
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
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_ne!(status, StatusCode::NOT_FOUND);
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "auth_not_configured");
}

#[tokio::test]
async fn buy_intent_missing_program_account_returns_json_404() {
    let rpc_url = spawn_rpc_sequence(vec![rpc_missing_account()]).await;
    let state = app_state().with_chain_config(ready_cash_chain_config_with_program_rpc(rpc_url));
    let (status, json) = post_buy_intent_on_state(&state, current_5m_round_id()).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "program_not_deployed");
    assert_eq!(
        get_bootstrap_requests(&state)
            .await
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[tokio::test]
async fn buy_intent_missing_global_account_returns_json_404() {
    let rpc_url = spawn_rpc_sequence(vec![rpc_existing_account(), rpc_missing_account()]).await;
    let (status, json) = post_buy_intent(rpc_url).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "global_config_not_initialized");
}

#[tokio::test]
async fn buy_intent_missing_market_account_returns_json_404() {
    let rpc_url = spawn_rpc_sequence(vec![
        rpc_existing_account(),
        rpc_account_data(encoded_global_config_account()),
        rpc_missing_account(),
    ])
    .await;
    let (status, json) = post_buy_intent(rpc_url).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "market_not_initialized");
}

#[tokio::test]
async fn buy_intent_missing_devnet_round_account_returns_json_404() {
    let round_id = current_5m_round_id();
    let rpc_url = spawn_rpc_sequence(vec![
        rpc_existing_account(),
        rpc_account_data(encoded_global_config_account()),
        rpc_existing_account(),
        rpc_missing_account(),
    ])
    .await;
    let state = app_state().with_chain_config(ready_cash_chain_config_with_program_rpc(rpc_url));
    let (status, json) = post_buy_intent_on_state(&state, round_id).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "round_not_initialized");
    let requests = get_bootstrap_requests(&state).await;
    assert_eq!(requests.as_array().unwrap().len(), 1);
    assert_eq!(requests[0]["market_id"], "1");
    assert_eq!(requests[0]["round_id"], round_id.to_string());
    assert_eq!(requests[0]["asset"], "BTC");
    assert_eq!(requests[0]["duration_seconds"], 300);
    assert_eq!(requests[0]["interval"], "5m");
}

#[tokio::test]
async fn devnet_round_bootstrap_request_delete_clears_pending_request() {
    let round_id = current_5m_round_id();
    let rpc_url = spawn_rpc_sequence(vec![
        rpc_existing_account(),
        rpc_account_data(encoded_global_config_account()),
        rpc_existing_account(),
        rpc_missing_account(),
    ])
    .await;
    let state = app_state().with_chain_config(ready_cash_chain_config_with_program_rpc(rpc_url));
    let (status, _) = post_buy_intent_on_state(&state, round_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    assert_eq!(
        delete_bootstrap_request(&state, 1, round_id).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        get_bootstrap_requests(&state)
            .await
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[tokio::test]
async fn buy_intent_opening_batch_active_returns_json_400() {
    let now = chrono::Utc::now().timestamp();
    let rpc_url = spawn_rpc_sequence(vec![
        rpc_existing_account(),
        rpc_account_data(encoded_global_config_account()),
        rpc_existing_account(),
        rpc_account_data(encoded_round_account(now - 5, now + 60, now + 300)),
    ])
    .await;
    let (status, json) = post_buy_intent(rpc_url).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["code"], "opening_batch_active");
}

#[tokio::test]
async fn buy_intent_returns_quote_after_batch() {
    let now = chrono::Utc::now().timestamp();
    let rpc_url = spawn_rpc_sequence(vec![
        rpc_existing_account(),
        rpc_account_data(encoded_global_config_account()),
        rpc_existing_account(),
        rpc_account_data(encoded_round_account(now - 10, now - 1, now + 300)),
    ])
    .await;
    let (status, json) = post_buy_intent(rpc_url).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["cluster"], "devnet");
    assert_eq!(json["quote"]["side"], "UP");
    assert_eq!(json["quote"]["usdc_in"], "1000000");
    assert_eq!(json["quote"]["fee_usdc"], "0");
    assert!(json["quote"]["tickets_out"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|value| value > 0));
    let fresh_price_after = json["quote"]["fresh_price_after"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap();
    let fresh_price_before = json["quote"]["fresh_price_before"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap();
    assert!(fresh_price_after > fresh_price_before);
    assert_eq!(
        json["instruction"]["accounts"].as_array().unwrap().len(),
        10
    );
}

#[tokio::test]
async fn deposit_config_reports_ready_when_cash_env_is_complete() {
    let response = build_router(app_state().with_chain_config(ready_cash_chain_config()))
        .oneshot(
            Request::builder()
                .uri("/deposit/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["cluster"], "devnet");
    assert_eq!(json["currency"], "BUSDC");
    assert_eq!(json["decimals"], 6);
    assert_eq!(json["mint"], TEST_SOLANA_PUBKEY);
    assert_eq!(
        json["vault_owner"],
        "So11111111111111111111111111111111111111112"
    );
    assert_eq!(json["status"], "ready");
    assert!(json["vault_token_account"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn deposit_liquidity_reports_pending_when_cash_env_is_missing() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .uri("/deposit/liquidity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["status"], "projection_pending");
    assert_eq!(json["vault_cash_balance"], "0");
    assert_eq!(json["available_cash_reserve"], "0");
}

#[tokio::test]
async fn deposit_liquidity_treats_missing_vault_account_as_zero_reserve() {
    let rpc_url = spawn_rpc_once(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "error": {
            "code": -32602,
            "message": "Invalid param: could not find account"
        }
    }))
    .await;
    let response =
        build_router(app_state().with_chain_config(ready_cash_chain_config_with_rpc(rpc_url)))
            .oneshot(
                Request::builder()
                    .uri("/deposit/liquidity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["status"], "liquidity_pending");
    assert_eq!(json["vault_cash_balance"], "0");
    assert_eq!(json["total_cash_liabilities"], "0");
    assert_eq!(json["available_cash_reserve"], "0");
}

#[tokio::test]
async fn deposit_liquidity_reports_available_reserve_over_cash_liabilities() {
    let rpc_url = spawn_rpc_once(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "context": { "slot": 1 },
            "value": {
                "amount": "2500000",
                "decimals": 6,
                "uiAmount": 2.5,
                "uiAmountString": "2.5"
            }
        }
    }))
    .await;
    let state = app_state().with_chain_config(ready_cash_chain_config_with_rpc(rpc_url));
    state
        .store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_SOLANA_PUBKEY.to_owned(),
            cash_balance: 1_000_000,
            updated_at: chrono::Utc::now(),
        })
        .await;

    let response = build_router(state)
        .oneshot(
            Request::builder()
                .uri("/deposit/liquidity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["status"], "ready");
    assert_eq!(json["vault_cash_balance"], "2500000");
    assert_eq!(json["total_cash_liabilities"], "1000000");
    assert_eq!(json["available_cash_reserve"], "1500000");
}

#[tokio::test]
async fn sol_deposit_quote_reports_pending_when_sol_config_is_missing() {
    let (wallet, signing_key) = wallet_fixture(7);
    let app = build_router(
        app_state()
            .with_auth_config(Some(test_auth_config()))
            .with_chain_config(ready_cash_chain_config()),
    );
    let wallet_session = wallet_session_token(&app, &wallet, &signing_key).await;
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/profiles/{wallet}/sol-deposit-quote?cash_amount=1000000"
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .header("x-bm-wallet-session", wallet_session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], wallet);
    assert_eq!(json["cash_amount"], "1000000");
    assert_eq!(json["status"], "projection_pending");
    assert!(json["quote_id"].is_null());
}

#[tokio::test]
async fn transfer_deposit_quote_reports_pending_when_cash_config_is_missing() {
    let (wallet, signing_key) = wallet_fixture(8);
    let app = build_router(app_state().with_auth_config(Some(test_auth_config())));
    let wallet_session = wallet_session_token(&app, &wallet, &signing_key).await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/profiles/{wallet}/transfer-deposit-quotes"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .header("x-bm-wallet-session", wallet_session)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"asset":"USDC","cash_amount":"1000000"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], wallet);
    assert_eq!(json["asset"], "BUSDC");
    assert_eq!(json["status"], "projection_pending");
    assert!(json["quote_id"].is_null());
}

#[tokio::test]
async fn transfer_deposit_quote_returns_reference_for_ready_usdc_config() {
    let (wallet, signing_key) = wallet_fixture(9);
    let app = build_router(
        app_state()
            .with_auth_config(Some(test_auth_config()))
            .with_chain_config(ready_cash_chain_config()),
    );
    let wallet_session = wallet_session_token(&app, &wallet, &signing_key).await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/profiles/{wallet}/transfer-deposit-quotes"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .header("x-bm-wallet-session", wallet_session)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"asset":"BUSDC","cash_amount":"1000000"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], wallet);
    assert_eq!(json["asset"], "BUSDC");
    assert_eq!(json["cash_amount"], "1000000");
    assert_eq!(json["transfer_amount"], "1000000");
    assert_eq!(json["status"], "ready");
    assert!(json["reference"]
        .as_str()
        .is_some_and(|value| value.starts_with("bm:")));
    assert!(json["destination"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn profile_route_preserves_solana_pubkey_casing() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["wallet_address"], TEST_SOLANA_PUBKEY);
}

#[tokio::test]
async fn zero_x_profile_addresses_are_rejected() {
    let app = build_router(app_state());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/profiles/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/profiles/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cash")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["code"], "invalid_address");
}

#[tokio::test]
async fn profile_cash_preserves_pubkey_and_usdc_base_units() {
    let state = app_state();
    state
        .store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_SOLANA_PUBKEY.to_owned(),
            cash_balance: 8_490_000,
            updated_at: chrono::Utc::now(),
        })
        .await;
    let response = build_router(state)
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
async fn profile_cash_returns_zero_when_ready_config_has_no_row() {
    let response = build_router(app_state().with_chain_config(ready_cash_chain_config()))
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
async fn deposit_route_rejects_zero_x_addresses_before_rpc_lookup() {
    let response = build_router(app_state())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/profiles/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/deposits")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"signature":"5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
