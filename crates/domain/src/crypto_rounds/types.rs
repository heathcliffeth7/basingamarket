use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{Amount, BPS_DENOMINATOR, SCALE};

pub const USDC_BASE_UNITS: Amount = 1_000_000;
pub const DEFAULT_VIRTUAL_USDC: Amount = 50_000 * USDC_BASE_UNITS;
pub const DEFAULT_VIRTUAL_TICKET: Amount = 100_000 * USDC_BASE_UNITS;
pub const DEFAULT_BUY_FEE_BPS: u16 = 50;
pub const DEFAULT_RESALE_FEE_BPS: u16 = 50;
pub const DEFAULT_SETTLEMENT_FEE_BPS: u16 = 0;
pub const DEFAULT_MIN_SIDE_REAL_USDC: Amount = 10 * USDC_BASE_UNITS;
pub const DEFAULT_OPENING_BATCH_SECONDS: i64 = 5;
pub const DEFAULT_OPENING_BATCH_WALLET_CAP_USDC: Amount = 500 * USDC_BASE_UNITS;
pub const DURATION_1M_SECONDS: u64 = 60;
pub const DURATION_5M_SECONDS: u64 = 300;
pub const DURATION_15M_SECONDS: u64 = 900;
pub const DEFAULT_ACTIVATION_GRACE_SECONDS: i64 = 30;
pub const DEFAULT_CLOSE_LAG_SECONDS: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Asset {
    Btc,
    Eth,
    Sol,
    Xrp,
    Doge,
}

impl fmt::Display for Asset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Btc => "BTC",
            Self::Eth => "ETH",
            Self::Sol => "SOL",
            Self::Xrp => "XRP",
            Self::Doge => "DOGE",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetParseError {
    value: String,
}

impl fmt::Display for AssetParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unsupported asset {}", self.value)
    }
}

impl std::error::Error for AssetParseError {}

impl FromStr for Asset {
    type Err = AssetParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_uppercase().as_str() {
            "BTC" => Ok(Self::Btc),
            "ETH" => Ok(Self::Eth),
            "SOL" => Ok(Self::Sol),
            "XRP" => Ok(Self::Xrp),
            "DOGE" => Ok(Self::Doge),
            _ => Err(AssetParseError {
                value: value.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Up,
    Down,
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Up => f.write_str("UP"),
            Self::Down => f.write_str("DOWN"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundStatus {
    Open,
    Closed,
    Resolved,
    Voided,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BinanceSpotSymbol {
    BtcUsdt,
    EthUsdt,
    SolUsdt,
    XrpUsdt,
    DogeUsdt,
}

impl BinanceSpotSymbol {
    pub fn for_asset(asset: Asset) -> Self {
        match asset {
            Asset::Btc => Self::BtcUsdt,
            Asset::Eth => Self::EthUsdt,
            Asset::Sol => Self::SolUsdt,
            Asset::Xrp => Self::XrpUsdt,
            Asset::Doge => Self::DogeUsdt,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::BtcUsdt => "BTCUSDT",
            Self::EthUsdt => "ETHUSDT",
            Self::SolUsdt => "SOLUSDT",
            Self::XrpUsdt => "XRPUSDT",
            Self::DogeUsdt => "DOGEUSDT",
        }
    }
}

impl fmt::Display for BinanceSpotSymbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementInterval {
    OneMinute,
    FiveMinutes,
    FifteenMinutes,
}

impl SettlementInterval {
    pub fn from_duration_seconds(duration_seconds: u64) -> Result<Self, CryptoRoundError> {
        match duration_seconds {
            DURATION_1M_SECONDS => Ok(Self::OneMinute),
            DURATION_5M_SECONDS => Ok(Self::FiveMinutes),
            DURATION_15M_SECONDS => Ok(Self::FifteenMinutes),
            _ => Err(CryptoRoundError::UnsupportedSettlementDuration { duration_seconds }),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::OneMinute => "1m",
            Self::FiveMinutes => "5m",
            Self::FifteenMinutes => "15m",
        }
    }

    pub fn duration_seconds(self) -> u64 {
        match self {
            Self::OneMinute => DURATION_1M_SECONDS,
            Self::FiveMinutes => DURATION_5M_SECONDS,
            Self::FifteenMinutes => DURATION_15M_SECONDS,
        }
    }
}

impl fmt::Display for SettlementInterval {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SettlementSource {
    BinanceSpot {
        symbol: BinanceSpotSymbol,
        interval: SettlementInterval,
    },
}

impl SettlementSource {
    pub fn binance_spot(asset: Asset, duration_seconds: u64) -> Result<Self, CryptoRoundError> {
        Ok(Self::BinanceSpot {
            symbol: BinanceSpotSymbol::for_asset(asset),
            interval: SettlementInterval::from_duration_seconds(duration_seconds)?,
        })
    }

    pub fn symbol(self) -> BinanceSpotSymbol {
        match self {
            Self::BinanceSpot { symbol, .. } => symbol,
        }
    }

    pub fn interval(self) -> SettlementInterval {
        match self {
            Self::BinanceSpot { interval, .. } => interval,
        }
    }
}

impl fmt::Display for SettlementSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BinanceSpot { symbol, interval } => {
                write!(f, "Binance Spot {symbol} {interval}")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurveState {
    pub virtual_usdc: Amount,
    pub virtual_ticket: Amount,
    pub real_usdc: Amount,
    pub ticket_supply: Amount,
}

impl CurveState {
    pub fn new(virtual_usdc: Amount, virtual_ticket: Amount) -> Self {
        Self {
            virtual_usdc,
            virtual_ticket,
            real_usdc: 0,
            ticket_supply: 0,
        }
    }

    pub fn default_depth() -> Self {
        Self::new(DEFAULT_VIRTUAL_USDC, DEFAULT_VIRTUAL_TICKET)
    }

    pub fn fresh_price(&self) -> Result<Amount, CryptoRoundError> {
        price_from_reserves(self.virtual_usdc, self.virtual_ticket)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketStreamConfig {
    pub market_id: u64,
    pub asset: Asset,
    pub duration_seconds: u64,
    pub settlement_source: SettlementSource,
    pub virtual_usdc: Amount,
    pub virtual_ticket: Amount,
    pub buy_fee_bps: u16,
    pub resale_fee_bps: u16,
    pub settlement_fee_bps: u16,
    pub min_side_real_usdc: Amount,
    pub opening_batch_seconds: i64,
    pub opening_batch_wallet_cap_usdc: Amount,
    pub active: bool,
    pub is_protocol_market: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoundState {
    pub market_id: u64,
    pub round_id: u64,
    pub start_at: i64,
    pub batch_until: i64,
    pub end_at: i64,
    pub start_price: Option<Amount>,
    pub end_price: Option<Amount>,
    pub status: RoundStatus,
    pub winning_side: Option<Side>,
    pub up_curve: CurveState,
    pub down_curve: CurveState,
    pub round_bonus_usdc: Amount,
    pub settlement_vault: Amount,
    pub payout_per_ticket: Amount,
    pub protocol_vault_amount: Amount,
    pub settlement_source: SettlementSource,
    pub start_binance_open_time_ms: Option<i64>,
    pub end_binance_open_time_ms: Option<i64>,
}

impl RoundState {
    pub fn new(config: &MarketStreamConfig, round_id: u64, start_at: i64, end_at: i64) -> Self {
        Self {
            market_id: config.market_id,
            round_id,
            start_at,
            batch_until: start_at + config.opening_batch_seconds,
            end_at,
            start_price: None,
            end_price: None,
            status: RoundStatus::Open,
            winning_side: None,
            up_curve: CurveState::new(config.virtual_usdc, config.virtual_ticket),
            down_curve: CurveState::new(config.virtual_usdc, config.virtual_ticket),
            round_bonus_usdc: 0,
            settlement_vault: 0,
            payout_per_ticket: 0,
            protocol_vault_amount: 0,
            settlement_source: config.settlement_source,
            start_binance_open_time_ms: None,
            end_binance_open_time_ms: None,
        }
    }

    pub fn curve(&self, side: Side) -> &CurveState {
        match side {
            Side::Up => &self.up_curve,
            Side::Down => &self.down_curve,
        }
    }

    pub fn curve_mut(&mut self, side: Side) -> &mut CurveState {
        match side {
            Side::Up => &mut self.up_curve,
            Side::Down => &mut self.down_curve,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpeningOrder {
    pub round_id: u64,
    pub user: String,
    pub side: Side,
    pub net_usdc: Amount,
    pub claimed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpeningAggregate {
    pub round_id: u64,
    pub side: Side,
    pub total_net_usdc: Amount,
    pub total_tickets_out: Amount,
    pub finalized: bool,
}

impl OpeningAggregate {
    pub fn new(round_id: u64, side: Side) -> Self {
        Self {
            round_id,
            side,
            total_net_usdc: 0,
            total_tickets_out: 0,
            finalized: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionLot {
    pub lot_id: u64,
    pub market_id: u64,
    pub round_id: u64,
    pub side: Side,
    pub current_owner: String,
    pub original_buyer: String,
    pub ticket_amount: Amount,
    pub usdc_in: Amount,
    pub avg_entry_price: Amount,
    pub listed: bool,
    pub listed_price: Amount,
    pub created_at: i64,
    pub last_transfer_at: i64,
    pub claimed: bool,
}

impl PositionLot {
    pub fn new(
        lot_id: u64,
        round: &RoundState,
        side: Side,
        owner: String,
        ticket_amount: Amount,
        usdc_in: Amount,
        created_at: i64,
    ) -> Result<Self, CryptoRoundError> {
        validate_amount(ticket_amount)?;
        validate_amount(usdc_in)?;
        Ok(Self {
            lot_id,
            market_id: round.market_id,
            round_id: round.round_id,
            side,
            current_owner: owner.clone(),
            original_buyer: owner,
            ticket_amount,
            usdc_in,
            avg_entry_price: checked_mul_div(usdc_in, SCALE, ticket_amount)?,
            listed: false,
            listed_price: 0,
            created_at,
            last_transfer_at: created_at,
            claimed: false,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuyQuote {
    pub usdc_in: Amount,
    pub fee: Amount,
    pub net_usdc_in: Amount,
    pub tickets_out: Amount,
    pub old_virtual_usdc: Amount,
    pub old_virtual_ticket: Amount,
    pub new_virtual_usdc: Amount,
    pub new_virtual_ticket: Amount,
    pub price_after: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListingQuote {
    pub listed_price: Amount,
    pub resale_fee: Amount,
    pub early_flip_fee: Amount,
    pub seller_receives: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimQuote {
    pub side: Side,
    pub ticket_amount: Amount,
    pub payout_per_ticket: Amount,
    pub amount: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoidRefundQuote {
    pub side: Side,
    pub ticket_amount: Amount,
    pub refund_per_ticket: Amount,
    pub amount: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolStreamTemplate {
    pub phase: u8,
    pub market_id: u64,
    pub asset: Asset,
    pub duration_seconds: u64,
    pub settlement_source: SettlementSource,
}

impl ProtocolStreamTemplate {
    pub fn to_config(self) -> MarketStreamConfig {
        MarketStreamConfig {
            market_id: self.market_id,
            asset: self.asset,
            duration_seconds: self.duration_seconds,
            settlement_source: self.settlement_source,
            virtual_usdc: DEFAULT_VIRTUAL_USDC,
            virtual_ticket: DEFAULT_VIRTUAL_TICKET,
            buy_fee_bps: DEFAULT_BUY_FEE_BPS,
            resale_fee_bps: DEFAULT_RESALE_FEE_BPS,
            settlement_fee_bps: DEFAULT_SETTLEMENT_FEE_BPS,
            min_side_real_usdc: DEFAULT_MIN_SIDE_REAL_USDC,
            opening_batch_seconds: DEFAULT_OPENING_BATCH_SECONDS,
            opening_batch_wallet_cap_usdc: DEFAULT_OPENING_BATCH_WALLET_CAP_USDC,
            active: true,
            is_protocol_market: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoundOpenPlan {
    pub market_id: u64,
    pub asset: Asset,
    pub duration_seconds: u64,
    pub round_id: u64,
    pub start_at: i64,
    pub batch_until: i64,
    pub end_at: i64,
    pub settlement_source: SettlementSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationPlan {
    pub now_ts: i64,
    pub streams: Vec<MarketStreamConfig>,
    pub round_openings: Vec<RoundOpenPlan>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CryptoRoundError {
    #[error("amount must be greater than zero")]
    ZeroAmount,
    #[error("fee bps {fee_bps} is greater than 10000")]
    FeeBpsTooHigh { fee_bps: u16 },
    #[error("slippage exceeded: actual {actual} is below minimum {minimum}")]
    SlippageExceeded { actual: Amount, minimum: Amount },
    #[error("round is not open")]
    RoundNotOpen,
    #[error("round is not resolved")]
    RoundNotResolved,
    #[error("round is not voided")]
    RoundNotVoided,
    #[error("round trading is closed")]
    RoundClosed,
    #[error("opening batch is still active until {batch_until}; now {now_ts}")]
    OpeningBatchActive { now_ts: i64, batch_until: i64 },
    #[error("opening batch is closed: now {now_ts}, batch_until {batch_until}")]
    OpeningBatchClosed { now_ts: i64, batch_until: i64 },
    #[error("opening aggregate is already finalized")]
    OpeningAggregateAlreadyFinalized,
    #[error("opening aggregate is not finalized")]
    OpeningAggregateNotFinalized,
    #[error("opening order is already claimed")]
    OpeningOrderAlreadyClaimed,
    #[error("opening order side does not match aggregate side")]
    OpeningSideMismatch,
    #[error("opening order exceeds wallet cap: amount {amount}, cap {cap}")]
    OpeningWalletCapExceeded { amount: Amount, cap: Amount },
    #[error("lot is already claimed")]
    LotAlreadyClaimed,
    #[error("lot is not on the winning side")]
    LosingLot,
    #[error("lot does not belong to this round")]
    LotRoundMismatch,
    #[error("lot is not listed")]
    LotNotListed,
    #[error("lot is already listed")]
    LotAlreadyListed,
    #[error("listed price {listed_price} exceeds max price {max_price}")]
    ListedPriceExceedsMax {
        listed_price: Amount,
        max_price: Amount,
    },
    #[error("buyer cannot buy their own listing")]
    BuyerIsSeller,
    #[error("side has no ticket supply")]
    ZeroTicketSupply,
    #[error("quote was produced for a different curve state")]
    QuoteStale,
    #[error("duration must be greater than zero")]
    InvalidDuration,
    #[error("unsupported settlement duration {duration_seconds}")]
    UnsupportedSettlementDuration { duration_seconds: u64 },
    #[error("timestamp must be non-negative")]
    InvalidTimestamp,
    #[error("round open window has not started: now {now_ts}, start_at {start_at}")]
    RoundOpenWindowNotStarted { now_ts: i64, start_at: i64 },
    #[error("round open window expired: now {now_ts}, latest_open_ts {latest_open_ts}")]
    RoundOpenWindowExpired { now_ts: i64, latest_open_ts: i64 },
    #[error("round cannot resolve before {earliest_resolve_ts}; now {now_ts}")]
    ResolveTooEarly {
        now_ts: i64,
        earliest_resolve_ts: i64,
    },
    #[error("binance snapshot is missing")]
    MissingBinanceSnapshot,
    #[error(
        "binance snapshot open time {open_time_ms} does not match expected {expected_open_time_ms}"
    )]
    InvalidBinanceSnapshotTime {
        open_time_ms: i64,
        expected_open_time_ms: i64,
    },
    #[error("round is not active: up real {up_real_usdc}, down real {down_real_usdc}, minimum {minimum}")]
    RoundNotActive {
        up_real_usdc: Amount,
        down_real_usdc: Amount,
        minimum: Amount,
    },
    #[error("arithmetic overflow")]
    Overflow,
}

pub(crate) fn validate_amount(amount: Amount) -> Result<(), CryptoRoundError> {
    if amount == 0 {
        return Err(CryptoRoundError::ZeroAmount);
    }
    Ok(())
}

pub(crate) fn validate_fee_bps(fee_bps: u16) -> Result<(), CryptoRoundError> {
    if Amount::from(fee_bps) > BPS_DENOMINATOR {
        return Err(CryptoRoundError::FeeBpsTooHigh { fee_bps });
    }
    Ok(())
}

pub(crate) fn calculate_fee(amount: Amount, fee_bps: u16) -> Result<Amount, CryptoRoundError> {
    checked_mul_div(amount, Amount::from(fee_bps), BPS_DENOMINATOR)
}

pub(crate) fn price_from_reserves(
    virtual_usdc: Amount,
    virtual_ticket: Amount,
) -> Result<Amount, CryptoRoundError> {
    checked_mul_div(virtual_usdc, SCALE, virtual_ticket)
}

pub(crate) fn checked_mul(a: Amount, b: Amount) -> Result<Amount, CryptoRoundError> {
    a.checked_mul(b).ok_or(CryptoRoundError::Overflow)
}

pub(crate) fn checked_div(a: Amount, b: Amount) -> Result<Amount, CryptoRoundError> {
    if b == 0 {
        return Err(CryptoRoundError::Overflow);
    }
    a.checked_div(b).ok_or(CryptoRoundError::Overflow)
}

pub(crate) fn checked_mul_div(
    a: Amount,
    b: Amount,
    denominator: Amount,
) -> Result<Amount, CryptoRoundError> {
    checked_div(checked_mul(a, b)?, denominator)
}

pub(crate) fn validate_lot_for_round(
    round: &RoundState,
    lot: &PositionLot,
) -> Result<(), CryptoRoundError> {
    if round.market_id != lot.market_id || round.round_id != lot.round_id {
        return Err(CryptoRoundError::LotRoundMismatch);
    }
    Ok(())
}
