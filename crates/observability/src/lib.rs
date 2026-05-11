//! Production observability primitives.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub mod metrics {
    pub const INDEXER_LATEST_SEEN_SLOT: &str = "indexer_latest_seen_slot";
    pub const INDEXER_SAFE_INDEXED_SLOT: &str = "indexer_safe_indexed_slot";
    pub const INDEXER_LAG_SLOTS: &str = "indexer_lag_slots";
    pub const INDEXER_BATCH_DURATION_MS: &str = "indexer_batch_duration_ms";
    pub const INDEXER_EVENTS_PROCESSED_TOTAL: &str = "indexer_events_processed_total";
    pub const INDEXER_REORG_DETECTED_TOTAL: &str = "indexer_reorg_detected_total";
    pub const RPC_REQUESTS_TOTAL: &str = "rpc_requests_total";
    pub const RPC_ERRORS_TOTAL: &str = "rpc_errors_total";
    pub const RPC_LATENCY_MS: &str = "rpc_latency_ms";
    pub const RPC_FALLBACK_TOTAL: &str = "rpc_fallback_total";
    pub const RPC_RATE_LIMITED_TOTAL: &str = "rpc_rate_limited_total";
    pub const HTTP_REQUESTS_TOTAL: &str = "http_requests_total";
    pub const HTTP_REQUEST_DURATION_MS: &str = "http_request_duration_ms";
    pub const HTTP_ERRORS_TOTAL: &str = "http_errors_total";
    pub const WEBSOCKET_CONNECTED_CLIENTS: &str = "websocket_connected_clients";
    pub const NATS_PUBLISH_FAILURES_TOTAL: &str = "nats_publish_failures_total";
    pub const NATS_CONSUMER_LAG: &str = "nats_consumer_lag";
    pub const REDIS_HIT_TOTAL: &str = "redis_hit_total";
    pub const REDIS_MISS_TOTAL: &str = "redis_miss_total";
    pub const WORKER_JOBS_STARTED_TOTAL: &str = "worker_jobs_started_total";
    pub const WORKER_JOBS_FAILED_TOTAL: &str = "worker_jobs_failed_total";
    pub const RENDER_DURATION_MS: &str = "render_duration_ms";
    pub const RENDER_FAILURES_TOTAL: &str = "render_failures_total";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyStatus {
    Ok,
    Degraded,
    Down,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthReport {
    pub service: String,
    pub live: bool,
    pub ready: bool,
    pub checked_at: DateTime<Utc>,
    pub dependencies: BTreeMap<String, DependencyStatus>,
}

impl HealthReport {
    pub fn live(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            live: true,
            ready: true,
            checked_at: Utc::now(),
            dependencies: BTreeMap::new(),
        }
    }

    pub fn with_dependency(mut self, name: impl Into<String>, status: DependencyStatus) -> Self {
        if matches!(status, DependencyStatus::Down) {
            self.ready = false;
        }
        self.dependencies.insert(name.into(), status);
        self
    }
}

pub fn init_tracing(service_name: &str) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let layer = fmt::layer()
        .json()
        .with_target(true)
        .with_current_span(true);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(layer)
        .try_init();

    tracing::info!(service = service_name, "tracing initialized");
}

pub fn prometheus_metric_names() -> Vec<&'static str> {
    vec![
        metrics::INDEXER_LATEST_SEEN_SLOT,
        metrics::INDEXER_SAFE_INDEXED_SLOT,
        metrics::INDEXER_LAG_SLOTS,
        metrics::INDEXER_BATCH_DURATION_MS,
        metrics::INDEXER_EVENTS_PROCESSED_TOTAL,
        metrics::INDEXER_REORG_DETECTED_TOTAL,
        metrics::RPC_REQUESTS_TOTAL,
        metrics::RPC_ERRORS_TOTAL,
        metrics::RPC_LATENCY_MS,
        metrics::RPC_FALLBACK_TOTAL,
        metrics::RPC_RATE_LIMITED_TOTAL,
        metrics::HTTP_REQUESTS_TOTAL,
        metrics::HTTP_REQUEST_DURATION_MS,
        metrics::HTTP_ERRORS_TOTAL,
        metrics::WEBSOCKET_CONNECTED_CLIENTS,
        metrics::NATS_PUBLISH_FAILURES_TOTAL,
        metrics::NATS_CONSUMER_LAG,
        metrics::REDIS_HIT_TOTAL,
        metrics::REDIS_MISS_TOTAL,
        metrics::WORKER_JOBS_STARTED_TOTAL,
        metrics::WORKER_JOBS_FAILED_TOTAL,
        metrics::RENDER_DURATION_MS,
        metrics::RENDER_FAILURES_TOTAL,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn down_dependency_marks_readiness_false() {
        let report = HealthReport::live("api").with_dependency("postgres", DependencyStatus::Down);

        assert!(report.live);
        assert!(!report.ready);
    }

    #[test]
    fn metric_names_include_indexer_lag() {
        assert!(prometheus_metric_names().contains(&metrics::INDEXER_LAG_SLOTS));
    }
}
