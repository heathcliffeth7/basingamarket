use std::collections::{BTreeMap, BTreeSet, HashMap};

use axum::{
    extract::{Path, State},
    Json,
};
use basingamarket_auth::normalize_solana_pubkey;
use basingamarket_db::{CashResaleRow, CashTradeRow, MarketRow, PayoutClaimRow, TicketRow};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use tokio::task::JoinSet;

use crate::{
    ensure_phase_one_protocol_markets, public_ticket_status,
    round_settlement::settle_market_round_if_ready, ticket_cost_basis_usdc, ticket_token_amount,
    ApiError, AppState, MarketPriceHeaderResponse, TicketResponse,
};

#[derive(Debug, Serialize)]
struct ProfileActivityResponse {
    summary: ProfileActivitySummary,
    items: Vec<ProfileActivityItem>,
}

#[derive(Debug, Serialize)]
struct ProfileActivitySummary {
    total_pnl_usdc: String,
}

#[derive(Debug, Serialize)]
struct ProfileActivityItem {
    id: String,
    #[serde(rename = "type")]
    activity_type: &'static str,
    ticket_id: String,
    market_id: String,
    round_id: String,
    outcome_id: u8,
    token_name: String,
    side: &'static str,
    amount_usdc: String,
    shares: String,
    pnl_usdc: Option<String>,
    counterparty: Option<String>,
    created_at: String,
    ticket: TicketResponse,
}

#[derive(Debug, Clone)]
struct ActivityDraft {
    id: String,
    activity_type: &'static str,
    ticket_id: u64,
    amount_usdc: u128,
    shares: u128,
    pnl_usdc: Option<i128>,
    counterparty: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct LotState {
    shares: u128,
    cost_basis_usdc: u128,
}

type RoundContexts = BTreeMap<(u64, u64), (MarketRow, Option<MarketPriceHeaderResponse>)>;

pub(crate) async fn get_profile_activity(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_phase_one_protocol_markets(&state).await?;
    let wallet_address = normalize_solana_pubkey(&address)
        .map_err(|_| ApiError::bad_request("invalid_address", "Wallet address gecersiz."))?;

    let all_trades = state.store.cash_trades().await;
    let all_resales = state.store.cash_resales().await;
    let claims = state.store.payout_claims_for_wallet(&wallet_address).await;
    let initial_profile_tickets = state.store.get_tickets_for_profile(&wallet_address).await;
    let activity_ticket_ids =
        activity_ticket_ids(&wallet_address, &all_trades, &all_resales, &claims);
    let initial_activity_tickets = state.store.get_tickets_by_ids(&activity_ticket_ids).await;
    let round_keys = activity_rounds(
        &wallet_address,
        &initial_profile_tickets,
        &initial_activity_tickets,
        &all_trades,
        &all_resales,
    );
    let round_contexts = fetch_round_contexts(&state, round_keys).await?;

    let mut settled_any = false;
    for ((_, round_id), (market, price_header)) in &round_contexts {
        if settle_market_round_if_ready(&state, market, *round_id, price_header.as_ref()).await? {
            settled_any = true;
        }
    }
    if settled_any {
        state.cache.flush().await;
    }

    let profile_tickets = if settled_any {
        state.store.get_tickets_for_profile(&wallet_address).await
    } else {
        initial_profile_tickets
    };
    let activity_tickets = if settled_any {
        state.store.get_tickets_by_ids(&activity_ticket_ids).await
    } else {
        initial_activity_tickets
    };
    let ticket_map = activity_tickets
        .into_iter()
        .map(|ticket| (ticket.ticket_id, ticket))
        .collect::<HashMap<_, _>>();
    let mut drafts = activity_drafts(&wallet_address, &all_trades, &all_resales, &claims)?;
    drafts.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });

    let sell_pnl = drafts
        .iter()
        .filter(|draft| draft.activity_type == "sell")
        .filter_map(|draft| draft.pnl_usdc)
        .sum::<i128>();
    let position_pnl = profile_tickets
        .iter()
        .filter(|ticket| ticket.current_owner == wallet_address)
        .filter_map(ticket_realized_pnl)
        .sum::<i128>();
    let items = drafts
        .into_iter()
        .filter_map(|draft| activity_item(draft, &wallet_address, &ticket_map, &round_contexts))
        .collect::<Vec<_>>();
    let response = ProfileActivityResponse {
        summary: ProfileActivitySummary {
            total_pnl_usdc: signed_amount_string(sell_pnl + position_pnl),
        },
        items,
    };

    serde_json::to_value(response)
        .map(Json)
        .map_err(ApiError::internal)
}

fn activity_item(
    draft: ActivityDraft,
    wallet_address: &str,
    ticket_map: &HashMap<u64, TicketRow>,
    round_contexts: &RoundContexts,
) -> Option<ProfileActivityItem> {
    let ticket = ticket_map.get(&draft.ticket_id)?;
    let context = round_contexts.get(&(ticket.market_id, ticket.round_id));
    let pnl_usdc = draft
        .pnl_usdc
        .or_else(|| current_ticket_pnl(wallet_address, ticket))
        .map(signed_amount_string);
    let ticket_response = TicketResponse::from_row(
        ticket.clone(),
        context.and_then(|(_, header)| header.as_ref()),
        context.map(|(market, _)| market),
    );
    Some(ProfileActivityItem {
        id: draft.id,
        activity_type: draft.activity_type,
        ticket_id: ticket_response.ticket_id.clone(),
        market_id: ticket_response.market_id.clone(),
        round_id: ticket_response.round_id.clone(),
        outcome_id: ticket_response.outcome_id,
        token_name: ticket_response.token_name.clone(),
        side: side_from_outcome(ticket_response.outcome_id),
        amount_usdc: draft.amount_usdc.to_string(),
        shares: if draft.shares > 0 {
            draft.shares
        } else {
            ticket_token_amount(ticket)
        }
        .to_string(),
        pnl_usdc,
        counterparty: draft.counterparty,
        created_at: draft.created_at.to_rfc3339(),
        ticket: ticket_response,
    })
}

fn activity_drafts(
    wallet_address: &str,
    all_trades: &[CashTradeRow],
    all_resales: &[CashResaleRow],
    claims: &[PayoutClaimRow],
) -> Result<Vec<ActivityDraft>, ApiError> {
    let mut drafts = Vec::new();
    let mut lots = HashMap::new();
    let mut trades = all_trades.to_vec();
    trades.sort_by_key(|row| (row.created_at, row.lot_id));
    for trade in &trades {
        lots.insert(
            trade.lot_id,
            LotState {
                shares: trade.tickets_out,
                cost_basis_usdc: trade.usdc_in,
            },
        );
        if trade.wallet_address == wallet_address {
            drafts.push(ActivityDraft {
                id: format!("cash-buy-{}", trade.signature),
                activity_type: "buy",
                ticket_id: trade.lot_id,
                amount_usdc: trade.usdc_in,
                shares: trade.tickets_out,
                pnl_usdc: None,
                counterparty: None,
                created_at: trade.created_at,
            });
        }
    }

    let mut resales = all_resales.to_vec();
    resales.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.signature.cmp(&right.signature))
    });
    for resale in &resales {
        let sale_pnl = apply_resale_to_lots(&mut lots, resale)?;
        if resale.seller_wallet == wallet_address {
            drafts.push(ActivityDraft {
                id: format!("resale-sell-{}", resale.signature),
                activity_type: "sell",
                ticket_id: resale.source_lot_id,
                amount_usdc: resale.seller_receives,
                shares: resale.tickets_sold,
                pnl_usdc: sale_pnl,
                counterparty: Some(resale.buyer_wallet.clone()),
                created_at: resale.created_at,
            });
        }
        if resale.buyer_wallet == wallet_address {
            drafts.push(ActivityDraft {
                id: format!("resale-buy-{}", resale.signature),
                activity_type: "buy",
                ticket_id: resale.buyer_lot_id.unwrap_or(resale.source_lot_id),
                amount_usdc: resale.gross_usdc,
                shares: resale.tickets_sold,
                pnl_usdc: None,
                counterparty: Some(resale.seller_wallet.clone()),
                created_at: resale.created_at,
            });
        }
    }

    for claim in claims {
        drafts.push(ActivityDraft {
            id: format!("redeem-{}", claim.signature),
            activity_type: "redeem",
            ticket_id: claim.ticket_id,
            amount_usdc: claim.amount,
            shares: 0,
            pnl_usdc: None,
            counterparty: None,
            created_at: claim.created_at,
        });
    }

    Ok(drafts)
}

fn apply_resale_to_lots(
    lots: &mut HashMap<u64, LotState>,
    resale: &CashResaleRow,
) -> Result<Option<i128>, ApiError> {
    let Some(source) = lots.get_mut(&resale.source_lot_id) else {
        return Ok(None);
    };
    if source.shares == 0 {
        return Ok(None);
    }

    let sold_cost = prorated_amount(source.cost_basis_usdc, resale.tickets_sold, source.shares)?;
    let sale_pnl = Some(signed_delta(resale.seller_receives, sold_cost));
    let mut buyer_lot = None;
    if let Some(buyer_lot_id) = resale.buyer_lot_id {
        source.shares = source.shares.saturating_sub(resale.tickets_sold);
        source.cost_basis_usdc = source.cost_basis_usdc.saturating_sub(sold_cost);
        buyer_lot = Some((
            buyer_lot_id,
            LotState {
                shares: resale.tickets_sold,
                cost_basis_usdc: resale.gross_usdc,
            },
        ));
    } else {
        source.cost_basis_usdc = resale.gross_usdc;
    }
    if let Some((buyer_lot_id, buyer_state)) = buyer_lot {
        lots.insert(buyer_lot_id, buyer_state);
    }

    Ok(sale_pnl)
}

async fn fetch_round_contexts(
    state: &AppState,
    round_keys: Vec<(u64, u64)>,
) -> Result<RoundContexts, ApiError> {
    let mut context_tasks = JoinSet::new();
    for (market_id, round_id) in round_keys {
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

    let mut round_contexts = BTreeMap::new();
    while let Some(result) = context_tasks.join_next().await {
        let (key, context) = result.map_err(ApiError::internal)?;
        if let Some(context) = context {
            round_contexts.insert(key, context);
        }
    }
    Ok(round_contexts)
}

fn activity_ticket_ids(
    wallet_address: &str,
    trades: &[CashTradeRow],
    resales: &[CashResaleRow],
    claims: &[PayoutClaimRow],
) -> Vec<u64> {
    let mut ids = BTreeSet::new();
    for trade in trades {
        if trade.wallet_address == wallet_address {
            ids.insert(trade.lot_id);
        }
    }
    for resale in resales {
        if resale.seller_wallet == wallet_address {
            ids.insert(resale.source_lot_id);
        }
        if resale.buyer_wallet == wallet_address {
            ids.insert(resale.buyer_lot_id.unwrap_or(resale.source_lot_id));
        }
    }
    for claim in claims {
        ids.insert(claim.ticket_id);
    }
    ids.into_iter().collect()
}

fn activity_rounds(
    wallet_address: &str,
    profile_tickets: &[TicketRow],
    activity_tickets: &[TicketRow],
    trades: &[CashTradeRow],
    resales: &[CashResaleRow],
) -> Vec<(u64, u64)> {
    let mut rounds = BTreeSet::new();
    for ticket in profile_tickets.iter().chain(activity_tickets.iter()) {
        rounds.insert((ticket.market_id, ticket.round_id));
    }
    for trade in trades {
        if trade.wallet_address == wallet_address && trade.market_id != 0 {
            rounds.insert((trade.market_id, trade.round_id));
        }
    }
    for resale in resales {
        if (resale.seller_wallet == wallet_address || resale.buyer_wallet == wallet_address)
            && resale.market_id != 0
        {
            rounds.insert((resale.market_id, resale.round_id));
        }
    }
    rounds.into_iter().collect()
}

fn current_ticket_pnl(wallet_address: &str, ticket: &TicketRow) -> Option<i128> {
    if ticket.current_owner != wallet_address {
        return None;
    }
    ticket_realized_pnl(ticket)
}

fn ticket_realized_pnl(ticket: &TicketRow) -> Option<i128> {
    let token_amount = ticket_token_amount(ticket);
    let cost_basis = ticket_cost_basis_usdc(ticket, token_amount);
    let status = public_ticket_status(ticket.status);
    if status == "lost" {
        return Some(signed_delta(0, cost_basis));
    }
    ticket
        .settlement_value_usdc
        .map(|amount| signed_delta(amount, cost_basis))
}

fn prorated_amount(total: u128, part: u128, whole: u128) -> Result<u128, ApiError> {
    if whole == 0 {
        return Ok(0);
    }
    total
        .checked_mul(part)
        .and_then(|value| value.checked_div(whole))
        .ok_or_else(|| ApiError::internal("profile activity prorated amount overflow"))
}

fn signed_delta(value: u128, cost: u128) -> i128 {
    if value >= cost {
        (value - cost) as i128
    } else {
        -((cost - value) as i128)
    }
}

fn signed_amount_string(value: i128) -> String {
    value.to_string()
}

fn side_from_outcome(outcome_id: u8) -> &'static str {
    if outcome_id == 1 {
        "DOWN"
    } else {
        "UP"
    }
}
