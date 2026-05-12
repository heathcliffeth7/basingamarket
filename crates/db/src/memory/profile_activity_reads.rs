use std::collections::HashSet;

use crate::rows::{CashResaleRow, CashTradeRow, PayoutClaimRow, TicketRow};

use super::InMemoryProjectionStore;

impl InMemoryProjectionStore {
    pub async fn get_tickets_for_profile(&self, wallet_address: &str) -> Vec<TicketRow> {
        self.state
            .read()
            .await
            .tickets
            .values()
            .filter(|ticket| {
                ticket.current_owner == wallet_address || ticket.original_caller == wallet_address
            })
            .cloned()
            .collect()
    }

    pub async fn get_tickets_by_ids(&self, ticket_ids: &[u64]) -> Vec<TicketRow> {
        let ids = ticket_ids.iter().copied().collect::<HashSet<_>>();
        self.state
            .read()
            .await
            .tickets
            .values()
            .filter(|ticket| ids.contains(&ticket.ticket_id))
            .cloned()
            .collect()
    }

    pub async fn cash_trades(&self) -> Vec<CashTradeRow> {
        self.state
            .read()
            .await
            .cash_trades
            .values()
            .cloned()
            .collect()
    }

    pub async fn cash_resales(&self) -> Vec<CashResaleRow> {
        self.state
            .read()
            .await
            .cash_resales
            .values()
            .cloned()
            .collect()
    }

    pub async fn payout_claims_for_wallet(&self, wallet_address: &str) -> Vec<PayoutClaimRow> {
        self.state
            .read()
            .await
            .payout_claims
            .values()
            .filter(|claim| claim.claimer == wallet_address)
            .cloned()
            .collect()
    }
}
