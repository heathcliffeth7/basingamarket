use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderMap, HeaderName},
    Json,
};
use basingamarket_auth::{has_linked_solana_wallet, normalize_solana_pubkey, AuthError};
use basingamarket_chain::verify_solana_message_signature;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{
    decode, encode, errors::ErrorKind, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{privy_users::PrivyUserLookupError, require_privy_session, ApiError, AppState};

const APP_NAME: &str = "BasingaMarket";
const WALLET_SESSION_ISSUER: &str = "basingamarket-api";
const WALLET_SESSION_AUDIENCE: &str = "basingamarket-wallet-session";
const WALLET_SESSION_SECRET_ENV: &str = "BM_WALLET_SESSION_SECRET";
const CHALLENGE_TTL_SECONDS: i64 = 5 * 60;
const WALLET_SESSION_TTL_SECONDS: i64 = 30 * 60;
const WALLET_SESSION_HEADER: HeaderName = HeaderName::from_static("x-bm-wallet-session");
const IDENTITY_TOKEN_HEADER: HeaderName = HeaderName::from_static("x-bm-identity-token");

#[derive(Debug, Clone, Default)]
pub(crate) struct WalletChallengeStore {
    challenges: Arc<RwLock<BTreeMap<String, WalletChallenge>>>,
}

#[derive(Debug, Clone)]
struct WalletChallenge {
    challenge_id: String,
    wallet_address: String,
    user_id: String,
    session_id: String,
    message: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WalletChallengeRequest {
    wallet_address: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WalletChallengeResponse {
    challenge_id: String,
    wallet_address: String,
    message: String,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WalletSessionRequest {
    challenge_id: String,
    wallet_address: String,
    signature: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WalletSessionResponse {
    wallet_session_token: String,
    wallet_address: String,
    expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WalletSessionClaims {
    iss: String,
    aud: String,
    sub: String,
    sid: String,
    wallet_address: String,
    challenge_id: String,
    iat: u64,
    exp: u64,
}

pub(crate) async fn create_wallet_challenge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletChallengeRequest>,
) -> Result<Json<WalletChallengeResponse>, ApiError> {
    let claims = require_privy_session(&state, &headers)?;
    let wallet_address = normalize_solana_pubkey(&payload.wallet_address)
        .map_err(|_| ApiError::bad_request("invalid_wallet", "Wallet address gecersiz."))?;
    let issued_at = Utc::now();
    let expires_at = issued_at + Duration::seconds(CHALLENGE_TTL_SECONDS);
    let challenge_id = Uuid::new_v4().to_string();
    let nonce = Uuid::new_v4().to_string();
    let message = wallet_challenge_message(WalletChallengeMessageInput {
        wallet_address: &wallet_address,
        user_id: &claims.user_id,
        session_id: &claims.session_id,
        challenge_id: &challenge_id,
        nonce: &nonce,
        issued_at,
        expires_at,
    });
    let challenge = WalletChallenge {
        challenge_id: challenge_id.clone(),
        wallet_address: wallet_address.clone(),
        user_id: claims.user_id,
        session_id: claims.session_id,
        message: message.clone(),
        expires_at,
    };
    state.wallet_challenges.insert(challenge).await;

    Ok(Json(WalletChallengeResponse {
        challenge_id,
        wallet_address,
        message,
        expires_at: expires_at.to_rfc3339(),
    }))
}

pub(crate) async fn create_wallet_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletSessionRequest>,
) -> Result<Json<WalletSessionResponse>, ApiError> {
    let claims = require_privy_session(&state, &headers)?;
    let wallet_address = normalize_solana_pubkey(&payload.wallet_address)
        .map_err(|_| ApiError::bad_request("invalid_wallet", "Wallet address gecersiz."))?;
    let challenge_id = payload.challenge_id.trim();
    if challenge_id.is_empty() {
        return Err(wallet_session_invalid());
    }
    let challenge = state
        .wallet_challenges
        .take(challenge_id)
        .await
        .ok_or_else(wallet_session_invalid)?;
    if challenge.expires_at <= Utc::now() {
        return Err(wallet_session_expired());
    }
    if challenge.wallet_address != wallet_address
        || challenge.user_id != claims.user_id
        || challenge.session_id != claims.session_id
    {
        return Err(wallet_session_wallet_mismatch());
    }
    verify_solana_message_signature(
        &wallet_address,
        challenge.message.as_bytes(),
        &payload.signature,
    )
    .map_err(|_| wallet_session_invalid())?;

    let issued_at = Utc::now();
    let expires_at = issued_at + Duration::seconds(WALLET_SESSION_TTL_SECONDS);
    let wallet_session_token = encode_wallet_session_token(WalletSessionTokenInput {
        wallet_address: &wallet_address,
        user_id: &claims.user_id,
        session_id: &claims.session_id,
        challenge_id: &challenge.challenge_id,
        issued_at,
        expires_at,
    })?;

    Ok(Json(WalletSessionResponse {
        wallet_session_token,
        wallet_address,
        expires_at: expires_at.to_rfc3339(),
    }))
}

pub(crate) async fn require_wallet_owner(
    state: &AppState,
    headers: &HeaderMap,
    expected_wallet: &str,
) -> Result<(), ApiError> {
    let claims = require_privy_session(state, headers)?;
    if let Some(identity_token) = identity_token_header(headers) {
        let auth = state
            .auth
            .as_ref()
            .ok_or_else(ApiError::auth_not_configured)?;
        let identity_claims = auth
            .verify_identity_token(identity_token)
            .map_err(|error| match error {
                AuthError::MissingAuthConfig | AuthError::InvalidVerificationKey => {
                    ApiError::auth_not_configured()
                }
                _ => wallet_session_invalid(),
            })?;
        if identity_claims.user_id != claims.user_id {
            return Err(wallet_session_invalid());
        }
        if !identity_claims.has_linked_solana_wallet(expected_wallet) {
            return Err(wallet_session_wallet_mismatch());
        }
        return Ok(());
    }

    if let Some(privy_users) = &state.privy_users {
        let linked_accounts = privy_users
            .linked_accounts_for_user(&claims.user_id)
            .await
            .map_err(privy_user_lookup_error)?;
        if !has_linked_solana_wallet(&linked_accounts, expected_wallet) {
            return Err(wallet_session_wallet_mismatch());
        }
        return Ok(());
    }

    let session_token =
        optional_wallet_session_header(headers).ok_or_else(wallet_session_unconfigured)?;
    let wallet_claims = decode_wallet_session_token(session_token)?;
    if wallet_claims.sub != claims.user_id || wallet_claims.sid != claims.session_id {
        return Err(wallet_session_invalid());
    }
    if wallet_claims.wallet_address != expected_wallet {
        return Err(wallet_session_wallet_mismatch());
    }
    Ok(())
}

fn privy_user_lookup_error(error: PrivyUserLookupError) -> ApiError {
    if error.is_not_found() {
        return wallet_session_invalid();
    }
    if error.is_config_error() {
        return wallet_session_unconfigured();
    }
    match error {
        PrivyUserLookupError::UserMismatch
        | PrivyUserLookupError::InvalidLinkedAccounts(AuthError::InvalidToken) => {
            wallet_session_invalid()
        }
        PrivyUserLookupError::InvalidLinkedAccounts(
            AuthError::MissingAuthConfig | AuthError::InvalidVerificationKey,
        ) => wallet_session_unconfigured(),
        PrivyUserLookupError::InvalidLinkedAccounts(error) => {
            tracing::warn!(?error, "privy user linked_accounts could not be parsed");
            wallet_session_invalid()
        }
        PrivyUserLookupError::Request(error) => {
            tracing::warn!(error = %error, "privy user lookup request failed");
            ApiError::service_unavailable(
                "privy_user_lookup_failed",
                "Wallet ownership verification is temporarily unavailable.",
            )
        }
        PrivyUserLookupError::Status(status) => {
            tracing::warn!(%status, "privy user lookup returned an error status");
            ApiError::service_unavailable(
                "privy_user_lookup_failed",
                "Wallet ownership verification is temporarily unavailable.",
            )
        }
        _ => ApiError::service_unavailable(
            "privy_user_lookup_failed",
            "Wallet ownership verification is temporarily unavailable.",
        ),
    }
}

fn identity_token_header(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(&IDENTITY_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

impl WalletChallengeStore {
    async fn insert(&self, challenge: WalletChallenge) {
        let mut challenges = self.challenges.write().await;
        let now = Utc::now();
        challenges.retain(|_, challenge| challenge.expires_at > now);
        challenges.insert(challenge.challenge_id.clone(), challenge);
    }

    async fn take(&self, challenge_id: &str) -> Option<WalletChallenge> {
        self.challenges.write().await.remove(challenge_id)
    }
}

struct WalletChallengeMessageInput<'a> {
    wallet_address: &'a str,
    user_id: &'a str,
    session_id: &'a str,
    challenge_id: &'a str,
    nonce: &'a str,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

fn wallet_challenge_message(input: WalletChallengeMessageInput<'_>) -> String {
    format!(
        "{APP_NAME} wallet session\nApp: {APP_NAME}\nWallet: {}\nPrivy User: {}\nPrivy Session: {}\nChallenge: {}\nNonce: {}\nCluster: devnet\nIssued At: {}\nExpires At: {}",
        input.wallet_address,
        input.user_id,
        input.session_id,
        input.challenge_id,
        input.nonce,
        input.issued_at.to_rfc3339(),
        input.expires_at.to_rfc3339()
    )
}

struct WalletSessionTokenInput<'a> {
    wallet_address: &'a str,
    user_id: &'a str,
    session_id: &'a str,
    challenge_id: &'a str,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

fn encode_wallet_session_token(input: WalletSessionTokenInput<'_>) -> Result<String, ApiError> {
    let claims = WalletSessionClaims {
        iss: WALLET_SESSION_ISSUER.to_owned(),
        aud: WALLET_SESSION_AUDIENCE.to_owned(),
        sub: input.user_id.to_owned(),
        sid: input.session_id.to_owned(),
        wallet_address: input.wallet_address.to_owned(),
        challenge_id: input.challenge_id.to_owned(),
        iat: timestamp(input.issued_at)?,
        exp: timestamp(input.expires_at)?,
    };
    let secret = wallet_session_secret()?;
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(ApiError::internal)
}

fn decode_wallet_session_token(token: &str) -> Result<WalletSessionClaims, ApiError> {
    let secret = wallet_session_secret()?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    validation.set_audience(&[WALLET_SESSION_AUDIENCE]);
    validation.set_issuer(&[WALLET_SESSION_ISSUER]);
    let token = decode::<WalletSessionClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|error| match error.kind() {
        ErrorKind::ExpiredSignature => wallet_session_expired(),
        _ => wallet_session_invalid(),
    })?;
    Ok(token.claims)
}

fn optional_wallet_session_header(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(&WALLET_SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn wallet_session_secret() -> Result<String, ApiError> {
    match std::env::var(WALLET_SESSION_SECRET_ENV) {
        Ok(secret) if secret.len() >= 32 => Ok(secret),
        Ok(_) => Err(wallet_session_unconfigured()),
        Err(_) => test_wallet_session_secret(),
    }
}

#[cfg(test)]
fn test_wallet_session_secret() -> Result<String, ApiError> {
    Ok("test-wallet-session-secret-at-least-32-bytes".to_owned())
}

#[cfg(not(test))]
fn test_wallet_session_secret() -> Result<String, ApiError> {
    Err(wallet_session_unconfigured())
}

fn timestamp(value: DateTime<Utc>) -> Result<u64, ApiError> {
    value
        .timestamp()
        .try_into()
        .map_err(|_| ApiError::internal("wallet session timestamp is invalid"))
}

fn wallet_session_invalid() -> ApiError {
    ApiError::unauthorized_with_code(
        "wallet_session_invalid",
        "Wallet ownership verification is invalid.",
    )
}

fn wallet_session_expired() -> ApiError {
    ApiError::unauthorized_with_code(
        "wallet_session_expired",
        "Wallet ownership verification expired.",
    )
}

fn wallet_session_wallet_mismatch() -> ApiError {
    ApiError::forbidden(
        "wallet_session_wallet_mismatch",
        "Wallet ownership verification does not match this wallet.",
    )
}

fn wallet_session_unconfigured() -> ApiError {
    ApiError::service_unavailable(
        "wallet_session_unconfigured",
        "Wallet ownership verification is not configured.",
    )
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn wallet_session_token_for_test(wallet_address: &str) -> String {
    encode_wallet_session_token(WalletSessionTokenInput {
        wallet_address,
        user_id: "did:privy:user-1",
        session_id: "session-1",
        challenge_id: "test-challenge",
        issued_at: Utc::now(),
        expires_at: Utc::now() + Duration::seconds(WALLET_SESSION_TTL_SECONDS),
    })
    .unwrap()
}

#[cfg(test)]
pub(crate) fn wallet_session_token_for_test_with_expiry(
    wallet_address: &str,
    expires_at: DateTime<Utc>,
) -> String {
    encode_wallet_session_token(WalletSessionTokenInput {
        wallet_address,
        user_id: "did:privy:user-1",
        session_id: "session-1",
        challenge_id: "test-challenge",
        issued_at: expires_at - Duration::seconds(WALLET_SESSION_TTL_SECONDS),
        expires_at,
    })
    .unwrap()
}

#[cfg(test)]
pub(crate) async fn insert_wallet_challenge_for_test(
    state: &AppState,
    wallet_address: &str,
    user_id: &str,
    session_id: &str,
    challenge_id: &str,
    message: &str,
    expires_at: DateTime<Utc>,
) {
    state
        .wallet_challenges
        .insert(WalletChallenge {
            challenge_id: challenge_id.to_owned(),
            wallet_address: wallet_address.to_owned(),
            user_id: user_id.to_owned(),
            session_id: session_id.to_owned(),
            message: message.to_owned(),
            expires_at,
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wallet_challenge_message_contains_security_context() {
        let issued_at = Utc::now();
        let expires_at = issued_at + Duration::seconds(CHALLENGE_TTL_SECONDS);
        let message = wallet_challenge_message(WalletChallengeMessageInput {
            wallet_address: "wallet",
            user_id: "user",
            session_id: "session",
            challenge_id: "challenge",
            nonce: "nonce",
            issued_at,
            expires_at,
        });

        assert!(message.contains("BasingaMarket wallet session"));
        assert!(message.contains("Wallet: wallet"));
        assert!(message.contains("Privy User: user"));
        assert!(message.contains("Privy Session: session"));
        assert!(message.contains("Challenge: challenge"));
        assert!(message.contains("Nonce: nonce"));
        assert!(message.contains("Cluster: devnet"));
    }
}
