use basingamarket_domain::{MarketStatus, TicketStatus};
use basingamarket_protocol_events::ProtocolEvent;
use basingamarket_realtime::{topics, EventEnvelope};
use serde_json::json;

use crate::rows::{projected_at, *};
use crate::InMemoryProjectionStore;

#[derive(Debug, Clone)]
pub struct ProjectionEngine {
    store: InMemoryProjectionStore,
}

impl ProjectionEngine {
    pub fn new(store: InMemoryProjectionStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &InMemoryProjectionStore {
        &self.store
    }

    pub async fn apply_raw_event(
        &self,
        meta: EventMeta,
        event: ProtocolEvent,
    ) -> Result<Vec<EventEnvelope>, DbError> {
        let inserted = self.store.insert_raw_event(&meta, event.clone()).await;
        if !inserted {
            return Ok(Vec::new());
        }

        let deltas = self.apply_event(&meta, event).await?;
        self.store.update_cursor(meta.slot).await;
        Ok(deltas)
    }

    pub async fn rebuild_from_raw_events(&self) -> Result<(), DbError> {
        let mut events = self.store.raw_events().await;
        events.sort_by_key(|record| (record.key.slot, record.key.instruction_index));
        self.store.clear_projections().await;
        for record in events.into_iter().filter(|record| record.canonical) {
            let meta = EventMeta {
                cluster: record.key.cluster,
                program_id: record.program_id,
                slot: record.key.slot,
                block_hash: record.block_hash,
                signature: record.signature,
                instruction_index: record.key.instruction_index,
            };
            self.apply_event(&meta, record.event).await?;
            self.store.update_cursor(meta.slot).await;
        }
        Ok(())
    }

    async fn apply_event(
        &self,
        meta: &EventMeta,
        event: ProtocolEvent,
    ) -> Result<Vec<EventEnvelope>, DbError> {
        match event {
            ProtocolEvent::MarketConfigCreated {
                market_id,
                asset,
                duration_seconds,
                settlement_source,
                ..
            } => {
                let now = projected_at(meta);
                let market = MarketRow {
                    market_id,
                    question_hash: format!("{asset} {}m Crypto Round", duration_seconds / 60),
                    status: MarketStatus::Open,
                    outcome_count: 2,
                    open_at: 0,
                    trade_until: u64::MAX,
                    winning_outcome: None,
                    created_slot: meta.slot,
                    created_at: now,
                    updated_at: now,
                };
                self.store
                    .insert_market(
                        market,
                        vec![
                            OutcomeRow {
                                market_id,
                                outcome_id: 0,
                                label: "UP".to_owned(),
                                total_stake: 0,
                                total_reward_shares: 0,
                                current_odds: 500_000,
                            },
                            OutcomeRow {
                                market_id,
                                outcome_id: 1,
                                label: "DOWN".to_owned(),
                                total_stake: 0,
                                total_reward_shares: 0,
                                current_odds: 500_000,
                            },
                        ],
                    )
                    .await;
                Ok(vec![envelope(
                    topics::MARKET_UPDATED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                        "settlement_source": settlement_source,
                    }),
                )])
            }
            ProtocolEvent::MarketCreated {
                market_id,
                question_hash,
                outcome_count,
                open_at,
                trade_until,
            } => {
                let now = projected_at(meta);
                let status = if open_at == 0 {
                    MarketStatus::Open
                } else {
                    MarketStatus::Scheduled
                };
                let market = MarketRow {
                    market_id,
                    question_hash,
                    status,
                    outcome_count,
                    open_at,
                    trade_until,
                    winning_outcome: None,
                    created_slot: meta.slot,
                    created_at: now,
                    updated_at: now,
                };
                let outcomes = (0..outcome_count)
                    .map(|outcome_id| OutcomeRow {
                        market_id,
                        outcome_id,
                        label: format!("Outcome {outcome_id}"),
                        total_stake: 0,
                        total_reward_shares: 0,
                        current_odds: 0,
                    })
                    .collect();
                self.store.insert_market(market, outcomes).await;
                Ok(vec![envelope(
                    topics::MARKET_UPDATED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                        "status": status,
                    }),
                )])
            }
            ProtocolEvent::TicketMinted {
                ticket_id,
                market_id,
                owner,
                outcome_id,
                stake_amount,
                reward_shares,
                entry_odds,
                confidence,
                mood,
            } => {
                let now = projected_at(meta);
                self.store
                    .insert_ticket(
                        TicketRow {
                            ticket_id,
                            market_id,
                            outcome_id,
                            original_caller: owner.clone(),
                            current_owner: owner.clone(),
                            stake_amount,
                            reward_shares,
                            entry_odds,
                            cost_basis_usdc: stake_amount,
                            settlement_value_usdc: None,
                            listed_price: None,
                            status: TicketStatus::Active,
                            claimed: false,
                            confidence,
                            mood,
                            created_slot: meta.slot,
                            created_at: now,
                            updated_at: now,
                        },
                        meta,
                    )
                    .await?;
                Ok(vec![
                    envelope(
                        topics::TICKET_CREATED,
                        meta,
                        Some(market_id),
                        Some(ticket_id),
                        json!({
                            "ticket_id": ticket_id,
                            "market_id": market_id,
                            "owner": owner,
                        }),
                    ),
                    envelope(
                        topics::CANVAS_UPDATED,
                        meta,
                        Some(market_id),
                        Some(ticket_id),
                        json!({
                            "ticket_id": ticket_id,
                            "listed": false,
                        }),
                    ),
                ])
            }
            ProtocolEvent::RoundOpened {
                market_id,
                round_id,
                start_at,
                batch_until,
                end_at,
                start_price,
                binance_symbol,
                binance_interval,
            } => Ok(vec![envelope(
                topics::MARKET_UPDATED,
                meta,
                Some(market_id),
                None,
                json!({
                    "market_id": market_id,
                    "round_id": round_id,
                    "start_at": start_at,
                    "batch_until": batch_until,
                    "end_at": end_at,
                    "start_price": start_price.to_string(),
                    "binance_symbol": binance_symbol,
                    "binance_interval": binance_interval,
                }),
            )]),
            ProtocolEvent::OpeningOrderSubmitted {
                market_id,
                round_id,
                order_id,
                user,
                side,
                net_usdc,
            } => Ok(vec![envelope(
                topics::MARKET_UPDATED,
                meta,
                Some(market_id),
                None,
                json!({
                    "market_id": market_id,
                    "round_id": round_id,
                    "order_id": order_id,
                    "user": user,
                    "side": side,
                    "net_usdc": net_usdc.to_string(),
                }),
            )]),
            ProtocolEvent::OpeningSideFinalized {
                market_id,
                round_id,
                side,
                total_net_usdc,
                total_tickets_out,
            } => Ok(vec![envelope(
                topics::MARKET_UPDATED,
                meta,
                Some(market_id),
                None,
                json!({
                    "market_id": market_id,
                    "round_id": round_id,
                    "side": side,
                    "total_net_usdc": total_net_usdc.to_string(),
                    "total_tickets_out": total_tickets_out.to_string(),
                }),
            )]),
            ProtocolEvent::FreshBought {
                lot_id,
                market_id,
                owner,
                side,
                usdc_in,
                tickets_out,
                avg_entry_price,
                ..
            }
            | ProtocolEvent::OpeningOrderClaimed {
                lot_id,
                market_id,
                owner,
                side,
                ticket_amount: tickets_out,
                usdc_in,
                avg_entry_price,
                ..
            } => {
                let now = projected_at(meta);
                let outcome_id = side_to_outcome_id(&side)?;
                self.store
                    .insert_ticket(
                        TicketRow {
                            ticket_id: lot_id,
                            market_id,
                            outcome_id,
                            original_caller: owner.clone(),
                            current_owner: owner.clone(),
                            stake_amount: tickets_out,
                            reward_shares: tickets_out,
                            entry_odds: avg_entry_price,
                            cost_basis_usdc: usdc_in,
                            settlement_value_usdc: None,
                            listed_price: None,
                            status: TicketStatus::Active,
                            claimed: false,
                            confidence: 50,
                            mood: 0,
                            created_slot: meta.slot,
                            created_at: now,
                            updated_at: now,
                        },
                        meta,
                    )
                    .await?;
                Ok(vec![envelope(
                    topics::TICKET_CREATED,
                    meta,
                    Some(market_id),
                    Some(lot_id),
                    json!({
                        "lot_id": lot_id,
                        "market_id": market_id,
                        "owner": owner,
                        "side": side,
                    }),
                )])
            }
            ProtocolEvent::TicketListed {
                ticket_id,
                seller,
                price,
            } => {
                let market_id = self.store.list_ticket(ticket_id, price, meta).await?;
                Ok(vec![envelope(
                    topics::TICKET_LISTED,
                    meta,
                    Some(market_id),
                    Some(ticket_id),
                    json!({
                        "ticket_id": ticket_id,
                        "seller": seller,
                        "listed_price": price.to_string(),
                    }),
                )])
            }
            ProtocolEvent::ListingCancelled {
                lot_id,
                market_id,
                owner,
            } => {
                let projected_market_id = self.store.cancel_ticket_listing(lot_id, meta).await?;
                Ok(vec![envelope(
                    topics::TICKET_LISTED,
                    meta,
                    Some(projected_market_id),
                    Some(lot_id),
                    json!({
                        "lot_id": lot_id,
                        "market_id": market_id,
                        "owner": owner,
                        "listed": false,
                    }),
                )])
            }
            ProtocolEvent::TicketSold {
                ticket_id,
                from,
                to,
                price,
            } => {
                let market_id = self
                    .store
                    .sell_ticket(ticket_id, from.clone(), to.clone(), price, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::TICKET_SOLD,
                    meta,
                    Some(market_id),
                    Some(ticket_id),
                    json!({
                        "ticket_id": ticket_id,
                        "from": from,
                        "to": to,
                        "price": price.to_string(),
                    }),
                )])
            }
            ProtocolEvent::ListingBought {
                lot_id,
                from,
                to,
                price,
                resale_fee,
                early_flip_fee,
                ..
            } => {
                let market_id = self
                    .store
                    .sell_ticket(lot_id, from.clone(), to.clone(), price, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::TICKET_SOLD,
                    meta,
                    Some(market_id),
                    Some(lot_id),
                    json!({
                        "lot_id": lot_id,
                        "from": from,
                        "to": to,
                        "price": price.to_string(),
                        "resale_fee": resale_fee.to_string(),
                        "early_flip_fee": early_flip_fee.to_string(),
                    }),
                )])
            }
            ProtocolEvent::MarketClosed { market_id } => {
                self.store.close_market(market_id, meta).await?;
                Ok(vec![envelope(
                    topics::MARKET_CLOSED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                    }),
                )])
            }
            ProtocolEvent::RoundClosed { market_id, .. } => {
                self.store.close_market(market_id, meta).await?;
                Ok(vec![envelope(
                    topics::MARKET_CLOSED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                    }),
                )])
            }
            ProtocolEvent::MarketResolved {
                market_id,
                winning_outcome,
            } => {
                self.store
                    .resolve_market(market_id, winning_outcome, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::MARKET_RESOLVED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                        "winning_outcome": winning_outcome,
                    }),
                )])
            }
            ProtocolEvent::RoundResolved {
                market_id,
                winning_side,
                settlement_vault,
                payout_per_ticket,
                protocol_vault_amount,
                ..
            } => {
                let winning_outcome = side_to_outcome_id(&winning_side)?;
                self.store
                    .resolve_market_with_payout(market_id, winning_outcome, payout_per_ticket, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::MARKET_RESOLVED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                        "winning_side": winning_side,
                        "settlement_vault": settlement_vault.to_string(),
                        "payout_per_ticket": payout_per_ticket.to_string(),
                        "protocol_vault_amount": protocol_vault_amount.to_string(),
                    }),
                )])
            }
            ProtocolEvent::RoundVoided { market_id, .. } => {
                let mut state = self.store.state.write().await;
                if let Some(market) = state.markets.get_mut(&market_id) {
                    market.status = MarketStatus::Cancelled;
                    market.updated_at = projected_at(meta);
                }
                drop(state);
                Ok(vec![envelope(
                    topics::MARKET_RESOLVED,
                    meta,
                    Some(market_id),
                    None,
                    json!({
                        "market_id": market_id,
                        "status": "voided",
                    }),
                )])
            }
            ProtocolEvent::PayoutClaimed {
                ticket_id,
                claimer,
                amount,
            } => {
                let market_id = self
                    .store
                    .claim_payout(ticket_id, claimer.clone(), amount, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::MARKET_UPDATED,
                    meta,
                    Some(market_id),
                    Some(ticket_id),
                    json!({
                        "ticket_id": ticket_id,
                        "claimer": claimer,
                        "amount": amount.to_string(),
                        "claimed": true,
                    }),
                )])
            }
            ProtocolEvent::WinningLotClaimed {
                lot_id,
                claimer,
                amount,
                ..
            }
            | ProtocolEvent::VoidLotClaimed {
                lot_id,
                claimer,
                amount,
                ..
            } => {
                let market_id = self
                    .store
                    .claim_payout(lot_id, claimer.clone(), amount, meta)
                    .await?;
                Ok(vec![envelope(
                    topics::MARKET_UPDATED,
                    meta,
                    Some(market_id),
                    Some(lot_id),
                    json!({
                        "lot_id": lot_id,
                        "claimer": claimer,
                        "amount": amount.to_string(),
                        "claimed": true,
                    }),
                )])
            }
        }
    }
}

fn envelope(
    topic: &str,
    meta: &EventMeta,
    market_id: Option<u64>,
    ticket_id: Option<u64>,
    payload: serde_json::Value,
) -> EventEnvelope {
    let mut envelope = EventEnvelope::new(topic, payload).with_solana_metadata(
        meta.cluster.clone(),
        meta.slot,
        meta.signature.clone(),
    );
    envelope.market_id = market_id;
    envelope.ticket_id = ticket_id;
    envelope
}

fn side_to_outcome_id(side: &str) -> Result<u8, DbError> {
    match side.to_ascii_uppercase().as_str() {
        "UP" => Ok(0),
        "DOWN" => Ok(1),
        _ => Err(DbError::Projection(format!("unsupported side {side}"))),
    }
}
