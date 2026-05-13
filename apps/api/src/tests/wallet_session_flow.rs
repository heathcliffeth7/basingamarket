use super::*;
use basingamarket_chain::encode_base58_bytes;
use chrono::{Duration, Utc};
use ed25519_dalek::{Signer, SigningKey as Ed25519SigningKey};

fn wallet_fixture(seed: u8) -> (String, Ed25519SigningKey) {
    let signing_key = Ed25519SigningKey::from_bytes(&[seed; 32]);
    let wallet = encode_base58_bytes(signing_key.verifying_key().as_bytes());
    (wallet, signing_key)
}

#[tokio::test]
async fn wallet_challenge_and_session_verify_solana_signature_and_reject_replay() {
    let (wallet, signing_key) = wallet_fixture(7);
    let app = build_router(app_state().with_auth_config(Some(test_auth_config())));
    let auth_header = format!("Bearer {}", valid_privy_token());

    let challenge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/auth/wallet-challenges")
                .header(header::AUTHORIZATION, &auth_header)
                .header("content-type", "application/json")
                .body(Body::from(json!({ "wallet_address": wallet }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(challenge_response.status(), StatusCode::OK);
    let body = challenge_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let challenge: Value = serde_json::from_slice(&body).unwrap();
    let message = challenge["message"].as_str().unwrap();
    let challenge_id = challenge["challenge_id"].as_str().unwrap();
    assert!(message.contains(&wallet));
    assert!(message.contains("did:privy:user-1"));
    assert!(message.contains("session-1"));
    assert!(message.contains("Cluster: devnet"));

    let signature = signing_key.sign(message.as_bytes());
    let signature = encode_base58_bytes(&signature.to_bytes());
    let session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/auth/wallet-sessions")
                .header(header::AUTHORIZATION, &auth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "challenge_id": challenge_id,
                        "wallet_address": wallet,
                        "signature": signature
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session_response.status(), StatusCode::OK);
    let body = session_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let session: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(session["wallet_address"], wallet);
    assert!(session["wallet_session_token"].as_str().unwrap().len() > 40);

    let replay_response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/auth/wallet-sessions")
                .header(header::AUTHORIZATION, &auth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "challenge_id": challenge_id,
                        "wallet_address": wallet,
                        "signature": signature
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = replay_response.status();
    let body = replay_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let replay: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(replay["code"], "wallet_session_invalid");
}

#[tokio::test]
async fn wallet_session_rejects_wrong_wallet_signature() {
    let (wallet, _) = wallet_fixture(8);
    let (_, wrong_signing_key) = wallet_fixture(9);
    let app = build_router(app_state().with_auth_config(Some(test_auth_config())));
    let auth_header = format!("Bearer {}", valid_privy_token());
    let challenge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
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
    let signature = wrong_signing_key.sign(challenge["message"].as_str().unwrap().as_bytes());
    let signature = encode_base58_bytes(&signature.to_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
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
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["code"], "wallet_session_invalid");
}

#[tokio::test]
async fn wallet_session_rejects_expired_challenge() {
    let (wallet, signing_key) = wallet_fixture(10);
    let state = app_state().with_auth_config(Some(test_auth_config()));
    let message = "expired wallet session challenge";
    let challenge_id = "expired-challenge";
    wallet_sessions::insert_wallet_challenge_for_test(
        &state,
        &wallet,
        "did:privy:user-1",
        "session-1",
        challenge_id,
        message,
        Utc::now() - Duration::seconds(1),
    )
    .await;
    let app = build_router(state);
    let signature = signing_key.sign(message.as_bytes());
    let signature = encode_base58_bytes(&signature.to_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/auth/wallet-sessions")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "challenge_id": challenge_id,
                        "wallet_address": wallet,
                        "signature": signature
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

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["code"], "wallet_session_expired");
}

#[tokio::test]
async fn protected_mutation_rejects_expired_wallet_session() {
    let state = app_state()
        .with_auth_config(Some(test_auth_config()))
        .with_busdc_reserve_backer(BusdcReserveBacker::MockSuccess);
    let app = build_router(state);
    let expired_token = wallet_sessions::wallet_session_token_for_test_with_expiry(
        TEST_SOLANA_PUBKEY,
        Utc::now() - Duration::seconds(1),
    );

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/profiles/{TEST_SOLANA_PUBKEY}/busdc-mints"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", valid_privy_token()),
                )
                .header("x-bm-wallet-session", expired_token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["code"], "wallet_session_expired");
}
