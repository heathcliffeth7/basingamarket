use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use basingamarket_domain::{MarketStatus, TicketStatus, SCALE};
use basingamarket_protocol_events::ProtocolEvent;
use chrono::Utc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::rows::{projected_at, *};
use crate::withdrawals::{CashWithdrawalQuoteRow, CashWithdrawalRow};

#[derive(Debug, Default)]
pub(crate) struct ProjectionState {
    pub(crate) raw_event_keys: HashSet<RawEventKey>,
    pub(crate) raw_events: Vec<RawEventRecord>,
    pub(crate) markets: BTreeMap<u64, MarketRow>,
    pub(crate) outcomes: BTreeMap<(u64, u8), OutcomeRow>,
    pub(crate) tickets: BTreeMap<u64, TicketRow>,
    pub(crate) transfers: Vec<TicketTransferRow>,
    pub(crate) positions: Vec<PositionHistoryRow>,
    pub(crate) canvas_objects: BTreeMap<(u64, u64), CanvasObjectRow>,
    pub(crate) payout_claims: BTreeMap<u64, PayoutClaimRow>,
    pub(crate) profiles: BTreeMap<String, ProfileRow>,
    pub(crate) cash_balances: BTreeMap<String, CashBalanceRow>,
    pub(crate) busdc_mints: BTreeMap<String, BusdcMintRow>,
    pub(crate) cash_trade_reservations: BTreeMap<String, CashTradeReservationRow>,
    pub(crate) cash_trades: BTreeMap<String, CashTradeRow>,
    pub(crate) cash_bids: BTreeMap<String, CashBidRow>,
    pub(crate) cash_resales: BTreeMap<String, CashResaleRow>,
    pub(crate) cash_deposits: BTreeMap<String, CashDepositRow>,
    pub(crate) sol_deposit_quotes: BTreeMap<String, SolDepositQuoteRow>,
    pub(crate) sol_deposits: BTreeMap<String, SolDepositRow>,
    pub(crate) transfer_deposit_quotes: BTreeMap<String, TransferDepositQuoteRow>,
    pub(crate) transfer_deposits: BTreeMap<String, TransferDepositRow>,
    pub(crate) cash_withdrawal_quotes: BTreeMap<String, CashWithdrawalQuoteRow>,
    pub(crate) cash_withdrawals: BTreeMap<String, CashWithdrawalRow>,
    pub(crate) share_cards: BTreeMap<Uuid, ShareCardRow>,
    pub(crate) indexer_cursor: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryProjectionStore {
    pub(crate) state: Arc<RwLock<ProjectionState>>,
}

impl InMemoryProjectionStore {
    pub async fn clear_projections(&self) {
        let mut state = self.state.write().await;
        state.markets.clear();
        state.outcomes.clear();
        state.tickets.clear();
        state.transfers.clear();
        state.positions.clear();
        state.canvas_objects.clear();
        state.payout_claims.clear();
        state.share_cards.clear();
        state.cash_balances.clear();
        state.busdc_mints.clear();
        state.cash_trade_reservations.clear();
        state.cash_trades.clear();
        state.cash_bids.clear();
        state.cash_resales.clear();
        state.cash_deposits.clear();
        state.sol_deposit_quotes.clear();
        state.sol_deposits.clear();
        state.transfer_deposit_quotes.clear();
        state.transfer_deposits.clear();
        state.cash_withdrawal_quotes.clear();
        state.cash_withdrawals.clear();
        state.indexer_cursor = None;
    }

    pub async fn insert_raw_event(&self, meta: &EventMeta, event: ProtocolEvent) -> bool {
        let mut state = self.state.write().await;
        let key = meta.raw_key();
        if !state.raw_event_keys.insert(key.clone()) {
            return false;
        }
        state.raw_events.push(RawEventRecord {
            key,
            program_id: meta.program_id.clone(),
            block_hash: meta.block_hash.clone(),
            signature: meta.signature.clone(),
            event,
            canonical: true,
            inserted_at: Utc::now(),
        });
        true
    }

    pub async fn raw_events(&self) -> Vec<RawEventRecord> {
        self.state.read().await.raw_events.clone()
    }

    pub async fn update_cursor(&self, slot: u64) {
        self.state.write().await.indexer_cursor = Some(slot);
    }

    pub async fn indexer_cursor(&self) -> Option<u64> {
        self.state.read().await.indexer_cursor
    }

    pub async fn list_markets(&self) -> Vec<MarketRow> {
        self.state.read().await.markets.values().cloned().collect()
    }

    pub async fn get_market(&self, market_id: u64) -> Option<MarketRow> {
        self.state.read().await.markets.get(&market_id).cloned()
    }

    pub async fn get_outcomes(&self, market_id: u64) -> Vec<OutcomeRow> {
        self.state
            .read()
            .await
            .outcomes
            .values()
            .filter(|outcome| outcome.market_id == market_id)
            .cloned()
            .collect()
    }

    pub async fn get_ticket(&self, ticket_id: u64) -> Option<TicketRow> {
        self.state.read().await.tickets.get(&ticket_id).cloned()
    }

    pub async fn get_tickets_for_market(&self, market_id: u64) -> Vec<TicketRow> {
        self.state
            .read()
            .await
            .tickets
            .values()
            .filter(|ticket| ticket.market_id == market_id)
            .cloned()
            .collect()
    }

    pub async fn get_canvas(&self, market_id: u64) -> Vec<CanvasObjectRow> {
        let mut rows: Vec<_> = self
            .state
            .read()
            .await
            .canvas_objects
            .values()
            .filter(|object| object.market_id == market_id)
            .cloned()
            .collect();
        rows.sort_by_key(|object| (object.z_index, object.ticket_id));
        rows
    }

    pub async fn get_profile(&self, wallet_address: &str) -> Option<ProfileRow> {
        self.state
            .read()
            .await
            .profiles
            .get(wallet_address)
            .cloned()
    }

    pub async fn upsert_profile(&self, row: ProfileRow) {
        self.state
            .write()
            .await
            .profiles
            .insert(row.wallet_address.clone(), row);
    }

    pub async fn get_cash_balance(&self, wallet_address: &str) -> Option<CashBalanceRow> {
        self.state
            .read()
            .await
            .cash_balances
            .get(wallet_address)
            .cloned()
    }

    pub async fn upsert_cash_balance(&self, row: CashBalanceRow) {
        self.state
            .write()
            .await
            .cash_balances
            .insert(row.wallet_address.clone(), row);
    }

    pub async fn busdc_mint_count_for_day(&self, wallet_address: &str, mint_day: &str) -> u32 {
        self.state
            .read()
            .await
            .busdc_mints
            .values()
            .filter(|row| row.wallet_address == wallet_address && row.mint_day == mint_day)
            .count()
            .try_into()
            .unwrap_or(u32::MAX)
    }

    pub async fn record_busdc_mint(
        &self,
        row: BusdcMintRow,
        daily_limit: u32,
    ) -> Result<(CashBalanceRow, u32), DbError> {
        let mut state = self.state.write().await;
        if state.busdc_mints.contains_key(&row.mint_id) {
            return Err(DbError::Projection("busdc mint already exists".to_owned()));
        }
        let used_today = state
            .busdc_mints
            .values()
            .filter(|mint| {
                mint.wallet_address == row.wallet_address && mint.mint_day == row.mint_day
            })
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        if used_today >= daily_limit {
            return Err(DbError::Projection("busdc mint limit exceeded".to_owned()));
        }

        let current = state
            .cash_balances
            .get(&row.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(row.amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.created_at,
        };
        state.busdc_mints.insert(row.mint_id.clone(), row);
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok((balance, used_today.saturating_add(1)))
    }

    pub async fn get_cash_deposit(&self, signature: &str) -> Option<CashDepositRow> {
        self.state
            .read()
            .await
            .cash_deposits
            .get(signature)
            .cloned()
    }

    pub async fn record_cash_deposit(
        &self,
        row: CashDepositRow,
    ) -> Result<(CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.cash_deposits.get(&row.signature) {
            let balance = state
                .cash_balances
                .get(&existing.wallet_address)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.wallet_address.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            return Ok((balance, false));
        }

        let current = state
            .cash_balances
            .get(&row.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(row.amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.created_at,
        };
        state.cash_deposits.insert(row.signature.clone(), row);
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok((balance, true))
    }

    pub async fn total_cash_balance(&self) -> Result<u128, DbError> {
        self.state
            .read()
            .await
            .cash_balances
            .values()
            .try_fold(0u128, |total, balance| {
                total
                    .checked_add(balance.cash_balance)
                    .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))
            })
    }

    pub async fn reserve_cash_trade(
        &self,
        row: CashTradeReservationRow,
    ) -> Result<CashBalanceRow, DbError> {
        let mut state = self.state.write().await;
        if state.cash_trade_reservations.contains_key(&row.trade_id) {
            return Err(DbError::Projection(
                "cash trade reservation already exists".to_owned(),
            ));
        }

        let current = state
            .cash_balances
            .get(&row.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_sub(row.amount)
            .ok_or_else(|| DbError::Projection("cash balance insufficient".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.updated_at,
        };
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        state
            .cash_trade_reservations
            .insert(row.trade_id.clone(), row);
        Ok(balance)
    }

    pub async fn release_cash_trade_reservation(
        &self,
        trade_id: &str,
    ) -> Result<Option<CashBalanceRow>, DbError> {
        let mut state = self.state.write().await;
        let Some(reservation_snapshot) = state.cash_trade_reservations.get(trade_id).cloned()
        else {
            return Ok(None);
        };
        if reservation_snapshot.released || reservation_snapshot.completed_signature.is_some() {
            return Ok(state
                .cash_balances
                .get(&reservation_snapshot.wallet_address)
                .cloned());
        }

        let now = Utc::now();
        let current = state
            .cash_balances
            .get(&reservation_snapshot.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(reservation_snapshot.amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: reservation_snapshot.wallet_address.clone(),
            cash_balance: next,
            updated_at: now,
        };
        if let Some(reservation) = state.cash_trade_reservations.get_mut(trade_id) {
            reservation.released = true;
            reservation.updated_at = now;
        }
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok(Some(balance))
    }

    pub async fn record_cash_trade(
        &self,
        row: CashTradeRow,
    ) -> Result<(CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.cash_trades.get(&row.signature) {
            let balance = state
                .cash_balances
                .get(&existing.wallet_address)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.wallet_address.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            return Ok((balance, false));
        }

        {
            let reservation = state
                .cash_trade_reservations
                .get_mut(&row.trade_id)
                .ok_or_else(|| {
                    DbError::Projection("cash trade reservation not found".to_owned())
                })?;
            if reservation.wallet_address != row.wallet_address || reservation.amount != row.usdc_in
            {
                return Err(DbError::Projection(
                    "cash trade reservation mismatch".to_owned(),
                ));
            }
            if reservation.released {
                return Err(DbError::Projection(
                    "cash trade reservation released".to_owned(),
                ));
            }
            if reservation.completed_signature.is_some() {
                return Err(DbError::Projection(
                    "cash trade reservation already completed".to_owned(),
                ));
            }
            reservation.completed_signature = Some(row.signature.clone());
            reservation.updated_at = row.created_at;
        }

        let balance = state
            .cash_balances
            .get(&row.wallet_address)
            .cloned()
            .unwrap_or(CashBalanceRow {
                wallet_address: row.wallet_address.clone(),
                cash_balance: 0,
                updated_at: row.created_at,
            });
        let inserted = row.clone();
        state.cash_trades.insert(row.signature.clone(), row);
        insert_ticket_for_cash_trade(&mut state, &inserted)?;
        Ok((balance, true))
    }

    pub async fn insert_cash_bid(&self, row: CashBidRow) -> Result<CashBalanceRow, DbError> {
        let mut state = self.state.write().await;
        if state.cash_bids.contains_key(&row.bid_id) {
            return Err(DbError::Projection("cash bid already exists".to_owned()));
        }
        let current = state
            .cash_balances
            .get(&row.buyer_wallet)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_sub(row.max_usdc)
            .ok_or_else(|| DbError::Projection("cash balance insufficient".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.buyer_wallet.clone(),
            cash_balance: next,
            updated_at: row.updated_at,
        };
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        state.cash_bids.insert(row.bid_id.clone(), row);
        Ok(balance)
    }

    pub async fn cancel_cash_bid(
        &self,
        bid_id: &str,
        buyer_wallet: &str,
    ) -> Result<CashBalanceRow, DbError> {
        let mut state = self.state.write().await;
        let now = Utc::now();
        let bid = state
            .cash_bids
            .get_mut(bid_id)
            .ok_or_else(|| DbError::Projection("cash bid not found".to_owned()))?;
        if bid.buyer_wallet != buyer_wallet {
            return Err(DbError::Projection("cash bid wallet mismatch".to_owned()));
        }
        if bid.status != "active" {
            return Err(DbError::Projection("cash bid is not active".to_owned()));
        }
        let refund = bid.remaining_usdc;
        bid.remaining_usdc = 0;
        bid.status = "cancelled".to_owned();
        bid.updated_at = now;

        let current = state
            .cash_balances
            .get(buyer_wallet)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(refund)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: buyer_wallet.to_owned(),
            cash_balance: next,
            updated_at: now,
        };
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok(balance)
    }

    pub async fn best_cash_bid(
        &self,
        market_id: u64,
        round_id: u64,
        side: &str,
    ) -> Option<CashBidRow> {
        let state = self.state.read().await;
        state
            .cash_bids
            .values()
            .filter(|bid| {
                bid.market_id == market_id
                    && bid.round_id == round_id
                    && bid.side == side
                    && bid.status == "active"
                    && bid.remaining_usdc > 0
            })
            .max_by(|left, right| {
                left.price_per_ticket
                    .cmp(&right.price_per_ticket)
                    .then_with(|| right.created_at.cmp(&left.created_at))
            })
            .cloned()
    }

    pub async fn active_cash_bids(&self, market_id: u64, round_id: u64) -> Vec<CashBidRow> {
        let mut bids: Vec<_> = self
            .state
            .read()
            .await
            .cash_bids
            .values()
            .filter(|bid| {
                bid.market_id == market_id
                    && bid.round_id == round_id
                    && bid.status == "active"
                    && bid.remaining_usdc > 0
            })
            .cloned()
            .collect();
        bids.sort_by(|left, right| {
            right
                .price_per_ticket
                .cmp(&left.price_per_ticket)
                .then_with(|| left.created_at.cmp(&right.created_at))
        });
        bids
    }

    pub async fn listed_cash_asks(&self, market_id: u64, round_id: u64) -> Vec<TicketRow> {
        let state = self.state.read().await;
        let mut asks: Vec<_> = state
            .tickets
            .values()
            .filter(|ticket| {
                ticket.market_id == market_id
                    && !ticket.claimed
                    && matches!(ticket.status, TicketStatus::Listed)
                    && ticket.listed_price.is_some()
                    && ticket_belongs_to_round(&state, ticket.ticket_id, round_id)
            })
            .cloned()
            .collect();
        asks.sort_by(|left, right| {
            left.listed_price
                .cmp(&right.listed_price)
                .then_with(|| left.created_at.cmp(&right.created_at))
        });
        asks
    }

    pub async fn record_cash_resale(
        &self,
        row: CashResaleRow,
    ) -> Result<(CashBalanceRow, CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.cash_resales.get(&row.signature) {
            let seller_balance = state
                .cash_balances
                .get(&existing.seller_wallet)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.seller_wallet.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            let buyer_balance = state
                .cash_balances
                .get(&existing.buyer_wallet)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.buyer_wallet.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            return Ok((seller_balance, buyer_balance, false));
        }

        if let Some(bid_id) = &row.bid_id {
            let bid = state
                .cash_bids
                .get_mut(bid_id)
                .ok_or_else(|| DbError::Projection("cash bid not found".to_owned()))?;
            if bid.buyer_wallet != row.buyer_wallet || bid.remaining_usdc < row.gross_usdc {
                return Err(DbError::Projection("cash bid fill mismatch".to_owned()));
            }
            bid.remaining_usdc -= row.gross_usdc;
            bid.status = if bid.remaining_usdc == 0 {
                "filled".to_owned()
            } else {
                "active".to_owned()
            };
            bid.updated_at = row.created_at;
        } else {
            let buyer_current = state
                .cash_balances
                .get(&row.buyer_wallet)
                .map(|balance| balance.cash_balance)
                .unwrap_or(0);
            let buyer_next = buyer_current
                .checked_sub(row.gross_usdc)
                .ok_or_else(|| DbError::Projection("cash balance insufficient".to_owned()))?;
            state.cash_balances.insert(
                row.buyer_wallet.clone(),
                CashBalanceRow {
                    wallet_address: row.buyer_wallet.clone(),
                    cash_balance: buyer_next,
                    updated_at: row.created_at,
                },
            );
        }

        let seller_current = state
            .cash_balances
            .get(&row.seller_wallet)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let seller_next = seller_current
            .checked_add(row.seller_receives)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        state.cash_balances.insert(
            row.seller_wallet.clone(),
            CashBalanceRow {
                wallet_address: row.seller_wallet.clone(),
                cash_balance: seller_next,
                updated_at: row.created_at,
            },
        );

        apply_cash_resale_to_tickets(&mut state, &row)?;
        state
            .cash_resales
            .insert(row.signature.clone(), row.clone());

        let seller_balance = state
            .cash_balances
            .get(&row.seller_wallet)
            .cloned()
            .expect("seller balance inserted");
        let buyer_balance = state
            .cash_balances
            .get(&row.buyer_wallet)
            .cloned()
            .unwrap_or(CashBalanceRow {
                wallet_address: row.buyer_wallet.clone(),
                cash_balance: 0,
                updated_at: row.created_at,
            });
        Ok((seller_balance, buyer_balance, true))
    }

    pub async fn cash_trade_side_volume(&self, market_id: u64, round_id: u64, side: &str) -> u128 {
        self.state
            .read()
            .await
            .cash_trades
            .values()
            .filter(|row| {
                row.market_id == market_id && row.round_id == round_id && row.side == side
            })
            .fold(0u128, |total, row| total.saturating_add(row.net_usdc))
    }

    pub async fn cash_trade_for_lot(&self, lot_id: u64) -> Option<CashTradeRow> {
        self.state
            .read()
            .await
            .cash_trades
            .values()
            .find(|row| row.lot_id == lot_id)
            .cloned()
    }

    pub async fn cash_resale_for_buyer_lot(&self, lot_id: u64) -> Option<CashResaleRow> {
        self.state
            .read()
            .await
            .cash_resales
            .values()
            .find(|row| row.buyer_lot_id == Some(lot_id))
            .cloned()
    }

    pub async fn backfill_cash_trade_market_ids<F>(&self, infer_market_id: F) -> usize
    where
        F: Fn(&CashTradeRow) -> Option<u64>,
    {
        let mut state = self.state.write().await;
        let mut updates = Vec::new();

        for row in state.cash_trades.values_mut() {
            if row.market_id != 0 {
                continue;
            }
            let Some(market_id) = infer_market_id(row).filter(|market_id| *market_id != 0) else {
                continue;
            };
            row.market_id = market_id;
            updates.push((row.lot_id, market_id));
        }

        for (lot_id, market_id) in &updates {
            if let Some(ticket) = state.tickets.get_mut(lot_id) {
                if ticket.market_id == 0 {
                    ticket.market_id = *market_id;
                }
            }
            if let Some(mut canvas) = state.canvas_objects.remove(&(0, *lot_id)) {
                canvas.market_id = *market_id;
                state.canvas_objects.insert((*market_id, *lot_id), canvas);
            }
        }

        updates.len()
    }

    pub async fn insert_sol_deposit_quote(&self, row: SolDepositQuoteRow) {
        self.state
            .write()
            .await
            .sol_deposit_quotes
            .insert(row.quote_id.clone(), row);
    }

    pub async fn get_sol_deposit_quote(&self, quote_id: &str) -> Option<SolDepositQuoteRow> {
        self.state
            .read()
            .await
            .sol_deposit_quotes
            .get(quote_id)
            .cloned()
    }

    pub async fn get_sol_deposit(&self, signature: &str) -> Option<SolDepositRow> {
        self.state.read().await.sol_deposits.get(signature).cloned()
    }

    pub async fn record_sol_deposit(
        &self,
        row: SolDepositRow,
    ) -> Result<(CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.sol_deposits.get(&row.signature) {
            let balance = state
                .cash_balances
                .get(&existing.wallet_address)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.wallet_address.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            return Ok((balance, false));
        }

        {
            let quote = state
                .sol_deposit_quotes
                .get_mut(&row.quote_id)
                .ok_or_else(|| DbError::Projection("sol deposit quote not found".to_owned()))?;
            if quote.used_signature.is_some() {
                return Err(DbError::Projection(
                    "sol deposit quote already used".to_owned(),
                ));
            }
            quote.used_signature = Some(row.signature.clone());
        }

        let current = state
            .cash_balances
            .get(&row.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(row.cash_amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.created_at,
        };
        state.sol_deposits.insert(row.signature.clone(), row);
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok((balance, true))
    }

    pub async fn insert_transfer_deposit_quote(&self, row: TransferDepositQuoteRow) {
        self.state
            .write()
            .await
            .transfer_deposit_quotes
            .insert(row.quote_id.clone(), row);
    }

    pub async fn get_transfer_deposit_quote(
        &self,
        quote_id: &str,
    ) -> Option<TransferDepositQuoteRow> {
        self.state
            .read()
            .await
            .transfer_deposit_quotes
            .get(quote_id)
            .cloned()
    }

    pub async fn get_transfer_deposit(&self, signature: &str) -> Option<TransferDepositRow> {
        self.state
            .read()
            .await
            .transfer_deposits
            .get(signature)
            .cloned()
    }

    pub async fn record_transfer_deposit(
        &self,
        row: TransferDepositRow,
    ) -> Result<(CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.transfer_deposits.get(&row.signature) {
            let balance = state
                .cash_balances
                .get(&existing.wallet_address)
                .cloned()
                .unwrap_or(CashBalanceRow {
                    wallet_address: existing.wallet_address.clone(),
                    cash_balance: 0,
                    updated_at: existing.created_at,
                });
            return Ok((balance, false));
        }

        {
            let quote = state
                .transfer_deposit_quotes
                .get_mut(&row.quote_id)
                .ok_or_else(|| {
                    DbError::Projection("transfer deposit quote not found".to_owned())
                })?;
            if quote.used_signature.is_some() {
                return Err(DbError::Projection(
                    "transfer deposit quote already used".to_owned(),
                ));
            }
            quote.used_signature = Some(row.signature.clone());
        }

        let current = state
            .cash_balances
            .get(&row.wallet_address)
            .map(|balance| balance.cash_balance)
            .unwrap_or(0);
        let next = current
            .checked_add(row.cash_amount)
            .ok_or_else(|| DbError::Projection("cash balance overflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.created_at,
        };
        state.transfer_deposits.insert(row.signature.clone(), row);
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok((balance, true))
    }

    pub async fn create_share_card(&self, ticket_id: u64) -> Result<ShareCardRow, DbError> {
        if self.get_ticket(ticket_id).await.is_none() {
            return Err(DbError::TicketNotFound(ticket_id));
        }

        let now = Utc::now();
        let row = ShareCardRow {
            id: Uuid::new_v4(),
            ticket_id,
            status: ShareCardStatus::Pending,
            svg_hash: None,
            png_url: None,
            error_message: None,
            created_at: now,
            updated_at: now,
        };
        self.state
            .write()
            .await
            .share_cards
            .insert(row.id, row.clone());
        Ok(row)
    }

    pub async fn get_share_card(&self, id: Uuid) -> Option<ShareCardRow> {
        self.state.read().await.share_cards.get(&id).cloned()
    }

    pub async fn mark_share_card_processing(&self, id: Uuid) -> Result<ShareCardRow, DbError> {
        self.update_share_card(id, ShareCardStatus::Processing, None, None, None)
            .await
    }

    pub async fn mark_share_card_completed(
        &self,
        id: Uuid,
        svg_hash: String,
        png_url: String,
    ) -> Result<ShareCardRow, DbError> {
        self.update_share_card(
            id,
            ShareCardStatus::Completed,
            Some(svg_hash),
            Some(png_url),
            None,
        )
        .await
    }

    pub async fn mark_share_card_failed(
        &self,
        id: Uuid,
        error_message: String,
    ) -> Result<ShareCardRow, DbError> {
        self.update_share_card(id, ShareCardStatus::Failed, None, None, Some(error_message))
            .await
    }

    async fn update_share_card(
        &self,
        id: Uuid,
        status: ShareCardStatus,
        svg_hash: Option<String>,
        png_url: Option<String>,
        error_message: Option<String>,
    ) -> Result<ShareCardRow, DbError> {
        let mut state = self.state.write().await;
        let row = state
            .share_cards
            .get_mut(&id)
            .ok_or(DbError::ShareCardNotFound(id))?;
        row.status = status;
        if svg_hash.is_some() {
            row.svg_hash = svg_hash;
        }
        if png_url.is_some() {
            row.png_url = png_url;
        }
        row.error_message = error_message;
        row.updated_at = Utc::now();
        Ok(row.clone())
    }

    pub(crate) async fn insert_market(&self, row: MarketRow, outcomes: Vec<OutcomeRow>) {
        let mut state = self.state.write().await;
        state.markets.insert(row.market_id, row);
        for outcome in outcomes {
            state
                .outcomes
                .insert((outcome.market_id, outcome.outcome_id), outcome);
        }
    }

    pub(crate) async fn insert_ticket(
        &self,
        row: TicketRow,
        meta: &EventMeta,
    ) -> Result<(), DbError> {
        let mut state = self.state.write().await;
        if !state.markets.contains_key(&row.market_id) {
            return Err(DbError::MarketNotFound(row.market_id));
        }

        let outcome = state
            .outcomes
            .get_mut(&(row.market_id, row.outcome_id))
            .ok_or_else(|| DbError::Projection(format!("outcome {} not found", row.outcome_id)))?;
        outcome.total_stake = outcome
            .total_stake
            .checked_add(row.stake_amount)
            .ok_or_else(|| DbError::Projection("outcome total stake overflow".to_owned()))?;
        outcome.total_reward_shares = outcome
            .total_reward_shares
            .checked_add(row.reward_shares)
            .ok_or_else(|| DbError::Projection("outcome reward share overflow".to_owned()))?;
        outcome.current_odds = row.entry_odds;

        state.positions.push(PositionHistoryRow {
            wallet_address: row.current_owner.clone(),
            market_id: row.market_id,
            ticket_id: row.ticket_id,
            action: "mint".to_owned(),
            outcome_id: row.outcome_id,
            amount: row.stake_amount,
            slot: meta.slot,
            created_at: row.created_at,
        });
        insert_canvas_object(&mut state, &row);
        state.tickets.insert(row.ticket_id, row);
        Ok(())
    }

    pub async fn list_ticket(
        &self,
        ticket_id: u64,
        price: u128,
        meta: &EventMeta,
    ) -> Result<u64, DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);
        let ticket = state
            .tickets
            .get_mut(&ticket_id)
            .ok_or(DbError::TicketNotFound(ticket_id))?;
        ticket.status = TicketStatus::Listed;
        ticket.listed_price = Some(price);
        ticket.updated_at = projected_at;
        let market_id = ticket.market_id;

        if let Some(canvas) = state.canvas_objects.get_mut(&(market_id, ticket_id)) {
            canvas.listed = true;
            canvas.updated_at = projected_at;
        }

        Ok(market_id)
    }

    pub async fn cancel_ticket_listing(
        &self,
        ticket_id: u64,
        meta: &EventMeta,
    ) -> Result<u64, DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);
        let ticket = state
            .tickets
            .get_mut(&ticket_id)
            .ok_or(DbError::TicketNotFound(ticket_id))?;
        ticket.status = TicketStatus::Active;
        ticket.listed_price = None;
        ticket.updated_at = projected_at;
        let market_id = ticket.market_id;

        if let Some(canvas) = state.canvas_objects.get_mut(&(market_id, ticket_id)) {
            canvas.listed = false;
            canvas.updated_at = projected_at;
        }

        Ok(market_id)
    }

    pub async fn sell_ticket(
        &self,
        ticket_id: u64,
        from: String,
        to: String,
        price: u128,
        meta: &EventMeta,
    ) -> Result<u64, DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);
        let ticket = state
            .tickets
            .get_mut(&ticket_id)
            .ok_or(DbError::TicketNotFound(ticket_id))?;
        ticket.current_owner = to.clone();
        ticket.status = TicketStatus::Active;
        ticket.listed_price = None;
        ticket.updated_at = projected_at;
        let market_id = ticket.market_id;

        state.transfers.push(TicketTransferRow {
            ticket_id,
            from_address: from,
            to_address: to.clone(),
            price,
            slot: meta.slot,
            signature: meta.signature.clone(),
            created_at: projected_at,
        });

        if let Some(canvas) = state.canvas_objects.get_mut(&(market_id, ticket_id)) {
            canvas.current_owner = to;
            canvas.listed = false;
            canvas.updated_at = projected_at;
        }

        Ok(market_id)
    }

    pub(crate) async fn close_market(
        &self,
        market_id: u64,
        meta: &EventMeta,
    ) -> Result<(), DbError> {
        let mut state = self.state.write().await;
        let market = state
            .markets
            .get_mut(&market_id)
            .ok_or(DbError::MarketNotFound(market_id))?;
        market.status = MarketStatus::Closed;
        market.updated_at = projected_at(meta);
        Ok(())
    }

    pub(crate) async fn resolve_market(
        &self,
        market_id: u64,
        winning_outcome: u8,
        meta: &EventMeta,
    ) -> Result<(), DbError> {
        self.resolve_market_inner(market_id, winning_outcome, None, meta)
            .await
    }

    pub(crate) async fn resolve_market_with_payout(
        &self,
        market_id: u64,
        winning_outcome: u8,
        payout_per_ticket: u128,
        meta: &EventMeta,
    ) -> Result<(), DbError> {
        self.resolve_market_inner(market_id, winning_outcome, Some(payout_per_ticket), meta)
            .await
    }

    async fn resolve_market_inner(
        &self,
        market_id: u64,
        winning_outcome: u8,
        payout_per_ticket: Option<u128>,
        meta: &EventMeta,
    ) -> Result<(), DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);
        let market = state
            .markets
            .get_mut(&market_id)
            .ok_or(DbError::MarketNotFound(market_id))?;
        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(winning_outcome);
        market.updated_at = projected_at;

        for ticket in state
            .tickets
            .values_mut()
            .filter(|ticket| ticket.market_id == market_id)
        {
            ticket.status = if ticket.outcome_id == winning_outcome {
                TicketStatus::Claimable
            } else {
                TicketStatus::Lost
            };
            ticket.settlement_value_usdc =
                match (ticket.outcome_id == winning_outcome, payout_per_ticket) {
                    (true, Some(payout_per_ticket)) => {
                        Some(entry_total(payout_per_ticket, ticket.reward_shares)?)
                    }
                    (false, Some(_)) => Some(0),
                    _ => ticket.settlement_value_usdc,
                };
            ticket.updated_at = projected_at;
        }
        Ok(())
    }

    pub(crate) async fn claim_payout(
        &self,
        ticket_id: u64,
        claimer: String,
        amount: u128,
        meta: &EventMeta,
    ) -> Result<u64, DbError> {
        let mut state = self.state.write().await;
        let projected_at = projected_at(meta);
        let ticket = state
            .tickets
            .get_mut(&ticket_id)
            .ok_or(DbError::TicketNotFound(ticket_id))?;
        ticket.claimed = true;
        ticket.status = TicketStatus::Claimed;
        ticket.updated_at = projected_at;
        let market_id = ticket.market_id;
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
        Ok(market_id)
    }
}

fn insert_ticket_for_cash_trade(
    state: &mut ProjectionState,
    row: &CashTradeRow,
) -> Result<(), DbError> {
    if state.tickets.contains_key(&row.lot_id) {
        return Ok(());
    }
    let outcome_id = side_to_outcome_id(&row.side)?;
    let entry_odds = if row.tickets_out == 0 {
        0
    } else {
        row.net_usdc
            .checked_mul(SCALE)
            .and_then(|value| value.checked_div(row.tickets_out))
            .ok_or_else(|| DbError::Projection("cash trade entry overflow".to_owned()))?
    };
    let ticket = TicketRow {
        ticket_id: row.lot_id,
        market_id: row.market_id,
        outcome_id,
        original_caller: row.wallet_address.clone(),
        current_owner: row.wallet_address.clone(),
        stake_amount: row.tickets_out,
        reward_shares: row.tickets_out,
        entry_odds,
        cost_basis_usdc: row.usdc_in,
        settlement_value_usdc: None,
        listed_price: None,
        status: TicketStatus::Active,
        claimed: false,
        confidence: 75,
        mood: if row.side == "UP" { 1 } else { 2 },
        created_slot: 0,
        created_at: row.created_at,
        updated_at: row.created_at,
    };
    insert_canvas_object(state, &ticket);
    state.tickets.insert(ticket.ticket_id, ticket);
    Ok(())
}

fn ticket_belongs_to_round(state: &ProjectionState, lot_id: u64, round_id: u64) -> bool {
    state
        .cash_trades
        .values()
        .any(|row| row.lot_id == lot_id && row.round_id == round_id)
        || state
            .cash_resales
            .values()
            .any(|row| row.buyer_lot_id == Some(lot_id) && row.round_id == round_id)
}

fn apply_cash_resale_to_tickets(
    state: &mut ProjectionState,
    row: &CashResaleRow,
) -> Result<(), DbError> {
    let projected_at = row.created_at;
    let ticket = state
        .tickets
        .get_mut(&row.source_lot_id)
        .ok_or(DbError::TicketNotFound(row.source_lot_id))?;
    if ticket.current_owner != row.seller_wallet {
        return Err(DbError::Projection("seller does not own ticket".to_owned()));
    }
    if ticket.claimed {
        return Err(DbError::Projection("ticket is already claimed".to_owned()));
    }
    if ticket.stake_amount < row.tickets_sold {
        return Err(DbError::Projection("ticket amount underflow".to_owned()));
    }

    if let Some(buyer_lot_id) = row.buyer_lot_id {
        let original_amount = ticket.stake_amount;
        let remaining = ticket
            .stake_amount
            .checked_sub(row.tickets_sold)
            .ok_or_else(|| DbError::Projection("ticket amount underflow".to_owned()))?;
        let remaining_cost_basis =
            prorated_amount(ticket.cost_basis_usdc, remaining, original_amount)?;
        ticket.stake_amount = remaining;
        ticket.reward_shares = ticket.reward_shares.min(remaining);
        ticket.cost_basis_usdc = remaining_cost_basis;
        ticket.entry_odds = entry_price(remaining_cost_basis, remaining)?;
        ticket.listed_price = None;
        ticket.status = if remaining == 0 {
            TicketStatus::Cancelled
        } else {
            TicketStatus::Active
        };
        ticket.updated_at = projected_at;

        let new_ticket = TicketRow {
            ticket_id: buyer_lot_id,
            market_id: row.market_id,
            outcome_id: ticket.outcome_id,
            original_caller: ticket.original_caller.clone(),
            current_owner: row.buyer_wallet.clone(),
            stake_amount: row.tickets_sold,
            reward_shares: row.tickets_sold,
            entry_odds: entry_price(row.gross_usdc, row.tickets_sold)?,
            cost_basis_usdc: row.gross_usdc,
            settlement_value_usdc: None,
            listed_price: None,
            status: TicketStatus::Active,
            claimed: false,
            confidence: ticket.confidence,
            mood: ticket.mood,
            created_slot: 0,
            created_at: projected_at,
            updated_at: projected_at,
        };
        insert_canvas_object(state, &new_ticket);
        state.tickets.insert(new_ticket.ticket_id, new_ticket);
    } else {
        ticket.current_owner = row.buyer_wallet.clone();
        ticket.cost_basis_usdc = row.gross_usdc;
        ticket.entry_odds = entry_price(row.gross_usdc, ticket.stake_amount)?;
        ticket.listed_price = None;
        ticket.status = TicketStatus::Active;
        ticket.updated_at = projected_at;
    }

    state.transfers.push(TicketTransferRow {
        ticket_id: row.source_lot_id,
        from_address: row.seller_wallet.clone(),
        to_address: row.buyer_wallet.clone(),
        price: row.gross_usdc,
        slot: 0,
        signature: row.signature.clone(),
        created_at: projected_at,
    });

    if let Some(canvas) = state
        .canvas_objects
        .get_mut(&(row.market_id, row.source_lot_id))
    {
        canvas.current_owner = if row.buyer_lot_id.is_some() {
            row.seller_wallet.clone()
        } else {
            row.buyer_wallet.clone()
        };
        canvas.listed = false;
        canvas.updated_at = projected_at;
    }
    Ok(())
}

fn insert_canvas_object(state: &mut ProjectionState, ticket: &TicketRow) {
    let (x, y, z_index) = canvas_layout_for_ticket(ticket.ticket_id);
    state.canvas_objects.insert(
        (ticket.market_id, ticket.ticket_id),
        CanvasObjectRow {
            market_id: ticket.market_id,
            ticket_id: ticket.ticket_id,
            x,
            y,
            radius: 22 + (ticket.confidence.min(100) / 10),
            avatar_url: None,
            mood: ticket.mood,
            confidence: ticket.confidence,
            listed: ticket.listed_price.is_some(),
            current_owner: ticket.current_owner.clone(),
            original_caller: ticket.original_caller.clone(),
            z_index,
            updated_at: ticket.updated_at,
        },
    );
}

fn canvas_layout_for_ticket(ticket_id: u64) -> (i32, i32, i32) {
    const X_OFFSET: i32 = 96;
    const X_SPAN: u64 = 960;
    const Y_OFFSET: i32 = 300;
    const Y_SPAN: u64 = 240;

    let x = X_OFFSET + (((ticket_id % X_SPAN) * 53) % X_SPAN) as i32;
    let y = Y_OFFSET + (((ticket_id % Y_SPAN) * 37) % Y_SPAN) as i32;
    let z_index = (ticket_id % i32::MAX as u64) as i32;

    (x, y, z_index)
}

fn side_to_outcome_id(side: &str) -> Result<u8, DbError> {
    match side {
        "UP" => Ok(0),
        "DOWN" => Ok(1),
        _ => Err(DbError::Projection("invalid cash trade side".to_owned())),
    }
}

fn entry_price(usdc: u128, tickets: u128) -> Result<u128, DbError> {
    if tickets == 0 {
        return Ok(0);
    }
    usdc.checked_mul(SCALE)
        .and_then(|value| value.checked_div(tickets))
        .ok_or_else(|| DbError::Projection("entry price overflow".to_owned()))
}

fn entry_total(price: u128, tickets: u128) -> Result<u128, DbError> {
    price
        .checked_mul(tickets)
        .and_then(|value| value.checked_div(SCALE))
        .ok_or_else(|| DbError::Projection("entry total overflow".to_owned()))
}

fn prorated_amount(amount: u128, numerator: u128, denominator: u128) -> Result<u128, DbError> {
    if denominator == 0 || numerator == 0 || amount == 0 {
        return Ok(0);
    }
    amount
        .checked_mul(numerator)
        .and_then(|value| value.checked_div(denominator))
        .ok_or_else(|| DbError::Projection("prorated amount overflow".to_owned()))
}
