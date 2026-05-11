use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{CashBalanceRow, DbError, InMemoryProjectionStore};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashWithdrawalQuoteRow {
    pub quote_id: String,
    pub wallet_address: String,
    #[serde(default)]
    pub destination_wallet: Option<String>,
    pub destination_token_account: String,
    pub cash_amount: u128,
    pub message: String,
    pub expires_at: DateTime<Utc>,
    pub used_user_signature: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashWithdrawalRow {
    pub wallet_address: String,
    #[serde(default)]
    pub destination_wallet: Option<String>,
    pub quote_id: String,
    pub user_signature: String,
    pub vault_signature: String,
    pub mint: String,
    pub vault_token_account: String,
    pub destination_token_account: String,
    pub amount: u128,
    pub created_at: DateTime<Utc>,
}

impl InMemoryProjectionStore {
    pub async fn insert_cash_withdrawal_quote(&self, row: CashWithdrawalQuoteRow) {
        self.state
            .write()
            .await
            .cash_withdrawal_quotes
            .insert(row.quote_id.clone(), row);
    }

    pub async fn get_cash_withdrawal_quote(
        &self,
        quote_id: &str,
    ) -> Option<CashWithdrawalQuoteRow> {
        self.state
            .read()
            .await
            .cash_withdrawal_quotes
            .get(quote_id)
            .cloned()
    }

    pub async fn get_cash_withdrawal_by_quote(&self, quote_id: &str) -> Option<CashWithdrawalRow> {
        self.state
            .read()
            .await
            .cash_withdrawals
            .values()
            .find(|withdrawal| withdrawal.quote_id == quote_id)
            .cloned()
    }

    pub async fn latest_cash_withdrawal(&self, wallet_address: &str) -> Option<CashWithdrawalRow> {
        self.state
            .read()
            .await
            .cash_withdrawals
            .values()
            .filter(|withdrawal| withdrawal.wallet_address == wallet_address)
            .max_by_key(|withdrawal| withdrawal.created_at)
            .cloned()
    }

    pub async fn reserve_cash_withdrawal_quote(
        &self,
        quote_id: &str,
        user_signature: &str,
    ) -> Result<bool, DbError> {
        let mut state = self.state.write().await;
        let quote = state
            .cash_withdrawal_quotes
            .get_mut(quote_id)
            .ok_or_else(|| DbError::Projection("cash withdrawal quote not found".to_owned()))?;
        match quote.used_user_signature.as_deref() {
            Some(existing) if existing == user_signature => Ok(false),
            Some(_) => Err(DbError::Projection(
                "cash withdrawal quote already used".to_owned(),
            )),
            None => {
                quote.used_user_signature = Some(user_signature.to_owned());
                Ok(true)
            }
        }
    }

    pub async fn record_cash_withdrawal(
        &self,
        row: CashWithdrawalRow,
    ) -> Result<(CashBalanceRow, bool), DbError> {
        let mut state = self.state.write().await;
        if let Some(existing) = state.cash_withdrawals.get(&row.vault_signature) {
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
            .checked_sub(row.amount)
            .ok_or_else(|| DbError::Projection("cash balance underflow".to_owned()))?;
        let balance = CashBalanceRow {
            wallet_address: row.wallet_address.clone(),
            cash_balance: next,
            updated_at: row.created_at,
        };
        state
            .cash_withdrawals
            .insert(row.vault_signature.clone(), row);
        state
            .cash_balances
            .insert(balance.wallet_address.clone(), balance.clone());
        Ok((balance, true))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

    #[tokio::test]
    async fn cash_withdrawal_reserves_quote_and_debits_once() {
        let store = InMemoryProjectionStore::default();
        store
            .upsert_cash_balance(CashBalanceRow {
                wallet_address: TEST_OWNER.to_owned(),
                cash_balance: 2_000_000,
                updated_at: Utc::now(),
            })
            .await;
        store
            .insert_cash_withdrawal_quote(CashWithdrawalQuoteRow {
                quote_id: "withdraw-quote-1".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                destination_wallet: Some(TEST_OWNER.to_owned()),
                destination_token_account: TEST_OWNER.to_owned(),
                cash_amount: 1_000_000,
                message: "withdraw message".to_owned(),
                expires_at: Utc::now() + chrono::Duration::seconds(60),
                used_user_signature: None,
                created_at: Utc::now(),
            })
            .await;

        assert!(store
            .reserve_cash_withdrawal_quote("withdraw-quote-1", "user-signature")
            .await
            .unwrap());
        assert!(!store
            .reserve_cash_withdrawal_quote("withdraw-quote-1", "user-signature")
            .await
            .unwrap());

        let row = CashWithdrawalRow {
            wallet_address: TEST_OWNER.to_owned(),
            destination_wallet: Some(TEST_OWNER.to_owned()),
            quote_id: "withdraw-quote-1".to_owned(),
            user_signature: "user-signature".to_owned(),
            vault_signature: "vault-signature".to_owned(),
            mint: TEST_OWNER.to_owned(),
            vault_token_account: TEST_OWNER.to_owned(),
            destination_token_account: TEST_OWNER.to_owned(),
            amount: 1_000_000,
            created_at: Utc::now(),
        };
        let (balance, debited) = store.record_cash_withdrawal(row.clone()).await.unwrap();
        assert!(debited);
        assert_eq!(balance.cash_balance, 1_000_000);
        assert_eq!(store.total_cash_balance().await.unwrap(), 1_000_000);

        let (balance, debited) = store.record_cash_withdrawal(row).await.unwrap();
        assert!(!debited);
        assert_eq!(balance.cash_balance, 1_000_000);
        assert_eq!(
            store
                .latest_cash_withdrawal(TEST_OWNER)
                .await
                .unwrap()
                .vault_signature,
            "vault-signature"
        );
    }
}
