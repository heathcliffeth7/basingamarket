//! Authentication boundary helpers.
//!
//! MVP routes mostly read public projection data. This crate keeps wallet and
//! session validation decisions explicit so handlers do not hand-roll address
//! parsing.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AuthError {
    #[error("address is empty")]
    EmptyAddress,
    #[error("address must be a 32-byte Solana pubkey")]
    InvalidAddress,
    #[error("missing bearer token")]
    MissingBearerToken,
    #[error("auth is not configured")]
    MissingAuthConfig,
    #[error("privy verification key is invalid")]
    InvalidVerificationKey,
    #[error("privy access token is invalid")]
    InvalidToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionClaims {
    pub wallet_address: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivyAuthConfig {
    app_id: String,
    verification_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivyAccessTokenClaims {
    pub aud: String,
    pub exp: u64,
    pub iat: u64,
    pub iss: String,
    pub sid: String,
    pub sub: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifiedPrivyClaims {
    pub app_id: String,
    pub user_id: String,
    pub issuer: String,
    pub issued_at: u64,
    pub expiration: u64,
    pub session_id: String,
}

impl PrivyAuthConfig {
    pub fn new(
        app_id: impl Into<String>,
        verification_key: impl Into<String>,
    ) -> Result<Self, AuthError> {
        let app_id = app_id.into();
        let verification_key = normalize_pem(verification_key.into());
        if app_id.trim().is_empty() || verification_key.trim().is_empty() {
            return Err(AuthError::MissingAuthConfig);
        }
        DecodingKey::from_ec_pem(verification_key.as_bytes())
            .map_err(|_| AuthError::InvalidVerificationKey)?;
        Ok(Self {
            app_id,
            verification_key,
        })
    }

    pub fn from_env() -> Result<Self, AuthError> {
        let app_id = std::env::var("PRIVY_APP_ID").map_err(|_| AuthError::MissingAuthConfig)?;
        let verification_key =
            std::env::var("PRIVY_VERIFICATION_KEY").map_err(|_| AuthError::MissingAuthConfig)?;
        Self::new(app_id, verification_key)
    }

    pub fn verify_access_token(&self, token: &str) -> Result<VerifiedPrivyClaims, AuthError> {
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_audience(&[self.app_id.as_str()]);
        validation.set_issuer(&["privy.io"]);
        validation.set_required_spec_claims(&["aud", "exp", "iat", "iss", "sub"]);

        let key = DecodingKey::from_ec_pem(self.verification_key.as_bytes())
            .map_err(|_| AuthError::InvalidVerificationKey)?;
        let token = decode::<PrivyAccessTokenClaims>(token, &key, &validation)
            .map_err(|_| AuthError::InvalidToken)?;
        let claims = token.claims;
        if claims.sid.trim().is_empty() || claims.sub.trim().is_empty() {
            return Err(AuthError::InvalidToken);
        }

        Ok(VerifiedPrivyClaims {
            app_id: claims.aud,
            user_id: claims.sub,
            issuer: claims.iss,
            issued_at: claims.iat,
            expiration: claims.exp,
            session_id: claims.sid,
        })
    }
}

pub fn normalize_solana_pubkey(address: &str) -> Result<String, AuthError> {
    let address = address.trim();
    if address.is_empty() {
        return Err(AuthError::EmptyAddress);
    }

    if address.starts_with("0x") {
        return Err(AuthError::InvalidAddress);
    }

    let decoded = decode_base58(address).ok_or(AuthError::InvalidAddress)?;
    if decoded.len() != 32 {
        return Err(AuthError::InvalidAddress);
    }

    Ok(address.to_owned())
}

pub fn parse_bearer_token(header: Option<&str>) -> Result<&str, AuthError> {
    let header = header.ok_or(AuthError::MissingBearerToken)?;
    header
        .strip_prefix("Bearer ")
        .filter(|token| !token.trim().is_empty())
        .ok_or(AuthError::MissingBearerToken)
}

fn normalize_pem(key: String) -> String {
    key.trim().replace("\\n", "\n")
}

fn decode_base58(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() {
        return None;
    }

    let mut bytes = vec![0_u8];
    for byte in value.bytes() {
        let mut carry = base58_value(byte)? as u32;
        for item in bytes.iter_mut().rev() {
            let next = u32::from(*item) * 58 + carry;
            *item = (next & 0xff) as u8;
            carry = next >> 8;
        }
        while carry > 0 {
            bytes.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }

    let leading_zeroes = value.bytes().take_while(|byte| *byte == b'1').count();
    let first_non_zero = bytes
        .iter()
        .position(|byte| *byte != 0)
        .unwrap_or(bytes.len());
    let mut decoded = vec![0_u8; leading_zeroes];
    decoded.extend_from_slice(&bytes[first_non_zero..]);
    Some(decoded)
}

fn base58_value(byte: u8) -> Option<u8> {
    const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    ALPHABET
        .iter()
        .position(|candidate| *candidate == byte)
        .map(|index| index as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, get_current_timestamp, EncodingKey, Header};
    use p256::{
        ecdsa::SigningKey,
        elliptic_curve::rand_core::OsRng,
        pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
    };
    use std::sync::OnceLock;

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

    #[test]
    fn accepts_solana_pubkey_without_changing_case() {
        let pubkey = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        assert_eq!(normalize_solana_pubkey(pubkey).unwrap(), pubkey);
    }

    #[test]
    fn rejects_zero_x_and_bad_addresses() {
        assert_eq!(
            normalize_solana_pubkey("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            Err(AuthError::InvalidAddress)
        );
        assert_eq!(
            normalize_solana_pubkey("abc"),
            Err(AuthError::InvalidAddress)
        );
    }

    #[test]
    fn verifies_privy_access_token_claims() {
        let now = get_current_timestamp();
        let token = encode(
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
        .unwrap();
        let config = PrivyAuthConfig::new(TEST_APP_ID, &test_es256_keys().verifying_pem).unwrap();

        let claims = config.verify_access_token(&token).unwrap();

        assert_eq!(claims.app_id, TEST_APP_ID);
        assert_eq!(claims.user_id, "did:privy:user-1");
        assert_eq!(claims.issuer, "privy.io");
        assert_eq!(claims.session_id, "session-1");
    }

    #[test]
    fn rejects_wrong_app_id() {
        let now = get_current_timestamp();
        let token = encode(
            &Header::new(Algorithm::ES256),
            &PrivyAccessTokenClaims {
                aud: "another-app".to_owned(),
                exp: now + 3600,
                iat: now,
                iss: "privy.io".to_owned(),
                sid: "session-1".to_owned(),
                sub: "did:privy:user-1".to_owned(),
            },
            &EncodingKey::from_ec_pem(test_es256_keys().signing_pem.as_bytes()).unwrap(),
        )
        .unwrap();
        let config = PrivyAuthConfig::new(TEST_APP_ID, &test_es256_keys().verifying_pem).unwrap();

        assert_eq!(
            config.verify_access_token(&token),
            Err(AuthError::InvalidToken)
        );
    }
}
