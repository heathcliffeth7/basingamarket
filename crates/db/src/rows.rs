//! Projection storage, SQLx migration hook, and replay row types.

use basingamarket_domain::{MarketStatus, TicketStatus};
use basingamarket_protocol_events::ProtocolEvent;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("market {0} not found")]
    MarketNotFound(u64),
    #[error("ticket {0} not found")]
    TicketNotFound(u64),
    #[error("share card {0} not found")]
    ShareCardNotFound(Uuid),
    #[error("projection error: {0}")]
    Projection(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    SerdeJson(#[from] serde_json::Error),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RawEventKey {
    pub cluster: String,
    pub slot: u64,
    pub instruction_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawEventRecord {
    pub key: RawEventKey,
    pub program_id: String,
    pub block_hash: String,
    pub signature: String,
    pub event: ProtocolEvent,
    pub canonical: bool,
    pub inserted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventMeta {
    pub cluster: String,
    pub program_id: String,
    pub slot: u64,
    pub block_hash: String,
    pub signature: String,
    pub instruction_index: u32,
}

impl EventMeta {
    pub fn fixture(slot: u64, instruction_index: u32) -> Self {
        Self {
            cluster: "devnet".to_owned(),
            program_id: String::new(),
            slot,
            block_hash: format!("devnet-blockhash-{slot}"),
            signature: format!("devnet-signature-{slot}-{instruction_index}"),
            instruction_index,
        }
    }

    pub(crate) fn raw_key(&self) -> RawEventKey {
        RawEventKey {
            cluster: self.cluster.clone(),
            slot: self.slot,
            instruction_index: self.instruction_index,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketRow {
    pub market_id: u64,
    pub question_hash: String,
    pub status: MarketStatus,
    pub outcome_count: u8,
    pub open_at: u64,
    pub trade_until: u64,
    pub winning_outcome: Option<u8>,
    pub created_slot: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomeRow {
    pub market_id: u64,
    pub outcome_id: u8,
    pub label: String,
    pub total_stake: u128,
    pub total_reward_shares: u128,
    pub current_odds: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketRow {
    pub ticket_id: u64,
    pub market_id: u64,
    pub round_id: u64,
    pub outcome_id: u8,
    pub original_caller: String,
    pub current_owner: String,
    pub stake_amount: u128,
    pub reward_shares: u128,
    pub entry_odds: u128,
    #[serde(default)]
    pub cost_basis_usdc: u128,
    #[serde(default)]
    pub settlement_value_usdc: Option<u128>,
    pub listed_price: Option<u128>,
    pub status: TicketStatus,
    pub claimed: bool,
    pub confidence: u16,
    pub mood: u8,
    pub created_slot: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketTransferRow {
    pub ticket_id: u64,
    pub from_address: String,
    pub to_address: String,
    pub price: u128,
    pub slot: u64,
    pub signature: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionHistoryRow {
    pub wallet_address: String,
    pub market_id: u64,
    pub ticket_id: u64,
    pub action: String,
    pub outcome_id: u8,
    pub amount: u128,
    pub slot: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanvasObjectRow {
    pub market_id: u64,
    pub ticket_id: u64,
    pub x: i32,
    pub y: i32,
    pub radius: u16,
    pub avatar_url: Option<String>,
    pub mood: u8,
    pub confidence: u16,
    pub listed: bool,
    pub current_owner: String,
    pub original_caller: String,
    pub z_index: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayoutClaimRow {
    pub ticket_id: u64,
    pub claimer: String,
    pub amount: u128,
    pub slot: u64,
    pub signature: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketClaimResult {
    pub ticket: TicketRow,
    pub cash_balance: CashBalanceRow,
    pub amount: u128,
    pub credited: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileRow {
    pub wallet_address: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashBalanceRow {
    pub wallet_address: String,
    pub cash_balance: u128,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusdcMintRow {
    pub mint_id: String,
    pub wallet_address: String,
    pub mint_day: String,
    pub amount: u128,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashTradeReservationRow {
    pub trade_id: String,
    pub wallet_address: String,
    pub amount: u128,
    pub released: bool,
    pub completed_signature: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashTradeRow {
    pub trade_id: String,
    pub wallet_address: String,
    pub signature: String,
    pub mint: String,
    pub vault_token_account: String,
    #[serde(default)]
    pub market_id: u64,
    pub round_id: u64,
    pub position_lot: String,
    pub lot_id: u64,
    pub side: String,
    pub usdc_in: u128,
    pub fee_usdc: u128,
    pub net_usdc: u128,
    pub tickets_out: u128,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashBidRow {
    pub bid_id: String,
    pub market_id: u64,
    pub round_id: u64,
    pub side: String,
    pub buyer_wallet: String,
    pub price_per_ticket: u128,
    pub max_usdc: u128,
    pub remaining_usdc: u128,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashResaleRow {
    pub sale_id: String,
    pub signature: String,
    pub bid_id: Option<String>,
    pub market_id: u64,
    pub round_id: u64,
    pub seller_wallet: String,
    pub buyer_wallet: String,
    pub source_lot_id: u64,
    pub buyer_lot_id: Option<u64>,
    pub side: String,
    pub tickets_sold: u128,
    pub gross_usdc: u128,
    pub resale_fee: u128,
    pub early_flip_fee: u128,
    pub seller_receives: u128,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashDepositRow {
    pub wallet_address: String,
    pub signature: String,
    pub mint: String,
    pub vault_token_account: String,
    pub amount: u128,
    pub slot: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SolDepositQuoteRow {
    pub quote_id: String,
    pub wallet_address: String,
    pub cash_amount: u128,
    pub lamports: u64,
    pub price: u128,
    pub treasury: String,
    pub expires_at: DateTime<Utc>,
    pub used_signature: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SolDepositRow {
    pub wallet_address: String,
    pub signature: String,
    pub quote_id: String,
    pub treasury: String,
    pub lamports: u64,
    pub cash_amount: u128,
    pub price: u128,
    pub slot: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferDepositQuoteRow {
    pub quote_id: String,
    pub wallet_address: String,
    pub asset: String,
    pub cash_amount: u128,
    pub transfer_amount: u128,
    pub price: Option<u128>,
    pub destination: String,
    pub mint: Option<String>,
    pub reference: String,
    pub expires_at: DateTime<Utc>,
    pub used_signature: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferDepositRow {
    pub wallet_address: String,
    pub signature: String,
    pub quote_id: String,
    pub asset: String,
    pub destination: String,
    pub transfer_amount: u128,
    pub cash_amount: u128,
    pub price: Option<u128>,
    pub slot: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareCardStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShareCardRow {
    pub id: Uuid,
    pub ticket_id: u64,
    pub status: ShareCardStatus,
    pub svg_hash: Option<String>,
    pub png_url: Option<String>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub(crate) fn projected_at(meta: &EventMeta) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(meta.slot as i64, 0).unwrap_or_else(Utc::now)
}
