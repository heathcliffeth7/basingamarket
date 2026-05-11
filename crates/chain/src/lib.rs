//! Solana devnet configuration helpers.

use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const SOLANA_DEVNET_CLUSTER: &str = "devnet";
pub const SOLANA_DEVNET_RPC_URL: &str = "https://api.devnet.solana.com";
pub const SOLANA_DEVNET_WS_URL: &str = "wss://api.devnet.solana.com";
pub const SOLANA_CASH_DECIMALS: u8 = 6;
pub const SOLANA_DEPOSIT_COMMITMENT: &str = "confirmed";
pub const SOLANA_SOL_DEPOSIT_PRICE_SYMBOL: &str = "SOLUSDT";
pub const SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS: u64 = 60;
pub const TOKEN_PROGRAM_ADDRESS: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const ASSOCIATED_TOKEN_PROGRAM_ADDRESS: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const BASE58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PDA_MARKER: &[u8] = b"ProgramDerivedAddress";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SolanaDevnetConfig {
    pub cluster: String,
    pub rpc_url: String,
    pub ws_url: Option<String>,
    pub program_id: Option<String>,
    pub request_timeout_ms: u64,
    pub cash_mint: Option<String>,
    pub cash_decimals: u8,
    pub deposit_vault_owner: Option<String>,
    pub deposit_vault_token_account: Option<String>,
    pub deposit_commitment: String,
    pub sol_deposit_enabled: bool,
    pub sol_deposit_treasury: Option<String>,
    pub sol_deposit_quote_ttl_seconds: u64,
    pub sol_deposit_price_symbol: String,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ChainError {
    #[error("only Solana devnet is supported; got {cluster}")]
    UnsupportedSolanaCluster { cluster: String },
    #[error("Solana RPC URL must not be empty")]
    MissingSolanaRpcUrl,
    #[error("{field} must be a valid 32-byte Solana base58 pubkey")]
    InvalidSolanaPubkey { field: &'static str },
    #[error("SOLANA_CASH_DECIMALS must be 6; got {decimals}")]
    UnsupportedCashDecimals { decimals: u8 },
    #[error("SOLANA_CASH_DECIMALS is invalid; got {value}")]
    InvalidCashDecimals { value: String },
    #[error("SOLANA_DEPOSIT_COMMITMENT must be confirmed or finalized; got {commitment}")]
    UnsupportedDepositCommitment { commitment: String },
    #[error("SOLANA_SOL_DEPOSIT_ENABLED is invalid; got {value}")]
    InvalidSolDepositEnabled { value: String },
    #[error("SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS must be greater than zero")]
    InvalidSolDepositQuoteTtl,
    #[error("SOLANA_SOL_DEPOSIT_PRICE_SYMBOL must be SOLUSDT; got {symbol}")]
    UnsupportedSolDepositPriceSymbol { symbol: String },
    #[error("failed to derive associated token account")]
    AssociatedTokenDerivationFailed,
    #[error("Solana signature is invalid")]
    InvalidSolanaSignature,
}

impl Default for SolanaDevnetConfig {
    fn default() -> Self {
        Self {
            cluster: SOLANA_DEVNET_CLUSTER.to_owned(),
            rpc_url: SOLANA_DEVNET_RPC_URL.to_owned(),
            ws_url: Some(SOLANA_DEVNET_WS_URL.to_owned()),
            program_id: None,
            request_timeout_ms: 10_000,
            cash_mint: None,
            cash_decimals: SOLANA_CASH_DECIMALS,
            deposit_vault_owner: None,
            deposit_vault_token_account: None,
            deposit_commitment: SOLANA_DEPOSIT_COMMITMENT.to_owned(),
            sol_deposit_enabled: false,
            sol_deposit_treasury: None,
            sol_deposit_quote_ttl_seconds: SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS,
            sol_deposit_price_symbol: SOLANA_SOL_DEPOSIT_PRICE_SYMBOL.to_owned(),
        }
    }
}

impl SolanaDevnetConfig {
    pub fn from_env() -> Result<Self, ChainError> {
        let cash_decimals = match std::env::var("SOLANA_CASH_DECIMALS") {
            Ok(value) if !value.trim().is_empty() => Some(
                value
                    .parse::<u8>()
                    .map_err(|_| ChainError::InvalidCashDecimals { value })?,
            ),
            _ => None,
        };
        let sol_deposit_enabled = match std::env::var("SOLANA_SOL_DEPOSIT_ENABLED") {
            Ok(value) if !value.trim().is_empty() => Some(parse_bool_env(&value)?),
            _ => None,
        };
        let sol_deposit_quote_ttl_seconds = std::env::var("SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok());

        Self::from_all_values(
            std::env::var("SOLANA_CLUSTER").ok(),
            std::env::var("SOLANA_RPC_URL").ok(),
            std::env::var("SOLANA_WS_URL").ok(),
            std::env::var("SOLANA_PROGRAM_ID").ok(),
            std::env::var("SOLANA_REQUEST_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok()),
            std::env::var("SOLANA_CASH_MINT").ok(),
            cash_decimals,
            std::env::var("SOLANA_DEPOSIT_VAULT_OWNER").ok(),
            std::env::var("SOLANA_DEPOSIT_VAULT_TOKEN_ACCOUNT").ok(),
            std::env::var("SOLANA_DEPOSIT_COMMITMENT").ok(),
            sol_deposit_enabled,
            std::env::var("SOLANA_SOL_TREASURY").ok(),
            sol_deposit_quote_ttl_seconds,
            std::env::var("SOLANA_SOL_DEPOSIT_PRICE_SYMBOL").ok(),
        )
    }

    pub fn from_values(
        cluster: Option<String>,
        rpc_url: Option<String>,
        ws_url: Option<String>,
        program_id: Option<String>,
        request_timeout_ms: Option<u64>,
    ) -> Result<Self, ChainError> {
        Self::from_all_values(
            cluster,
            rpc_url,
            ws_url,
            program_id,
            request_timeout_ms,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_all_values(
        cluster: Option<String>,
        rpc_url: Option<String>,
        ws_url: Option<String>,
        program_id: Option<String>,
        request_timeout_ms: Option<u64>,
        cash_mint: Option<String>,
        cash_decimals: Option<u8>,
        deposit_vault_owner: Option<String>,
        deposit_vault_token_account: Option<String>,
        deposit_commitment: Option<String>,
        sol_deposit_enabled: Option<bool>,
        sol_deposit_treasury: Option<String>,
        sol_deposit_quote_ttl_seconds: Option<u64>,
        sol_deposit_price_symbol: Option<String>,
    ) -> Result<Self, ChainError> {
        let cluster = cluster
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| SOLANA_DEVNET_CLUSTER.to_owned());
        if cluster != SOLANA_DEVNET_CLUSTER {
            return Err(ChainError::UnsupportedSolanaCluster { cluster });
        }

        let rpc_url = rpc_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| SOLANA_DEVNET_RPC_URL.to_owned());
        if rpc_url.trim().is_empty() {
            return Err(ChainError::MissingSolanaRpcUrl);
        }

        let cash_decimals = cash_decimals.unwrap_or(SOLANA_CASH_DECIMALS);
        if cash_decimals != SOLANA_CASH_DECIMALS {
            return Err(ChainError::UnsupportedCashDecimals {
                decimals: cash_decimals,
            });
        }

        let deposit_commitment = deposit_commitment
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| SOLANA_DEPOSIT_COMMITMENT.to_owned());
        if !matches!(deposit_commitment.as_str(), "confirmed" | "finalized") {
            return Err(ChainError::UnsupportedDepositCommitment {
                commitment: deposit_commitment,
            });
        }
        let sol_deposit_quote_ttl_seconds =
            sol_deposit_quote_ttl_seconds.unwrap_or(SOLANA_SOL_DEPOSIT_QUOTE_TTL_SECONDS);
        if sol_deposit_quote_ttl_seconds == 0 {
            return Err(ChainError::InvalidSolDepositQuoteTtl);
        }
        let sol_deposit_price_symbol = sol_deposit_price_symbol
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| SOLANA_SOL_DEPOSIT_PRICE_SYMBOL.to_owned());
        if sol_deposit_price_symbol != SOLANA_SOL_DEPOSIT_PRICE_SYMBOL {
            return Err(ChainError::UnsupportedSolDepositPriceSymbol {
                symbol: sol_deposit_price_symbol,
            });
        }

        Ok(Self {
            cluster,
            rpc_url,
            ws_url: Some(
                ws_url
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| SOLANA_DEVNET_WS_URL.to_owned()),
            ),
            program_id: normalize_optional_pubkey(program_id, "program_id")?,
            request_timeout_ms: request_timeout_ms.unwrap_or(10_000),
            cash_mint: normalize_optional_pubkey(cash_mint, "cash_mint")?,
            cash_decimals,
            deposit_vault_owner: normalize_optional_pubkey(
                deposit_vault_owner,
                "deposit_vault_owner",
            )?,
            deposit_vault_token_account: normalize_optional_pubkey(
                deposit_vault_token_account,
                "deposit_vault_token_account",
            )?,
            deposit_commitment,
            sol_deposit_enabled: sol_deposit_enabled.unwrap_or(false),
            sol_deposit_treasury: normalize_optional_pubkey(
                sol_deposit_treasury,
                "sol_deposit_treasury",
            )?,
            sol_deposit_quote_ttl_seconds,
            sol_deposit_price_symbol,
        })
    }

    pub fn resolved_deposit_vault_token_account(&self) -> Option<String> {
        self.deposit_vault_token_account.clone().or_else(|| {
            let owner = self.deposit_vault_owner.as_ref()?;
            let mint = self.cash_mint.as_ref()?;
            derive_associated_token_address(owner, mint).ok()
        })
    }

    pub fn deposit_status(&self) -> &'static str {
        if self.cash_mint.is_some()
            && self.deposit_vault_owner.is_some()
            && self.resolved_deposit_vault_token_account().is_some()
        {
            "ready"
        } else {
            "projection_pending"
        }
    }

    pub fn sol_deposit_status(&self) -> &'static str {
        if self.deposit_status() == "ready"
            && self.sol_deposit_enabled
            && self.sol_deposit_treasury.is_some()
        {
            "ready"
        } else {
            "projection_pending"
        }
    }
}

fn parse_bool_env(value: &str) -> Result<bool, ChainError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(ChainError::InvalidSolDepositEnabled {
            value: value.to_owned(),
        }),
    }
}

pub fn normalize_base58_pubkey(value: &str, field: &'static str) -> Result<String, ChainError> {
    let trimmed = value.trim();
    match decode_base58_bytes(trimmed) {
        Some(bytes) if bytes.len() == 32 => Ok(trimmed.to_owned()),
        _ => Err(ChainError::InvalidSolanaPubkey { field }),
    }
}

pub fn is_valid_solana_signature(value: &str) -> bool {
    matches!(decode_base58_bytes(value.trim()), Some(bytes) if bytes.len() == 64)
}

pub fn verify_solana_message_signature(
    wallet_address: &str,
    message: &[u8],
    signature: &str,
) -> Result<(), ChainError> {
    let public_key = pubkey_bytes(wallet_address, "wallet_address")?;
    let signature_bytes = decode_base58_bytes(signature)
        .filter(|bytes| bytes.len() == 64)
        .ok_or(ChainError::InvalidSolanaSignature)?;
    let signature = Signature::try_from(signature_bytes.as_slice())
        .map_err(|_| ChainError::InvalidSolanaSignature)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key).map_err(|_| ChainError::InvalidSolanaSignature)?;
    verifying_key
        .verify(message, &signature)
        .map_err(|_| ChainError::InvalidSolanaSignature)
}

pub fn derive_associated_token_address(owner: &str, mint: &str) -> Result<String, ChainError> {
    let owner = pubkey_bytes(owner, "deposit_vault_owner")?;
    let mint = pubkey_bytes(mint, "cash_mint")?;
    let token_program = pubkey_bytes(TOKEN_PROGRAM_ADDRESS, "token_program")?;
    let associated_token_program =
        pubkey_bytes(ASSOCIATED_TOKEN_PROGRAM_ADDRESS, "associated_token_program")?;
    let seeds = [&owner[..], &token_program[..], &mint[..]];
    let pda = find_program_address(&seeds, &associated_token_program)
        .ok_or(ChainError::AssociatedTokenDerivationFailed)?;
    Ok(encode_base58_bytes(&pda))
}

pub fn decode_solana_pubkey(value: &str, field: &'static str) -> Result<[u8; 32], ChainError> {
    pubkey_bytes(value, field)
}

pub fn derive_program_address(
    seeds: &[&[u8]],
    program_id: &str,
    field: &'static str,
) -> Result<String, ChainError> {
    let program_id = pubkey_bytes(program_id, field)?;
    let pda = find_program_address(seeds, &program_id)
        .ok_or(ChainError::AssociatedTokenDerivationFailed)?;
    Ok(encode_base58_bytes(&pda))
}

fn normalize_optional_pubkey(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, ChainError> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_base58_pubkey(&value, field))
        .transpose()
}

fn pubkey_bytes(value: &str, field: &'static str) -> Result<[u8; 32], ChainError> {
    let bytes = decode_base58_bytes(value).ok_or(ChainError::InvalidSolanaPubkey { field })?;
    bytes
        .try_into()
        .map_err(|_| ChainError::InvalidSolanaPubkey { field })
}

fn find_program_address(seeds: &[&[u8]], program_id: &[u8; 32]) -> Option<[u8; 32]> {
    for bump in (0u8..=255).rev() {
        let bump_seed = [bump];
        let mut all_seeds = seeds.to_vec();
        all_seeds.push(&bump_seed);
        if let Some(address) = create_program_address(&all_seeds, program_id) {
            return Some(address);
        }
    }
    None
}

fn create_program_address(seeds: &[&[u8]], program_id: &[u8; 32]) -> Option<[u8; 32]> {
    let mut hasher = Sha256::new();
    for seed in seeds {
        hasher.update(seed);
    }
    hasher.update(program_id);
    hasher.update(PDA_MARKER);
    let hash: [u8; 32] = hasher.finalize().into();
    if CompressedEdwardsY(hash).decompress().is_some() {
        None
    } else {
        Some(hash)
    }
}

pub fn decode_base58_bytes(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() {
        return None;
    }

    let mut bytes: Vec<u8> = Vec::new();
    for character in value.bytes() {
        let digit = BASE58_ALPHABET
            .iter()
            .position(|candidate| *candidate == character)? as u32;
        let mut carry = digit;
        for byte in bytes.iter_mut().rev() {
            let next = u32::from(*byte) * 58 + carry;
            *byte = (next & 0xff) as u8;
            carry = next >> 8;
        }
        while carry > 0 {
            bytes.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }

    for character in value.bytes() {
        if character != b'1' {
            break;
        }
        bytes.insert(0, 0);
    }

    Some(bytes)
}

pub fn encode_base58_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    let mut digits = vec![0u8];
    for byte in bytes {
        let mut carry = u32::from(*byte);
        for digit in digits.iter_mut().rev() {
            let next = u32::from(*digit) * 256 + carry;
            *digit = (next % 58) as u8;
            carry = next / 58;
        }
        while carry > 0 {
            digits.insert(0, (carry % 58) as u8);
            carry /= 58;
        }
    }

    let leading_zeros = bytes.iter().take_while(|byte| **byte == 0).count();
    let mut encoded = "1".repeat(leading_zeros);
    let first_nonzero = digits
        .iter()
        .position(|digit| *digit != 0)
        .unwrap_or(digits.len());
    for digit in &digits[first_nonzero..] {
        encoded.push(BASE58_ALPHABET[*digit as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solana_devnet_config_defaults_to_public_devnet_rpc() {
        let config = SolanaDevnetConfig::from_values(None, None, None, None, None).unwrap();

        assert_eq!(config.cluster, SOLANA_DEVNET_CLUSTER);
        assert_eq!(config.rpc_url, SOLANA_DEVNET_RPC_URL);
        assert_eq!(config.ws_url.as_deref(), Some(SOLANA_DEVNET_WS_URL));
        assert_eq!(config.program_id, None);
        assert_eq!(config.cash_decimals, SOLANA_CASH_DECIMALS);
        assert_eq!(config.deposit_status(), "projection_pending");
    }

    #[test]
    fn solana_devnet_config_rejects_non_devnet_cluster() {
        assert_eq!(
            SolanaDevnetConfig::from_values(
                Some("mainnet-beta".to_owned()),
                None,
                None,
                None,
                None,
            )
            .unwrap_err(),
            ChainError::UnsupportedSolanaCluster {
                cluster: "mainnet-beta".to_owned(),
            }
        );
    }

    #[test]
    fn solana_devnet_config_rejects_non_six_cash_decimals() {
        assert_eq!(
            SolanaDevnetConfig::from_all_values(
                None,
                None,
                None,
                None,
                None,
                None,
                Some(9),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap_err(),
            ChainError::UnsupportedCashDecimals { decimals: 9 }
        );
    }

    #[test]
    fn solana_devnet_config_resolves_deposit_vault_ata() {
        let config = SolanaDevnetConfig::from_all_values(
            None,
            None,
            None,
            None,
            None,
            Some("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned()),
            Some(SOLANA_CASH_DECIMALS),
            Some("So11111111111111111111111111111111111111112".to_owned()),
            None,
            Some("confirmed".to_owned()),
            Some(true),
            Some("So11111111111111111111111111111111111111112".to_owned()),
            Some(60),
            Some("SOLUSDT".to_owned()),
        )
        .unwrap();

        let vault = config.resolved_deposit_vault_token_account().unwrap();
        assert_eq!(config.deposit_status(), "ready");
        assert_eq!(config.sol_deposit_status(), "ready");
        assert_eq!(
            normalize_base58_pubkey(&vault, "deposit_vault_token_account").unwrap(),
            vault
        );
    }

    #[test]
    fn solana_signature_validation_requires_64_base58_bytes() {
        let signature =
            "5j7s6Ni4yD78uBojfzXcYABn5QfFYfDySXwMWxv5U5uY8hVskYoWc9vEwF7PhuQ7sU4x5a8oRWhk4R3WTPfZqW3q";

        assert!(is_valid_solana_signature(signature));
        assert!(!is_valid_solana_signature(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ));
    }
}
