//! Realtime event envelopes, cache keys, and in-memory adapters.
//!
//! Production adapters can back these traits with NATS JetStream and Redis.
//! The in-memory implementations keep tests and local development free of
//! external services while preserving the same boundaries.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

pub mod topics {
    pub const MARKET_UPDATED: &str = "market.updated";
    pub const MARKET_CURVE_UPDATED: &str = "market.curve.updated";
    pub const TICKET_CREATED: &str = "ticket.created";
    pub const TICKET_LISTED: &str = "ticket.listed";
    pub const TICKET_SOLD: &str = "ticket.sold";
    pub const MARKET_CLOSED: &str = "market.closed";
    pub const MARKET_RESOLVED: &str = "market.resolved";
    pub const CANVAS_UPDATED: &str = "canvas.updated";
    pub const SHARE_RENDER_REQUESTED: &str = "share.render.requested";
    pub const MARKET_SNAPSHOT_REQUESTED: &str = "market.snapshot.requested";
    pub const RECONCILIATION_REQUESTED: &str = "reconciliation.requested";
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub event_id: String,
    pub event_type: String,
    pub version: u16,
    pub cluster: Option<String>,
    pub market_id: Option<u64>,
    pub ticket_id: Option<u64>,
    pub slot: Option<u64>,
    pub signature: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub correlation_id: Option<String>,
    pub payload: Value,
}

impl EventEnvelope {
    pub fn new(event_type: impl Into<String>, payload: Value) -> Self {
        Self {
            event_id: Uuid::new_v4().to_string(),
            event_type: event_type.into(),
            version: 1,
            cluster: None,
            market_id: None,
            ticket_id: None,
            slot: None,
            signature: None,
            occurred_at: Utc::now(),
            correlation_id: None,
            payload,
        }
    }

    pub fn with_solana_metadata(
        mut self,
        cluster: impl Into<String>,
        slot: u64,
        signature: impl Into<String>,
    ) -> Self {
        self.cluster = Some(cluster.into());
        self.slot = Some(slot);
        self.signature = Some(signature.into());
        self
    }

    pub fn with_market(mut self, market_id: u64) -> Self {
        self.market_id = Some(market_id);
        self
    }

    pub fn with_ticket(mut self, ticket_id: u64) -> Self {
        self.ticket_id = Some(ticket_id);
        self
    }
}

#[derive(Debug, Error)]
pub enum RealtimeError {
    #[error("event publish failed: {0}")]
    PublishFailed(String),
}

#[async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish(&self, topic: &str, envelope: EventEnvelope) -> Result<(), RealtimeError>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishedEvent {
    pub topic: String,
    pub envelope: EventEnvelope,
}

#[derive(Debug, Clone)]
pub struct MemoryEventBus {
    events: Arc<RwLock<Vec<PublishedEvent>>>,
    live_events: broadcast::Sender<PublishedEvent>,
}

impl Default for MemoryEventBus {
    fn default() -> Self {
        let (live_events, _) = broadcast::channel(1024);
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            live_events,
        }
    }
}

impl MemoryEventBus {
    pub fn subscribe(&self) -> broadcast::Receiver<PublishedEvent> {
        self.live_events.subscribe()
    }

    pub async fn events(&self) -> Vec<PublishedEvent> {
        self.events.read().await.clone()
    }

    pub async fn events_for_topic(&self, topic: &str) -> Vec<PublishedEvent> {
        self.events
            .read()
            .await
            .iter()
            .filter(|event| event.topic == topic)
            .cloned()
            .collect()
    }
}

#[async_trait]
impl EventPublisher for MemoryEventBus {
    async fn publish(&self, topic: &str, envelope: EventEnvelope) -> Result<(), RealtimeError> {
        let event = PublishedEvent {
            topic: topic.to_owned(),
            envelope,
        };
        self.events.write().await.push(event.clone());
        let _ = self.live_events.send(event);
        Ok(())
    }
}

pub struct CacheKey;

impl CacheKey {
    pub fn market_list() -> &'static str {
        "market:list:v1"
    }

    pub fn market_detail(market_id: u64) -> String {
        format!("market:{market_id}:detail:v1")
    }

    pub fn market_canvas(market_id: u64) -> String {
        format!("market:{market_id}:canvas:v1")
    }

    pub fn ticket_detail(ticket_id: u64) -> String {
        format!("ticket:{ticket_id}:detail:v1")
    }

    pub fn profile(address: &str) -> String {
        format!("profile:{address}:v1")
    }

    pub fn rate(route: &str, identity: &str, window: &str) -> String {
        format!("rate:{route}:{identity}:{window}")
    }

    pub fn ws_presence(market_id: u64) -> String {
        format!("ws:room:{market_id}:presence")
    }
}

#[derive(Debug, Clone)]
struct CacheEntry {
    value: Value,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct MemoryCache {
    entries: Arc<RwLock<HashMap<String, CacheEntry>>>,
}

impl MemoryCache {
    pub async fn get(&self, key: &str) -> Option<Value> {
        let now = Utc::now();
        self.entries
            .read()
            .await
            .get(key)
            .filter(|entry| entry.expires_at > now)
            .map(|entry| entry.value.clone())
    }

    pub async fn set_json(&self, key: impl Into<String>, value: Value, ttl_seconds: i64) {
        self.entries.write().await.insert(
            key.into(),
            CacheEntry {
                value,
                expires_at: Utc::now() + Duration::seconds(ttl_seconds),
            },
        );
    }

    pub async fn flush(&self) {
        self.entries.write().await.clear();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitDecision {
    Allowed,
    Limited,
}

#[derive(Debug, Clone)]
pub struct MemoryRateLimiter {
    max_requests: u32,
    window_seconds: i64,
    counters: SharedRateCounters,
}

type RateCounter = (u32, DateTime<Utc>);
type SharedRateCounters = Arc<RwLock<HashMap<String, RateCounter>>>;

impl MemoryRateLimiter {
    pub fn new(max_requests: u32, window_seconds: i64) -> Self {
        Self {
            max_requests,
            window_seconds,
            counters: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn check(&self, key: impl Into<String>) -> RateLimitDecision {
        let key = key.into();
        let now = Utc::now();
        let mut counters = self.counters.write().await;
        let entry = counters
            .entry(key)
            .or_insert((0, now + Duration::seconds(self.window_seconds)));

        if entry.1 <= now {
            *entry = (0, now + Duration::seconds(self.window_seconds));
        }

        if entry.0 >= self.max_requests {
            return RateLimitDecision::Limited;
        }

        entry.0 += 1;
        RateLimitDecision::Allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_bus_replays_events_by_topic() {
        let bus = MemoryEventBus::default();
        bus.publish(
            topics::TICKET_LISTED,
            EventEnvelope::new(topics::TICKET_LISTED, serde_json::json!({"ticket_id": 1})),
        )
        .await
        .unwrap();

        assert_eq!(bus.events_for_topic(topics::TICKET_LISTED).await.len(), 1);
    }

    #[tokio::test]
    async fn memory_bus_broadcasts_live_events_to_subscribers() {
        let bus = MemoryEventBus::default();
        let mut subscriber = bus.subscribe();

        bus.publish(
            topics::MARKET_CURVE_UPDATED,
            EventEnvelope::new(
                topics::MARKET_CURVE_UPDATED,
                serde_json::json!({"market_id": 1}),
            )
            .with_market(1),
        )
        .await
        .unwrap();

        let event = subscriber.recv().await.unwrap();
        assert_eq!(event.topic, topics::MARKET_CURVE_UPDATED);
        assert_eq!(event.envelope.market_id, Some(1));
    }

    #[tokio::test]
    async fn cache_flush_turns_hit_into_miss() {
        let cache = MemoryCache::default();
        cache
            .set_json(
                CacheKey::ticket_detail(7),
                serde_json::json!({"ticket_id": 7}),
                60,
            )
            .await;

        assert!(cache.get(&CacheKey::ticket_detail(7)).await.is_some());
        cache.flush().await;
        assert!(cache.get(&CacheKey::ticket_detail(7)).await.is_none());
    }

    #[tokio::test]
    async fn rate_limiter_limits_after_window_count() {
        let limiter = MemoryRateLimiter::new(1, 60);

        assert_eq!(
            limiter.check("route:wallet").await,
            RateLimitDecision::Allowed
        );
        assert_eq!(
            limiter.check("route:wallet").await,
            RateLimitDecision::Limited
        );
    }
}
