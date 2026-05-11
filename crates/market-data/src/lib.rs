//! Binance market-data clients for basingamarket.
//!
//! This crate is intentionally outside `basingamarket-domain` so pure market
//! math stays free of HTTP and exchange-specific dependencies.

pub mod binance;
