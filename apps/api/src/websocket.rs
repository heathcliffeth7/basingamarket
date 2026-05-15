use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
};
use basingamarket_domain::crypto_rounds::round_window;
use basingamarket_realtime::{topics, EventEnvelope, EventPublisher, PublishedEvent};
use chrono::Utc;
use serde_json::json;
use tokio::sync::broadcast;

use crate::{crypto_projection, ApiError, AppState};

pub(crate) async fn ws_markets(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_market_socket(socket, state, None))
}

pub(crate) async fn ws_market(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_market_socket(socket, state, Some(id)))
}

pub(crate) async fn publish_market_curve_updated(
    state: &AppState,
    market_id: u64,
    round_id: u64,
) -> Result<(), ApiError> {
    let Some(message) = market_curve_updated_message(state, market_id, round_id).await? else {
        return Ok(());
    };
    state
        .bus
        .publish(
            topics::MARKET_CURVE_UPDATED,
            EventEnvelope::new(topics::MARKET_CURVE_UPDATED, message).with_market(market_id),
        )
        .await
        .map_err(ApiError::internal)?;
    Ok(())
}

pub(crate) async fn market_curve_updated_message(
    state: &AppState,
    market_id: u64,
    round_id: u64,
) -> Result<Option<serde_json::Value>, ApiError> {
    let Some(market) = state.store.get_market(market_id).await else {
        return Ok(None);
    };
    let Some(stream) = crypto_projection::phase_one_stream_for_market_id(market_id) else {
        return Ok(None);
    };
    let (start_at, _) =
        round_window(round_id, stream.duration_seconds).map_err(ApiError::internal)?;
    let outcomes = state.store.get_outcomes(market_id).await;
    let cash_volumes = crypto_projection::CashCurveVolumes {
        up: state
            .store
            .cash_trade_side_volume(market_id, round_id, "UP")
            .await,
        down: state
            .store
            .cash_trade_side_volume(market_id, round_id, "DOWN")
            .await,
    };
    let Some(curve) = crypto_projection::market_curve_response(
        &market,
        &outcomes,
        Utc::now().timestamp(),
        Some(start_at),
        cash_volumes,
    ) else {
        return Ok(None);
    };
    let sequence = state.next_market_ws_sequence(market_id).await;
    let curve = serde_json::to_value(curve).map_err(ApiError::internal)?;

    Ok(Some(json!({
        "market_id": market_id.to_string(),
        "sequence": sequence,
        "canvas_version": sequence,
        "type": "market_curve_updated",
        "payload": {
            "start_at": start_at,
            "round_id": round_id.to_string(),
            "curve": curve
        }
    })))
}

async fn handle_market_socket(mut socket: WebSocket, state: AppState, market_id: Option<u64>) {
    if let Some(market_id) = market_id {
        send_ready(&mut socket, &state, market_id).await;
    }

    let mut events = state.bus.subscribe();
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            received = events.recv() => {
                match received {
                    Ok(event) => {
                        let Some(message) = websocket_message_for_event(&event, market_id) else {
                            continue;
                        };
                        if socket.send(Message::Text(message.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_ready(socket: &mut WebSocket, state: &AppState, market_id: u64) {
    let sequence = state.current_market_ws_sequence(market_id).await;
    let message = json!({
        "market_id": market_id.to_string(),
        "sequence": sequence,
        "canvas_version": sequence,
        "type": "canvas_updated",
        "payload": { "ready": true }
    });
    let _ = socket.send(Message::Text(message.to_string().into())).await;
}

fn websocket_message_for_event(
    event: &PublishedEvent,
    market_filter: Option<u64>,
) -> Option<&serde_json::Value> {
    if event.topic != topics::MARKET_CURVE_UPDATED {
        return None;
    }
    let market_id = event.envelope.market_id?;
    if let Some(filter) = market_filter {
        if filter != market_id {
            return None;
        }
    }
    Some(&event.envelope.payload)
}
