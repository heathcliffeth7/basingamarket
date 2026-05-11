use std::{net::SocketAddr, path::PathBuf};

use basingamarket_api::{
    backfill_legacy_cash_trade_market_ids, serve, AppState, MarketPriceProvider,
};
use basingamarket_db::InMemoryProjectionStore;
use basingamarket_observability::init_tracing;
use basingamarket_realtime::MemoryEventBus;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing("basingamarket-api");
    let bind_addr: SocketAddr = std::env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_owned())
        .parse()?;
    let store = InMemoryProjectionStore::default();
    let projection_store_path = projection_store_path_from_env();
    if store
        .load_cash_projection_snapshot(&projection_store_path)
        .await?
    {
        tracing::info!(
            path = %projection_store_path.display(),
            "loaded cash projection snapshot"
        );
    }
    let state = AppState::new(store, MemoryEventBus::default())
        .with_projection_store_path(Some(projection_store_path))
        .with_price_provider(MarketPriceProvider::binance());
    let backfilled = backfill_legacy_cash_trade_market_ids(&state).await?;
    if backfilled > 0 {
        tracing::info!(backfilled, "backfilled legacy cash trade market_id values");
    }

    tracing::info!(%bind_addr, "api listening");
    serve(bind_addr, state).await
}

fn projection_store_path_from_env() -> PathBuf {
    std::env::var("PROJECTION_STORE_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".dev/projection-store.json"))
}
