use basingamarket_market_data::binance::BinanceClient;

use crate::ApiError;

#[derive(Debug, Clone)]
pub enum SolDepositPriceProvider {
    Static(u128),
    Binance(BinanceClient),
}

impl SolDepositPriceProvider {
    pub fn binance() -> Self {
        Self::Binance(BinanceClient::default())
    }

    pub fn static_price(price: u128) -> Self {
        Self::Static(price)
    }

    pub(crate) async fn sol_usdt_price(&self, symbol: &str) -> Result<u128, ApiError> {
        match self {
            Self::Static(price) => Ok(*price),
            Self::Binance(client) => client
                .fetch_ticker_price(symbol)
                .await
                .map(|price| price.price)
                .map_err(|error| {
                    tracing::warn!(%error, symbol, "SOL deposit price lookup failed");
                    ApiError::service_unavailable(
                        "sol_deposit_price_unavailable",
                        "SOL fiyati su anda alinamiyor.",
                    )
                }),
        }
    }
}
