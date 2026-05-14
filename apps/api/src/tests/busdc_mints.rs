use super::*;

fn identity_token(wallet_address: &str) -> String {
    valid_privy_identity_token(wallet_address)
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
async fn busdc_mint_requires_wallet_ownership_config_when_no_identity_token_or_legacy_session() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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
    assert_eq!(json["code"], "wallet_session_unconfigured");
}

#[tokio::test]
async fn busdc_mint_accepts_privy_user_lookup_without_identity_token() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_privy_user_lookup(Some(
            privy_lookup_client(privy_user_with_solana_wallet(
                "did:privy:user-1",
                TEST_SOLANA_PUBKEY,
            ))
            .await,
        ))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "credited");
}

#[tokio::test]
async fn busdc_mint_rejects_privy_user_lookup_wallet_mismatch() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_privy_user_lookup(Some(
            privy_lookup_client(privy_user_with_solana_wallet(
                "did:privy:user-1",
                "So11111111111111111111111111111111111111112",
            ))
            .await,
        ))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["code"], "wallet_session_wallet_mismatch");
}

#[tokio::test]
async fn busdc_mint_rejects_privy_user_lookup_non_solana_wallet() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_privy_user_lookup(Some(
            privy_lookup_client(privy_user_response(
                "did:privy:user-1",
                json!([
                    {
                        "type": "wallet",
                        "address": TEST_SOLANA_PUBKEY,
                        "chain_type": "ethereum"
                    }
                ]),
            ))
            .await,
        ))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["code"], "wallet_session_wallet_mismatch");
}

#[tokio::test]
async fn busdc_mint_rejects_privy_user_lookup_wrong_user() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_privy_user_lookup(Some(
            privy_lookup_client(privy_user_with_solana_wallet(
                "did:privy:other",
                TEST_SOLANA_PUBKEY,
            ))
            .await,
        ))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["code"], "wallet_session_invalid");
}

#[tokio::test]
async fn busdc_mint_rejects_identity_token_for_other_wallet() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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
                .header(
                    "x-bm-identity-token",
                    identity_token("So11111111111111111111111111111111111111112"),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json["code"], "wallet_session_wallet_mismatch");
}

#[tokio::test]
async fn busdc_mint_rejects_identity_token_for_other_privy_user() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
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
                .header(
                    "x-bm-identity-token",
                    valid_privy_identity_token_for_user(TEST_SOLANA_PUBKEY, "did:privy:other"),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["code"], "wallet_session_invalid");
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
                .header("x-bm-identity-token", identity_token(TEST_SOLANA_PUBKEY))
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
                .header("x-bm-identity-token", identity_token(TEST_SOLANA_PUBKEY))
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
                    .header("x-bm-identity-token", identity_token(TEST_SOLANA_PUBKEY))
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
                .header("x-bm-identity-token", identity_token(TEST_SOLANA_PUBKEY))
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
