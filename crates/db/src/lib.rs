//! Projection storage, SQLx migration hook, and replay engine.

mod cash_snapshot;
mod engine;
mod markets;
mod memory;
mod pg;
mod rows;
mod withdrawals;

pub use cash_snapshot::CashProjectionSnapshot;
pub use engine::ProjectionEngine;
pub use memory::InMemoryProjectionStore;
pub use pg::PgStore;
pub use rows::*;
pub use withdrawals::{CashWithdrawalQuoteRow, CashWithdrawalRow};

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[cfg(test)]
use basingamarket_protocol_events::ProtocolEvent;
#[cfg(test)]
use chrono::Utc;

#[cfg(test)]
mod tests;
