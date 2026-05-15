use basingamarket_domain::crypto_rounds::{
    Asset, BinanceSpotSymbol, SettlementInterval, SettlementSource, DURATION_15M_SECONDS,
    DURATION_1M_SECONDS, DURATION_5M_SECONDS,
};
use basingamarket_domain::{Amount, SCALE};
use serde::Deserialize;
use thiserror::Error;

pub const DEFAULT_BINANCE_BASE_URL: &str = "https://api.binance.com";

#[derive(Debug, Clone)]
pub struct BinanceClient {
    base_url: String,
    http: reqwest::Client,
}

impl Default for BinanceClient {
    fn default() -> Self {
        Self::new(DEFAULT_BINANCE_BASE_URL)
    }
}

impl BinanceClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            http: reqwest::Client::new(),
        }
    }

    pub async fn fetch_kline(
        &self,
        symbol: &str,
        interval: &str,
        open_time_ms: i64,
    ) -> Result<BinanceKline, BinanceMarketDataError> {
        if open_time_ms < 0 {
            return Err(BinanceMarketDataError::InvalidTimestamp {
                timestamp: open_time_ms,
            });
        }

        let url = format!("{}/api/v3/klines", self.base_url);
        let body = self
            .http
            .get(url)
            .query(&[
                ("symbol", symbol),
                ("interval", interval),
                ("startTime", &open_time_ms.to_string()),
                ("limit", "1"),
            ])
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        parse_kline_response(symbol, interval, open_time_ms, &body)
    }

    pub async fn fetch_round_snapshot(
        &self,
        asset: Asset,
        start_at: i64,
        duration_seconds: u64,
    ) -> Result<BinancePriceSnapshot, BinanceMarketDataError> {
        if start_at < 0 {
            return Err(BinanceMarketDataError::InvalidTimestamp {
                timestamp: start_at,
            });
        }

        let symbol = binance_symbol_for_asset(asset)?;
        let interval = interval_for_duration_seconds(duration_seconds)?;
        let start_at_ms = start_at
            .checked_mul(1_000)
            .ok_or(BinanceMarketDataError::Overflow)?;
        let kline = self
            .fetch_kline(symbol, interval.as_str(), start_at_ms)
            .await?;
        BinancePriceSnapshot::from_kline(asset, duration_seconds, kline)
    }

    pub async fn fetch_ticker_price(
        &self,
        symbol: &str,
    ) -> Result<BinanceTickerPrice, BinanceMarketDataError> {
        let url = format!("{}/api/v3/ticker/price", self.base_url);
        let body = self
            .http
            .get(url)
            .query(&[("symbol", symbol)])
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        parse_ticker_price_response(symbol, &body)
    }

    pub async fn fetch_ticker_prices(
        &self,
        symbols: &[&str],
    ) -> Result<Vec<BinanceTickerPrice>, BinanceMarketDataError> {
        if symbols.is_empty() {
            return Ok(Vec::new());
        }

        let symbols_json = serde_json::to_string(symbols).map_err(BinanceMarketDataError::Json)?;
        let url = format!("{}/api/v3/ticker/price", self.base_url);
        let body = self
            .http
            .get(url)
            .query(&[("symbols", symbols_json.as_str())])
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        parse_ticker_prices_response(&body)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinanceKline {
    pub symbol: String,
    pub interval: String,
    pub open_time_ms: i64,
    pub close_time_ms: i64,
    pub open_price: Amount,
    pub high_price: Amount,
    pub low_price: Amount,
    pub close_price: Amount,
    pub number_of_trades: u64,
}

impl BinanceKline {
    pub fn is_closed_at(&self, now_ts: i64) -> bool {
        now_ts
            .checked_mul(1_000)
            .is_some_and(|now_ms| now_ms > self.close_time_ms)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinancePriceSnapshot {
    pub source: SettlementSource,
    pub asset: Asset,
    pub symbol: String,
    pub interval: String,
    pub start_at: i64,
    pub end_at: i64,
    pub open_time_ms: i64,
    pub close_time_ms: i64,
    pub start_price: Amount,
    pub end_price: Amount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinanceTickerPrice {
    pub symbol: String,
    pub price: Amount,
}

impl BinancePriceSnapshot {
    fn from_kline(
        asset: Asset,
        duration_seconds: u64,
        kline: BinanceKline,
    ) -> Result<Self, BinanceMarketDataError> {
        let interval = interval_for_duration_seconds(duration_seconds)?;
        let start_at = kline
            .open_time_ms
            .checked_div(1_000)
            .ok_or(BinanceMarketDataError::Overflow)?;
        let end_at = start_at
            .checked_add(
                i64::try_from(duration_seconds).map_err(|_| BinanceMarketDataError::Overflow)?,
            )
            .ok_or(BinanceMarketDataError::Overflow)?;
        let expected_close_time_ms = end_at
            .checked_mul(1_000)
            .and_then(|value| value.checked_sub(1))
            .ok_or(BinanceMarketDataError::Overflow)?;

        if kline.close_time_ms != expected_close_time_ms {
            return Err(BinanceMarketDataError::KlineCloseTimeMismatch {
                expected: expected_close_time_ms,
                actual: kline.close_time_ms,
            });
        }

        Ok(Self {
            source: SettlementSource::BinanceSpot {
                symbol: BinanceSpotSymbol::for_asset(asset),
                interval,
            },
            asset,
            symbol: kline.symbol.clone(),
            interval: interval.as_str().to_owned(),
            start_at,
            end_at,
            open_time_ms: kline.open_time_ms,
            close_time_ms: kline.close_time_ms,
            start_price: kline.open_price,
            end_price: kline.close_price,
        })
    }

    pub fn is_closed_at(&self, now_ts: i64) -> bool {
        now_ts
            .checked_mul(1_000)
            .is_some_and(|now_ms| now_ms > self.close_time_ms)
    }
}

#[derive(Debug, Error)]
pub enum BinanceMarketDataError {
    #[error("binance http request failed")]
    Http(#[from] reqwest::Error),
    #[error("binance kline json parse failed")]
    Json(#[from] serde_json::Error),
    #[error("unsupported binance asset {asset}")]
    UnsupportedAsset { asset: Asset },
    #[error("unsupported binance duration {duration_seconds}")]
    UnsupportedDuration { duration_seconds: u64 },
    #[error("invalid timestamp {timestamp}")]
    InvalidTimestamp { timestamp: i64 },
    #[error("binance returned no kline for {symbol} {interval} at {open_time_ms}")]
    KlineNotFound {
        symbol: String,
        interval: String,
        open_time_ms: i64,
    },
    #[error("binance kline open time mismatch: expected {expected}, actual {actual}")]
    KlineOpenTimeMismatch { expected: i64, actual: i64 },
    #[error("binance kline close time mismatch: expected {expected}, actual {actual}")]
    KlineCloseTimeMismatch { expected: i64, actual: i64 },
    #[error("invalid decimal price {price}")]
    InvalidDecimal { price: String },
    #[error("binance ticker symbol mismatch: expected {expected}, actual {actual}")]
    TickerSymbolMismatch { expected: String, actual: String },
    #[error("arithmetic overflow")]
    Overflow,
}

pub fn binance_symbol_for_asset(asset: Asset) -> Result<&'static str, BinanceMarketDataError> {
    match asset {
        Asset::Btc => Ok("BTCUSDT"),
        Asset::Eth => Ok("ETHUSDT"),
        Asset::Sol => Ok("SOLUSDT"),
        Asset::Xrp => Ok("XRPUSDT"),
        Asset::Doge => Ok("DOGEUSDT"),
    }
}

pub fn interval_for_duration_seconds(
    duration_seconds: u64,
) -> Result<SettlementInterval, BinanceMarketDataError> {
    match duration_seconds {
        DURATION_1M_SECONDS => Ok(SettlementInterval::OneMinute),
        DURATION_5M_SECONDS => Ok(SettlementInterval::FiveMinutes),
        DURATION_15M_SECONDS => Ok(SettlementInterval::FifteenMinutes),
        _ => Err(BinanceMarketDataError::UnsupportedDuration { duration_seconds }),
    }
}

pub fn parse_kline_response(
    symbol: &str,
    interval: &str,
    requested_open_time_ms: i64,
    body: &str,
) -> Result<BinanceKline, BinanceMarketDataError> {
    let mut raw_klines: Vec<RawKline> = serde_json::from_str(body)?;
    let raw = raw_klines
        .drain(..)
        .next()
        .ok_or_else(|| BinanceMarketDataError::KlineNotFound {
            symbol: symbol.to_owned(),
            interval: interval.to_owned(),
            open_time_ms: requested_open_time_ms,
        })?;
    let kline = raw.into_kline(symbol, interval)?;

    if kline.open_time_ms != requested_open_time_ms {
        return Err(BinanceMarketDataError::KlineOpenTimeMismatch {
            expected: requested_open_time_ms,
            actual: kline.open_time_ms,
        });
    }

    Ok(kline)
}

pub fn parse_ticker_price_response(
    expected_symbol: &str,
    body: &str,
) -> Result<BinanceTickerPrice, BinanceMarketDataError> {
    let raw: RawTickerPrice = serde_json::from_str(body)?;
    let ticker = raw.into_ticker()?;
    if ticker.symbol != expected_symbol {
        return Err(BinanceMarketDataError::TickerSymbolMismatch {
            expected: expected_symbol.to_owned(),
            actual: ticker.symbol,
        });
    }

    Ok(ticker)
}

pub fn parse_ticker_prices_response(
    body: &str,
) -> Result<Vec<BinanceTickerPrice>, BinanceMarketDataError> {
    let raw_prices: Vec<RawTickerPrice> = serde_json::from_str(body)?;
    raw_prices
        .into_iter()
        .map(RawTickerPrice::into_ticker)
        .collect()
}

pub fn parse_decimal_to_scaled_amount(price: &str) -> Result<Amount, BinanceMarketDataError> {
    let price = price.trim();
    if price.is_empty() || price.starts_with('-') || price.starts_with('+') {
        return Err(BinanceMarketDataError::InvalidDecimal {
            price: price.to_owned(),
        });
    }

    let mut parts = price.split('.');
    let whole = parts.next().unwrap_or_default();
    let fractional = parts.next().unwrap_or_default();
    if parts.next().is_some() || whole.is_empty() {
        return Err(BinanceMarketDataError::InvalidDecimal {
            price: price.to_owned(),
        });
    }
    if !whole.chars().all(|char| char.is_ascii_digit())
        || !fractional.chars().all(|char| char.is_ascii_digit())
    {
        return Err(BinanceMarketDataError::InvalidDecimal {
            price: price.to_owned(),
        });
    }

    let whole_amount = whole
        .parse::<Amount>()
        .map_err(|_| BinanceMarketDataError::InvalidDecimal {
            price: price.to_owned(),
        })?
        .checked_mul(SCALE)
        .ok_or(BinanceMarketDataError::Overflow)?;

    let mut fractional_amount: Amount = 0;
    for char in fractional.chars().take(6) {
        fractional_amount = fractional_amount
            .checked_mul(10)
            .ok_or(BinanceMarketDataError::Overflow)?;
        fractional_amount = fractional_amount
            .checked_add(char.to_digit(10).unwrap() as Amount)
            .ok_or(BinanceMarketDataError::Overflow)?;
    }
    for _ in fractional.chars().take(6).count()..6 {
        fractional_amount = fractional_amount
            .checked_mul(10)
            .ok_or(BinanceMarketDataError::Overflow)?;
    }

    whole_amount
        .checked_add(fractional_amount)
        .ok_or(BinanceMarketDataError::Overflow)
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RawKline(
    i64,
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
    u64,
    String,
    String,
    String,
);

#[derive(Debug, Deserialize)]
struct RawTickerPrice {
    symbol: String,
    price: String,
}

impl RawTickerPrice {
    fn into_ticker(self) -> Result<BinanceTickerPrice, BinanceMarketDataError> {
        Ok(BinanceTickerPrice {
            symbol: self.symbol,
            price: parse_decimal_to_scaled_amount(&self.price)?,
        })
    }
}

impl RawKline {
    fn into_kline(
        self,
        symbol: &str,
        interval: &str,
    ) -> Result<BinanceKline, BinanceMarketDataError> {
        Ok(BinanceKline {
            symbol: symbol.to_owned(),
            interval: interval.to_owned(),
            open_time_ms: self.0,
            open_price: parse_decimal_to_scaled_amount(&self.1)?,
            high_price: parse_decimal_to_scaled_amount(&self.2)?,
            low_price: parse_decimal_to_scaled_amount(&self.3)?,
            close_price: parse_decimal_to_scaled_amount(&self.4)?,
            close_time_ms: self.6,
            number_of_trades: self.8,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_assets_to_binance_symbols() {
        assert_eq!(binance_symbol_for_asset(Asset::Btc).unwrap(), "BTCUSDT");
        assert_eq!(binance_symbol_for_asset(Asset::Eth).unwrap(), "ETHUSDT");
        assert_eq!(binance_symbol_for_asset(Asset::Sol).unwrap(), "SOLUSDT");
        assert_eq!(binance_symbol_for_asset(Asset::Doge).unwrap(), "DOGEUSDT");
    }

    #[test]
    fn maps_supported_durations_to_intervals() {
        assert_eq!(
            interval_for_duration_seconds(DURATION_1M_SECONDS).unwrap(),
            SettlementInterval::OneMinute
        );
        assert_eq!(
            interval_for_duration_seconds(DURATION_5M_SECONDS).unwrap(),
            SettlementInterval::FiveMinutes
        );
        assert_eq!(
            interval_for_duration_seconds(DURATION_15M_SECONDS).unwrap(),
            SettlementInterval::FifteenMinutes
        );
        assert!(matches!(
            interval_for_duration_seconds(120).unwrap_err(),
            BinanceMarketDataError::UnsupportedDuration { .. }
        ));
    }

    #[test]
    fn parses_decimal_price_without_float_rounding() {
        assert_eq!(
            parse_decimal_to_scaled_amount("103456.12345678").unwrap(),
            103_456_123_456
        );
        assert_eq!(parse_decimal_to_scaled_amount("20").unwrap(), 20_000_000);
        assert_eq!(parse_decimal_to_scaled_amount("20.1").unwrap(), 20_100_000);
    }

    #[test]
    fn rejects_invalid_decimal_price() {
        assert!(matches!(
            parse_decimal_to_scaled_amount("-1.0").unwrap_err(),
            BinanceMarketDataError::InvalidDecimal { .. }
        ));
        assert!(matches!(
            parse_decimal_to_scaled_amount("1.2.3").unwrap_err(),
            BinanceMarketDataError::InvalidDecimal { .. }
        ));
    }

    #[test]
    fn parses_binance_kline_json_fixture() {
        let body = r#"[
            [
                1700000100000,
                "35000.12345678",
                "35100.00000000",
                "34900.00000000",
                "35050.87654321",
                "123.45000000",
                1700000399999,
                "4312345.00000000",
                42,
                "50.00000000",
                "1750000.00000000",
                "0"
            ]
        ]"#;

        let kline = parse_kline_response("BTCUSDT", "5m", 1_700_000_100_000, body).unwrap();

        assert_eq!(kline.open_time_ms, 1_700_000_100_000);
        assert_eq!(kline.close_time_ms, 1_700_000_399_999);
        assert_eq!(kline.open_price, 35_000_123_456);
        assert_eq!(kline.close_price, 35_050_876_543);
        assert_eq!(kline.number_of_trades, 42);
    }

    #[test]
    fn parses_single_ticker_price_json_fixture() {
        let body = r#"{"symbol":"BTCUSDT","price":"65000.12345678"}"#;
        let ticker = parse_ticker_price_response("BTCUSDT", body).unwrap();

        assert_eq!(ticker.symbol, "BTCUSDT");
        assert_eq!(ticker.price, 65_000_123_456);
    }

    #[test]
    fn parses_multi_ticker_price_json_fixture() {
        let body = r#"[
            {"symbol":"BTCUSDT","price":"65000.12345678"},
            {"symbol":"ETHUSDT","price":"3200.50000000"},
            {"symbol":"SOLUSDT","price":"150.00000100"}
        ]"#;
        let prices = parse_ticker_prices_response(body).unwrap();

        assert_eq!(prices.len(), 3);
        assert_eq!(prices[0].price, 65_000_123_456);
        assert_eq!(prices[1].price, 3_200_500_000);
        assert_eq!(prices[2].price, 150_000_001);
    }

    #[test]
    fn detects_ticker_symbol_mismatch() {
        let body = r#"{"symbol":"ETHUSDT","price":"3200.50000000"}"#;
        let err = parse_ticker_price_response("BTCUSDT", body).unwrap_err();

        assert!(matches!(
            err,
            BinanceMarketDataError::TickerSymbolMismatch { .. }
        ));
    }

    #[test]
    fn detects_open_time_mismatch() {
        let body = r#"[[1700000100000,"1","1","1","1","0",1700000399999,"0",1,"0","0","0"]]"#;
        let err = parse_kline_response("BTCUSDT", "5m", 1_700_000_400_000, body).unwrap_err();

        assert!(matches!(
            err,
            BinanceMarketDataError::KlineOpenTimeMismatch { .. }
        ));
    }

    #[test]
    fn builds_round_snapshot_from_kline() {
        let kline = BinanceKline {
            symbol: "BTCUSDT".to_owned(),
            interval: "5m".to_owned(),
            open_time_ms: 1_700_000_100_000,
            close_time_ms: 1_700_000_399_999,
            open_price: 35_000_000_000,
            high_price: 35_100_000_000,
            low_price: 34_900_000_000,
            close_price: 35_050_000_000,
            number_of_trades: 10,
        };

        let snapshot =
            BinancePriceSnapshot::from_kline(Asset::Btc, DURATION_5M_SECONDS, kline).unwrap();

        assert_eq!(snapshot.start_at, 1_700_000_100);
        assert_eq!(snapshot.end_at, 1_700_000_400);
        assert_eq!(snapshot.source.to_string(), "Binance Spot BTCUSDT 5m");
    }

    #[tokio::test]
    async fn live_fetch_binance_kline_when_enabled() {
        if std::env::var("BINANCE_LIVE_TEST").as_deref() != Ok("1") {
            return;
        }

        let client = BinanceClient::default();
        let kline = client
            .fetch_kline("BTCUSDT", "5m", 1_700_000_100_000)
            .await
            .unwrap();

        assert_eq!(kline.symbol, "BTCUSDT");
        assert_eq!(kline.interval, "5m");
        assert_eq!(kline.open_time_ms, 1_700_000_100_000);
    }

    #[tokio::test]
    async fn live_fetch_binance_ticker_when_enabled() {
        if std::env::var("BINANCE_LIVE_TEST").as_deref() != Ok("1") {
            return;
        }

        let client = BinanceClient::default();
        let ticker = client.fetch_ticker_price("BTCUSDT").await.unwrap();

        assert_eq!(ticker.symbol, "BTCUSDT");
        assert!(ticker.price > 0);
    }
}
