use axum::Json;
use basingamarket_observability::{DependencyStatus, HealthReport};

pub async fn live() -> Json<HealthReport> {
    Json(HealthReport::live("basingamarket-api"))
}

pub async fn ready() -> Json<HealthReport> {
    Json(
        HealthReport::live("basingamarket-api")
            .with_dependency("postgres_projection", DependencyStatus::Ok)
            .with_dependency("redis_cache", DependencyStatus::Ok)
            .with_dependency("nats_jetstream", DependencyStatus::Ok),
    )
}
