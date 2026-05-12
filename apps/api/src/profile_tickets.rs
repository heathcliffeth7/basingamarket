use std::collections::BTreeMap;

use axum::{
    extract::{Path, State},
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_db::TicketRow;
use serde_json::Value;

use crate::{
    ensure_phase_one_protocol_markets, round_settlement::settle_market_round_if_ready, ApiError,
    AppState, TicketResponse,
};

pub(crate) async fn get_profile_tickets(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let tickets = state.store.get_tickets_for_profile(&wallet_address).await;
    let mut round_contexts = BTreeMap::new();

    for (market_id, round_id) in profile_rounds(&tickets) {
        let Some(market) = state.store.get_market(market_id).await else {
            continue;
        };
        let price_header = state
            .price_provider
            .price_header_for_market_round(&market, round_id)
            .await;
        if settle_market_round_if_ready(&state, &market, round_id, price_header.as_ref()).await? {
            state.cache.flush().await;
        }
        round_contexts.insert((market_id, round_id), (market, price_header));
    }

    let tickets = state
        .store
        .get_tickets_for_profile(&wallet_address)
        .await
        .into_iter()
        .map(|ticket| {
            let context = round_contexts.get(&(ticket.market_id, ticket.round_id));
            TicketResponse::from_row(
                ticket,
                context.and_then(|(_, header)| header.as_ref()),
                context.map(|(market, _)| market),
            )
        })
        .collect::<Vec<_>>();

    serde_json::to_value(tickets)
        .map(Json)
        .map_err(ApiError::internal)
}

fn profile_rounds(tickets: &[TicketRow]) -> Vec<(u64, u64)> {
    let mut rounds = tickets
        .iter()
        .map(|ticket| (ticket.market_id, ticket.round_id))
        .collect::<Vec<_>>();
    rounds.sort_unstable();
    rounds.dedup();
    rounds
}
