use std::collections::BTreeMap;

use basingamarket_domain::{TicketStatus, SCALE};
use chrono::{DateTime, Utc};

use crate::{
    rows::projected_at, CashBalanceRow, DbError, EventMeta, InMemoryProjectionStore,
    PayoutClaimRow, TicketClaimResult,
};

impl InMemoryProjectionStore {
    pub async fn settle_round_tickets(
        &self,
        market_id: u64,
        round_id: u64,
        winning_outcome: Option<u8>,
        payout_per_ticket: Option<u128>,
        refund_per_ticket_by_outcome: BTreeMap<u8, u128>,
        settled_at: DateTime<Utc>,
    ) -> Result<usize, DbError> {
        let mut state = self.state.write().await;
        let mut updated = 0;
        let mut canvas_updates = Vec::new();

        for ticket in state
            .tickets
            .values_mut()
            .filter(|ticket| ticket.market_id == market_id && ticket.round_id == round_id)
        {
            if ticket.claimed || matches!(ticket.status, TicketStatus::Claimed) {
                continue;
            }
            if matches!(ticket.status, TicketStatus::Cancelled) {
                continue;
            }

            ticket.listed_price = None;
            ticket.status = match winning_outcome {
                Some(outcome_id) if ticket.outcome_id == outcome_id => TicketStatus::Claimable,
                Some(_) => TicketStatus::Lost,
                None => TicketStatus::Refundable,
            };
            ticket.settlement_value_usdc = match winning_outcome {
                Some(outcome_id) if ticket.outcome_id == outcome_id => payout_per_ticket
                    .map(|price| entry_total(price, ticket.reward_shares))
                    .transpose()?,
                Some(_) => Some(0),
                None => match refund_per_ticket_by_outcome.get(&ticket.outcome_id) {
                    Some(price) => Some(entry_total(*price, ticket.reward_shares)?),
                    None => Some(ticket.cost_basis_usdc),
                },
            };
            ticket.updated_at = settled_at;
            canvas_updates.push(ticket.ticket_id);
            updated += 1;
        }

        for ticket_id in canvas_updates {
            if let Some(canvas) = state.canvas_objects.get_mut(&(market_id, ticket_id)) {
                canvas.listed = false;
                canvas.updated_at = settled_at;
            }
        }

        Ok(updated)
    }

    pub async fn claim_ticket_to_cash(
        &self,
        ticket_id: u64,
        claimer: String,
        amount: u128,
        meta: &EventMeta,
    ) -> Result<TicketClaimResult, DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);

        if let Some(existing) = state.payout_claims.get(&ticket_id).cloned() {
            let ticket = state
                .tickets
                .get(&ticket_id)
                .cloned()
                .ok_or(DbError::TicketNotFound(ticket_id))?;
            let cash_balance =
                state
                    .cash_balances
                    .get(&claimer)
                    .cloned()
                    .unwrap_or(CashBalanceRow {
                        wallet_address: claimer,
                        cash_balance: 0,
                        updated_at: projected_at,
                    });
            return Ok(TicketClaimResult {
                ticket,
                cash_balance,
                amount: existing.amount,
                credited: false,
            });
        }

        let ticket = state
            .tickets
            .get_mut(&ticket_id)
            .ok_or(DbError::TicketNotFound(ticket_id))?;
        ticket.claimed = true;
        ticket.status = TicketStatus::Claimed;
        ticket.updated_at = projected_at;
        let ticket = ticket.clone();

        let current = state
            .cash_balances
            .get(&claimer)
            .map(|row| row.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let cash_balance = CashBalanceRow {
            wallet_address: claimer.clone(),
            cash_balance: next,
            updated_at: projected_at,
        };
        state
            .cash_balances
            .insert(claimer.clone(), cash_balance.clone());
        state.payout_claims.insert(
            ticket_id,
            PayoutClaimRow {
                ticket_id,
                claimer,
                amount,
                slot: meta.slot,
                signature: meta.signature.clone(),
                created_at: projected_at,
            },
        );

        Ok(TicketClaimResult {
            ticket,
            cash_balance,
            amount,
            credited: true,
        })
    }
}

fn entry_total(price: u128, tickets: u128) -> Result<u128, DbError> {
    price
        .checked_mul(tickets)
        .and_then(|value| value.checked_div(SCALE))
        .ok_or_else(|| DbError::Projection("settlement entry overflow".to_owned()))
}
