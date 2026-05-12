use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, State},
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_db::TicketRow;
use serde_json::Value;
use tokio::task::JoinSet;

use crate::{
    ApiError, AppState, TicketResponse, ensure_phase_one_protocol_markets,
    round_settlement::settle_market_round_if_ready,
};

pub(crate) async fn get_profile_tickets(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;
    let initial_tickets = state.store.get_tickets_for_profile(&wallet_address).await;
    let mut round_contexts = BTreeMap::new();
    let mut context_tasks = JoinSet::new();

    for (market_id, round_id) in profile_rounds(&initial_tickets) {
        let task_state = state.clone();
        context_tasks.spawn(async move {
            let context = match task_state.store.get_market(market_id).await {
                Some(market) => {
                    let price_header = task_state
                        .price_provider
                        .price_header_for_market_round(&market, round_id)
                        .await;
                    Some((market, price_header))
                }
                None => None,
            };
            ((market_id, round_id), context)
        });
    }

    while let Some(result) = context_tasks.join_next().await {
        let (key, context) = result.map_err(ApiError::internal)?;
        if let Some(context) = context {
            round_contexts.insert(key, context);
        }
    }

    let mut settled_any = false;
    for ((_, round_id), (market, price_header)) in &round_contexts {
        if settle_market_round_if_ready(&state, market, *round_id, price_header.as_ref()).await? {
            settled_any = true;
        }
    }
    if settled_any {
        state.cache.flush().await;
    }

    let tickets = if settled_any {
        state.store.get_tickets_for_profile(&wallet_address).await
    } else {
        initial_tickets
    };

    let tickets = tickets
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
