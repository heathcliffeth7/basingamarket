use crate::{InMemoryProjectionStore, MarketRow, OutcomeRow};

impl InMemoryProjectionStore {
    pub async fn insert_market_if_absent(&self, row: MarketRow, outcomes: Vec<OutcomeRow>) -> bool {
        let mut state = self.state.write().await;
        if state.markets.contains_key(&row.market_id) {
            return false;
        }

        state.markets.insert(row.market_id, row);
        for outcome in outcomes {
            state
                .outcomes
                .insert((outcome.market_id, outcome.outcome_id), outcome);
        }
        true
    }
}
