//! Protocol event definitions shared by replay, projections, and tests.
//!
//! These are application-level events for the Solana devnet projection path.
//! They intentionally avoid chain-specific bindings until an Anchor program exists.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "basingamarket-solana-devnet-v0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_name", rename_all = "PascalCase")]
pub enum ProtocolEvent {
    MarketCreated {
        market_id: u64,
        question_hash: String,
        outcome_count: u8,
        open_at: u64,
        trade_until: u64,
    },
    MarketConfigCreated {
        market_id: u64,
        asset: String,
        duration_seconds: u64,
        settlement_source: String,
        buy_fee_bps: u16,
        resale_fee_bps: u16,
        min_side_real_usdc: u128,
    },
    RoundOpened {
        market_id: u64,
        round_id: u64,
        start_at: i64,
        batch_until: i64,
        end_at: i64,
        start_price: u128,
        binance_symbol: String,
        binance_interval: String,
    },
    OpeningOrderSubmitted {
        market_id: u64,
        round_id: u64,
        order_id: u64,
        user: String,
        side: String,
        net_usdc: u128,
    },
    OpeningSideFinalized {
        market_id: u64,
        round_id: u64,
        side: String,
        total_net_usdc: u128,
        total_tickets_out: u128,
    },
    OpeningOrderClaimed {
        market_id: u64,
        round_id: u64,
        order_id: u64,
        lot_id: u64,
        owner: String,
        side: String,
        ticket_amount: u128,
        usdc_in: u128,
        avg_entry_price: u128,
    },
    FreshBought {
        lot_id: u64,
        market_id: u64,
        round_id: u64,
        owner: String,
        side: String,
        usdc_in: u128,
        fee: u128,
        net_usdc: u128,
        tickets_out: u128,
        avg_entry_price: u128,
        fresh_price_after: u128,
    },
    TicketMinted {
        ticket_id: u64,
        market_id: u64,
        owner: String,
        outcome_id: u8,
        stake_amount: u128,
        reward_shares: u128,
        entry_odds: u128,
        confidence: u16,
        mood: u8,
    },
    TicketListed {
        ticket_id: u64,
        seller: String,
        price: u128,
    },
    ListingCancelled {
        lot_id: u64,
        market_id: u64,
        owner: String,
    },
    TicketSold {
        ticket_id: u64,
        from: String,
        to: String,
        price: u128,
    },
    ListingBought {
        lot_id: u64,
        market_id: u64,
        round_id: u64,
        from: String,
        to: String,
        price: u128,
        resale_fee: u128,
        early_flip_fee: u128,
    },
    MarketClosed {
        market_id: u64,
    },
    RoundClosed {
        market_id: u64,
        round_id: u64,
    },
    MarketResolved {
        market_id: u64,
        winning_outcome: u8,
    },
    RoundResolved {
        market_id: u64,
        round_id: u64,
        start_price: u128,
        end_price: u128,
        winning_side: String,
        settlement_vault: u128,
        payout_per_ticket: u128,
        #[serde(default)]
        protocol_vault_amount: u128,
    },
    RoundVoided {
        market_id: u64,
        round_id: u64,
        start_price: u128,
        end_price: u128,
    },
    PayoutClaimed {
        ticket_id: u64,
        claimer: String,
        amount: u128,
    },
    WinningLotClaimed {
        lot_id: u64,
        market_id: u64,
        round_id: u64,
        claimer: String,
        amount: u128,
    },
    VoidLotClaimed {
        lot_id: u64,
        market_id: u64,
        round_id: u64,
        claimer: String,
        amount: u128,
    },
}

impl ProtocolEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::MarketCreated { .. } => "MarketCreated",
            Self::MarketConfigCreated { .. } => "MarketConfigCreated",
            Self::RoundOpened { .. } => "RoundOpened",
            Self::OpeningOrderSubmitted { .. } => "OpeningOrderSubmitted",
            Self::OpeningSideFinalized { .. } => "OpeningSideFinalized",
            Self::OpeningOrderClaimed { .. } => "OpeningOrderClaimed",
            Self::FreshBought { .. } => "FreshBought",
            Self::TicketMinted { .. } => "TicketMinted",
            Self::TicketListed { .. } => "TicketListed",
            Self::ListingCancelled { .. } => "ListingCancelled",
            Self::TicketSold { .. } => "TicketSold",
            Self::ListingBought { .. } => "ListingBought",
            Self::MarketClosed { .. } => "MarketClosed",
            Self::RoundClosed { .. } => "RoundClosed",
            Self::MarketResolved { .. } => "MarketResolved",
            Self::RoundResolved { .. } => "RoundResolved",
            Self::RoundVoided { .. } => "RoundVoided",
            Self::PayoutClaimed { .. } => "PayoutClaimed",
            Self::WinningLotClaimed { .. } => "WinningLotClaimed",
            Self::VoidLotClaimed { .. } => "VoidLotClaimed",
        }
    }

    pub fn market_id(&self) -> Option<u64> {
        match self {
            Self::MarketCreated { market_id, .. }
            | Self::MarketConfigCreated { market_id, .. }
            | Self::RoundOpened { market_id, .. }
            | Self::OpeningOrderSubmitted { market_id, .. }
            | Self::OpeningSideFinalized { market_id, .. }
            | Self::OpeningOrderClaimed { market_id, .. }
            | Self::FreshBought { market_id, .. }
            | Self::TicketMinted { market_id, .. }
            | Self::ListingCancelled { market_id, .. }
            | Self::ListingBought { market_id, .. }
            | Self::MarketClosed { market_id }
            | Self::RoundClosed { market_id, .. }
            | Self::MarketResolved { market_id, .. }
            | Self::RoundResolved { market_id, .. }
            | Self::RoundVoided { market_id, .. }
            | Self::WinningLotClaimed { market_id, .. }
            | Self::VoidLotClaimed { market_id, .. } => Some(*market_id),
            Self::TicketListed { .. } | Self::TicketSold { .. } | Self::PayoutClaimed { .. } => {
                None
            }
        }
    }

    pub fn ticket_id(&self) -> Option<u64> {
        match self {
            Self::FreshBought { lot_id, .. }
            | Self::OpeningOrderClaimed { lot_id, .. }
            | Self::ListingCancelled { lot_id, .. }
            | Self::ListingBought { lot_id, .. }
            | Self::WinningLotClaimed { lot_id, .. }
            | Self::VoidLotClaimed { lot_id, .. } => Some(*lot_id),
            Self::TicketMinted { ticket_id, .. }
            | Self::TicketListed { ticket_id, .. }
            | Self::TicketSold { ticket_id, .. }
            | Self::PayoutClaimed { ticket_id, .. } => Some(*ticket_id),
            Self::MarketCreated { .. }
            | Self::MarketConfigCreated { .. }
            | Self::RoundOpened { .. }
            | Self::OpeningOrderSubmitted { .. }
            | Self::OpeningSideFinalized { .. }
            | Self::MarketClosed { .. }
            | Self::RoundClosed { .. }
            | Self::MarketResolved { .. }
            | Self::RoundResolved { .. }
            | Self::RoundVoided { .. } => None,
        }
    }

    pub fn payload_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("ProtocolEvent serialization is infallible")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_fixture_event_with_pascal_event_name() {
        let event = ProtocolEvent::MarketCreated {
            market_id: 12,
            question_hash: "fixture-question".to_owned(),
            outcome_count: 2,
            open_at: 1,
            trade_until: 2,
        };
        let json = event.payload_json();

        assert_eq!(json["event_name"], "MarketCreated");
        assert_eq!(event.event_name(), "MarketCreated");
        assert_eq!(event.market_id(), Some(12));
    }
}
