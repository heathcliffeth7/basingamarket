use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::{
    memory::rebuild_cash_ticket_projection_from_snapshot, BusdcMintRow, CashBalanceRow, CashBidRow,
    CashDepositRow, CashResaleRow, CashTradeReservationRow, CashTradeRow, CashWithdrawalQuoteRow,
    CashWithdrawalRow, DbError, InMemoryProjectionStore, PayoutClaimRow, SolDepositQuoteRow,
    SolDepositRow, TransferDepositQuoteRow, TransferDepositRow,
};

const CASH_PROJECTION_SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashProjectionSnapshot {
    pub version: u32,
    pub cash_balances: Vec<CashBalanceRow>,
    #[serde(default)]
    pub busdc_mints: Vec<BusdcMintRow>,
    #[serde(default)]
    pub cash_trade_reservations: Vec<CashTradeReservationRow>,
    #[serde(default)]
    pub cash_trades: Vec<CashTradeRow>,
    #[serde(default)]
    pub cash_bids: Vec<CashBidRow>,
    #[serde(default)]
    pub cash_resales: Vec<CashResaleRow>,
    #[serde(default)]
    pub payout_claims: Vec<PayoutClaimRow>,
    pub cash_deposits: Vec<CashDepositRow>,
    pub sol_deposit_quotes: Vec<SolDepositQuoteRow>,
    pub sol_deposits: Vec<SolDepositRow>,
    pub transfer_deposit_quotes: Vec<TransferDepositQuoteRow>,
    pub transfer_deposits: Vec<TransferDepositRow>,
    pub cash_withdrawal_quotes: Vec<CashWithdrawalQuoteRow>,
    pub cash_withdrawals: Vec<CashWithdrawalRow>,
}

impl InMemoryProjectionStore {
    pub async fn cash_projection_snapshot(&self) -> CashProjectionSnapshot {
        let state = self.state.read().await;
        CashProjectionSnapshot {
            version: CASH_PROJECTION_SNAPSHOT_VERSION,
            cash_balances: state.cash_balances.values().cloned().collect(),
            busdc_mints: state.busdc_mints.values().cloned().collect(),
            cash_trade_reservations: state.cash_trade_reservations.values().cloned().collect(),
            cash_trades: state.cash_trades.values().cloned().collect(),
            cash_bids: state.cash_bids.values().cloned().collect(),
            cash_resales: state.cash_resales.values().cloned().collect(),
            payout_claims: state.payout_claims.values().cloned().collect(),
            cash_deposits: state.cash_deposits.values().cloned().collect(),
            sol_deposit_quotes: state.sol_deposit_quotes.values().cloned().collect(),
            sol_deposits: state.sol_deposits.values().cloned().collect(),
            transfer_deposit_quotes: state.transfer_deposit_quotes.values().cloned().collect(),
            transfer_deposits: state.transfer_deposits.values().cloned().collect(),
            cash_withdrawal_quotes: state.cash_withdrawal_quotes.values().cloned().collect(),
            cash_withdrawals: state.cash_withdrawals.values().cloned().collect(),
        }
    }

    pub async fn replace_cash_projection_snapshot(
        &self,
        snapshot: CashProjectionSnapshot,
    ) -> Result<(), DbError> {
        let mut state = self.state.write().await;
        state.cash_balances = snapshot
            .cash_balances
            .into_iter()
            .map(|row| (row.wallet_address.clone(), row))
            .collect();
        state.busdc_mints = snapshot
            .busdc_mints
            .into_iter()
            .map(|row| (row.mint_id.clone(), row))
            .collect();
        state.cash_trade_reservations = snapshot
            .cash_trade_reservations
            .into_iter()
            .map(|row| (row.trade_id.clone(), row))
            .collect();
        state.cash_trades = snapshot
            .cash_trades
            .into_iter()
            .map(|row| (row.signature.clone(), row))
            .collect();
        state.cash_bids = snapshot
            .cash_bids
            .into_iter()
            .map(|row| (row.bid_id.clone(), row))
            .collect();
        state.cash_resales = snapshot
            .cash_resales
            .into_iter()
            .map(|row| (row.signature.clone(), row))
            .collect();
        state.payout_claims = snapshot
            .payout_claims
            .into_iter()
            .map(|row| (row.ticket_id, row))
            .collect();
        state.cash_deposits = snapshot
            .cash_deposits
            .into_iter()
            .map(|row| (row.signature.clone(), row))
            .collect();
        state.sol_deposit_quotes = snapshot
            .sol_deposit_quotes
            .into_iter()
            .map(|row| (row.quote_id.clone(), row))
            .collect();
        state.sol_deposits = snapshot
            .sol_deposits
            .into_iter()
            .map(|row| (row.signature.clone(), row))
            .collect();
        state.transfer_deposit_quotes = snapshot
            .transfer_deposit_quotes
            .into_iter()
            .map(|row| (row.quote_id.clone(), row))
            .collect();
        state.transfer_deposits = snapshot
            .transfer_deposits
            .into_iter()
            .map(|row| (row.signature.clone(), row))
            .collect();
        state.cash_withdrawal_quotes = snapshot
            .cash_withdrawal_quotes
            .into_iter()
            .map(|row| (row.quote_id.clone(), row))
            .collect();
        state.cash_withdrawals = snapshot
            .cash_withdrawals
            .into_iter()
            .map(|row| (row.vault_signature.clone(), row))
            .collect();
        rebuild_cash_ticket_projection_from_snapshot(&mut state)?;
        Ok(())
    }

    pub async fn load_cash_projection_snapshot(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<bool, DbError> {
        let bytes = match fs::read(path.as_ref()).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        let snapshot = serde_json::from_slice::<CashProjectionSnapshot>(&bytes)?;
        self.replace_cash_projection_snapshot(snapshot).await?;
        Ok(true)
    }

    pub async fn save_cash_projection_snapshot(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<(), DbError> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).await?;
        }

        let snapshot = self.cash_projection_snapshot().await;
        let bytes = serde_json::to_vec_pretty(&snapshot)?;
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| DbError::Projection("cash snapshot path has no file name".to_owned()))?;
        let tmp_path = path.with_file_name(format!(".{file_name}.tmp"));
        fs::write(&tmp_path, bytes).await?;
        fs::rename(&tmp_path, path).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventMeta;
    use basingamarket_domain::TicketStatus;
    use chrono::Utc;
    use uuid::Uuid;

    const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const TEST_TREASURY: &str = "So11111111111111111111111111111111111111112";

    #[tokio::test]
    async fn cash_projection_snapshot_round_trips_cash_ledgers() {
        let path = std::env::temp_dir().join(format!(
            "basingamarket-cash-projection-{}.json",
            Uuid::new_v4()
        ));
        let store = InMemoryProjectionStore::default();
        store
            .insert_sol_deposit_quote(SolDepositQuoteRow {
                quote_id: "quote-1".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                cash_amount: 5_000_000,
                lamports: 33_333_333,
                price: 150_000_000,
                treasury: TEST_TREASURY.to_owned(),
                expires_at: Utc::now() + chrono::Duration::seconds(60),
                used_signature: None,
                created_at: Utc::now(),
            })
            .await;
        store
            .record_sol_deposit(SolDepositRow {
                wallet_address: TEST_OWNER.to_owned(),
                signature: "sol-deposit-signature".to_owned(),
                quote_id: "quote-1".to_owned(),
                treasury: TEST_TREASURY.to_owned(),
                lamports: 33_333_333,
                cash_amount: 5_000_000,
                price: 150_000_000,
                slot: 42,
                created_at: Utc::now(),
            })
            .await
            .unwrap();

        store.save_cash_projection_snapshot(&path).await.unwrap();
        let reloaded = InMemoryProjectionStore::default();
        assert!(reloaded.load_cash_projection_snapshot(&path).await.unwrap());

        assert_eq!(
            reloaded
                .get_cash_balance(TEST_OWNER)
                .await
                .unwrap()
                .cash_balance,
            5_000_000
        );
        assert!(reloaded
            .get_sol_deposit("sol-deposit-signature")
            .await
            .is_some());
        assert_eq!(reloaded.total_cash_balance().await.unwrap(), 5_000_000);

        let _ = fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn cash_trade_snapshot_round_trips_market_id() {
        let path = std::env::temp_dir().join(format!(
            "basingamarket-cash-trade-projection-{}.json",
            Uuid::new_v4()
        ));
        let store = InMemoryProjectionStore::default();
        let now = Utc::now();
        store
            .upsert_cash_balance(CashBalanceRow {
                wallet_address: TEST_OWNER.to_owned(),
                cash_balance: 5_000_000,
                updated_at: now,
            })
            .await;
        store
            .reserve_cash_trade(CashTradeReservationRow {
                trade_id: "trade-1".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                amount: 1_000_000,
                released: false,
                completed_signature: None,
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        store
            .record_cash_trade(CashTradeRow {
                trade_id: "trade-1".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                signature: "cash-buy-signature".to_owned(),
                mint: TEST_OWNER.to_owned(),
                vault_token_account: TEST_TREASURY.to_owned(),
                market_id: 1,
                round_id: 5928349,
                position_lot: "lot".to_owned(),
                lot_id: 42,
                side: "UP".to_owned(),
                usdc_in: 1_000_000,
                fee_usdc: 5_000,
                net_usdc: 995_000,
                tickets_out: 1_900_000,
                created_at: now,
            })
            .await
            .unwrap();

        store.save_cash_projection_snapshot(&path).await.unwrap();
        let reloaded = InMemoryProjectionStore::default();
        assert!(reloaded.load_cash_projection_snapshot(&path).await.unwrap());
        let snapshot = reloaded.cash_projection_snapshot().await;

        assert_eq!(snapshot.cash_trades[0].market_id, 1);
        assert_eq!(
            reloaded.cash_trade_side_volume(1, 5928349, "UP").await,
            995_000
        );
        assert_eq!(reloaded.cash_trade_side_volume(2, 5928349, "UP").await, 0);
        let ticket = reloaded.get_ticket(42).await.unwrap();
        assert_eq!(ticket.market_id, 1);
        assert_eq!(ticket.round_id, 5928349);
        assert_eq!(ticket.current_owner, TEST_OWNER);
        assert_eq!(ticket.reward_shares, 1_900_000);

        let _ = fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn cash_snapshot_preserves_claim_idempotency() {
        let path = std::env::temp_dir().join(format!(
            "basingamarket-cash-claim-projection-{}.json",
            Uuid::new_v4()
        ));
        let store = InMemoryProjectionStore::default();
        let now = Utc::now();
        store
            .upsert_cash_balance(CashBalanceRow {
                wallet_address: TEST_OWNER.to_owned(),
                cash_balance: 1_000_000,
                updated_at: now,
            })
            .await;
        store
            .reserve_cash_trade(CashTradeReservationRow {
                trade_id: "trade-claim".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                amount: 1_000_000,
                released: false,
                completed_signature: None,
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        store
            .record_cash_trade(CashTradeRow {
                trade_id: "trade-claim".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                signature: "cash-buy-claim".to_owned(),
                mint: TEST_OWNER.to_owned(),
                vault_token_account: TEST_TREASURY.to_owned(),
                market_id: 1,
                round_id: 5928474,
                position_lot: "lot-claim".to_owned(),
                lot_id: 77,
                side: "UP".to_owned(),
                usdc_in: 1_000_000,
                fee_usdc: 5_000,
                net_usdc: 995_000,
                tickets_out: 1_900_000,
                created_at: now,
            })
            .await
            .unwrap();
        store
            .claim_ticket_to_cash(
                77,
                TEST_OWNER.to_owned(),
                995_000,
                &EventMeta::fixture(8, 0),
            )
            .await
            .unwrap();

        store.save_cash_projection_snapshot(&path).await.unwrap();
        let reloaded = InMemoryProjectionStore::default();
        assert!(reloaded.load_cash_projection_snapshot(&path).await.unwrap());
        let ticket = reloaded.get_ticket(77).await.unwrap();
        assert!(ticket.claimed);
        assert_eq!(ticket.status, TicketStatus::Claimed);
        assert_eq!(ticket.settlement_value_usdc, Some(995_000));
        let duplicate = reloaded
            .claim_ticket_to_cash(
                77,
                TEST_OWNER.to_owned(),
                995_000,
                &EventMeta::fixture(9, 0),
            )
            .await
            .unwrap();
        assert!(!duplicate.credited);

        let _ = fs::remove_file(path).await;
    }

    #[test]
    fn old_withdrawal_snapshot_rows_can_omit_destination_wallet() {
        let quote: CashWithdrawalQuoteRow = serde_json::from_str(
            r#"{
                "quote_id": "withdraw-quote-1",
                "wallet_address": "wallet",
                "destination_token_account": "ata",
                "cash_amount": 1000000,
                "message": "message",
                "expires_at": "2026-05-10T00:00:00Z",
                "used_user_signature": null,
                "created_at": "2026-05-10T00:00:00Z"
            }"#,
        )
        .unwrap();
        let withdrawal: CashWithdrawalRow = serde_json::from_str(
            r#"{
                "wallet_address": "wallet",
                "quote_id": "withdraw-quote-1",
                "user_signature": "user-signature",
                "vault_signature": "vault-signature",
                "mint": "mint",
                "vault_token_account": "vault",
                "destination_token_account": "ata",
                "amount": 1000000,
                "created_at": "2026-05-10T00:00:00Z"
            }"#,
        )
        .unwrap();

        assert_eq!(quote.destination_wallet, None);
        assert_eq!(withdrawal.destination_wallet, None);
    }

    #[test]
    fn legacy_cash_trade_snapshot_rows_can_omit_market_id() {
        let snapshot: CashProjectionSnapshot = serde_json::from_str(
            r#"{
                "version": 1,
                "cash_balances": [],
                "cash_trade_reservations": [],
                "cash_trades": [{
                    "trade_id": "trade-1",
                    "wallet_address": "wallet",
                    "signature": "cash-buy-signature",
                    "mint": "mint",
                    "vault_token_account": "vault",
                    "round_id": 5928349,
                    "position_lot": "lot",
                    "lot_id": 42,
                    "side": "UP",
                    "usdc_in": 1000000,
                    "fee_usdc": 5000,
                    "net_usdc": 995000,
                    "tickets_out": 1900000,
                    "created_at": "2026-05-10T00:00:00Z"
                }],
                "cash_deposits": [],
                "sol_deposit_quotes": [],
                "sol_deposits": [],
                "transfer_deposit_quotes": [],
                "transfer_deposits": [],
                "cash_withdrawal_quotes": [],
                "cash_withdrawals": []
            }"#,
        )
        .unwrap();

        assert_eq!(snapshot.cash_trades[0].market_id, 0);
    }

    #[tokio::test]
    async fn legacy_cash_trade_market_id_can_be_backfilled() {
        let mut snapshot: CashProjectionSnapshot = serde_json::from_str(
            r#"{
                "version": 1,
                "cash_balances": [],
                "cash_trade_reservations": [],
                "cash_trades": [{
                    "trade_id": "trade-1",
                    "wallet_address": "wallet",
                    "signature": "cash-buy-signature",
                    "mint": "mint",
                    "vault_token_account": "vault",
                    "round_id": 5928349,
                    "position_lot": "known-lot-pda",
                    "lot_id": 42,
                    "side": "UP",
                    "usdc_in": 1000000,
                    "fee_usdc": 5000,
                    "net_usdc": 995000,
                    "tickets_out": 1900000,
                    "created_at": "2026-05-10T00:00:00Z"
                }],
                "cash_deposits": [],
                "sol_deposit_quotes": [],
                "sol_deposits": [],
                "transfer_deposit_quotes": [],
                "transfer_deposits": [],
                "cash_withdrawal_quotes": [],
                "cash_withdrawals": []
            }"#,
        )
        .unwrap();
        snapshot.cash_trades[0].market_id = 0;
        let store = InMemoryProjectionStore::default();
        store
            .replace_cash_projection_snapshot(snapshot)
            .await
            .unwrap();

        assert_eq!(store.cash_trade_side_volume(1, 5928349, "UP").await, 0);
        let count = store
            .backfill_cash_trade_market_ids(|row| {
                (row.position_lot == "known-lot-pda").then_some(1)
            })
            .await;

        assert_eq!(count, 1);
        assert_eq!(
            store.cash_trade_side_volume(1, 5928349, "UP").await,
            995_000
        );
    }
}
