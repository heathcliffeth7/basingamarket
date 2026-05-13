use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use basingamarket_domain::crypto_rounds::{current_round_id, round_window};
use chrono::Utc;
use serde::Serialize;
use tokio::sync::RwLock;

use crate::AppState;

#[derive(Debug, Clone, Default)]
pub(crate) struct DevnetRoundBootstrapQueue {
    inner: Arc<RwLock<BTreeMap<(u64, u64), DevnetRoundBootstrapRequest>>>,
}

impl DevnetRoundBootstrapQueue {
    async fn enqueue(&self, request: DevnetRoundBootstrapRequest) -> bool {
        self.inner
            .write()
            .await
            .insert((request.market_id, request.round_id), request)
            .is_none()
    }

    async fn remove(&self, market_id: u64, round_id: u64) {
        self.inner.write().await.remove(&(market_id, round_id));
    }

    async fn live_requests(&self, now_ts: i64) -> Vec<DevnetRoundBootstrapRequest> {
        let mut requests = self.inner.write().await;
        requests.retain(|_, request| now_ts < request.end_at);
        requests
            .values()
            .filter(|request| now_ts >= request.start_at && now_ts < request.end_at)
            .cloned()
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DevnetRoundBootstrapRequest {
    market_id: u64,
    round_id: u64,
    asset: String,
    duration_seconds: u64,
    start_at: i64,
    end_at: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct DevnetRoundBootstrapRequestResponse {
    market_id: String,
    round_id: String,
    asset: String,
    duration_seconds: u64,
    interval: &'static str,
    start_at: i64,
    end_at: i64,
}

impl From<DevnetRoundBootstrapRequest> for DevnetRoundBootstrapRequestResponse {
    fn from(request: DevnetRoundBootstrapRequest) -> Self {
        Self {
            market_id: request.market_id.to_string(),
            round_id: request.round_id.to_string(),
            asset: request.asset,
            duration_seconds: request.duration_seconds,
            interval: interval_label(request.duration_seconds),
            start_at: request.start_at,
            end_at: request.end_at,
        }
    }
}

pub(crate) async fn enqueue_current_round_if_live(
    state: &AppState,
    market_id: u64,
    round_id: u64,
    now_ts: i64,
) -> bool {
    let Some(request) = request_for_current_round(market_id, round_id, now_ts) else {
        return false;
    };
    state.devnet_round_bootstrap_requests.enqueue(request).await
}

pub(crate) async fn list_round_bootstrap_requests(
    State(state): State<AppState>,
) -> Json<Vec<DevnetRoundBootstrapRequestResponse>> {
    let requests = state
        .devnet_round_bootstrap_requests
        .live_requests(Utc::now().timestamp())
        .await
        .into_iter()
        .map(DevnetRoundBootstrapRequestResponse::from)
        .collect();
    Json(requests)
}

pub(crate) async fn delete_round_bootstrap_request(
    State(state): State<AppState>,
    Path((market_id, round_id)): Path<(u64, u64)>,
) -> StatusCode {
    state
        .devnet_round_bootstrap_requests
        .remove(market_id, round_id)
        .await;
    StatusCode::NO_CONTENT
}

fn request_for_current_round(
    market_id: u64,
    round_id: u64,
    now_ts: i64,
) -> Option<DevnetRoundBootstrapRequest> {
    let stream = crate::crypto_projection::phase_one_stream_for_market_id(market_id)?;
    if !stream.active || current_round_id(now_ts, stream.duration_seconds).ok()? != round_id {
        return None;
    }
    let (start_at, end_at) = round_window(round_id, stream.duration_seconds).ok()?;
    if now_ts < start_at || now_ts >= end_at {
        return None;
    }
    Some(DevnetRoundBootstrapRequest {
        market_id,
        round_id,
        asset: stream.asset.to_string(),
        duration_seconds: stream.duration_seconds,
        start_at,
        end_at,
    })
}

fn interval_label(duration_seconds: u64) -> &'static str {
    match duration_seconds {
        60 => "1m",
        300 => "5m",
        900 => "15m",
        _ => "custom",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_for_current_round_accepts_only_live_phase_one_rounds() {
        let now_ts = 1_700_000_123;
        let round_id = current_round_id(now_ts, 300).unwrap();

        let request = request_for_current_round(1, round_id, now_ts).unwrap();
        assert_eq!(request.market_id, 1);
        assert_eq!(request.asset, "BTC");
        assert_eq!(request.duration_seconds, 300);
        assert!(request_for_current_round(1, round_id - 1, now_ts).is_none());
        assert!(request_for_current_round(4, round_id, now_ts).is_none());
    }

    #[tokio::test]
    async fn queue_dedupes_and_purges_expired_requests() {
        let queue = DevnetRoundBootstrapQueue::default();
        let now_ts = 1_700_000_123;
        let round_id = current_round_id(now_ts, 300).unwrap();
        let request = request_for_current_round(1, round_id, now_ts).unwrap();

        assert!(queue.enqueue(request.clone()).await);
        assert!(!queue.enqueue(request.clone()).await);
        assert_eq!(queue.live_requests(now_ts).await, vec![request.clone()]);
        assert!(queue.live_requests(request.end_at).await.is_empty());
    }
}
