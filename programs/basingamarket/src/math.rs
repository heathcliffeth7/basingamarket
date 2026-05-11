use anchor_lang::prelude::*;

use crate::BasingamarketError;

const BPS_DENOMINATOR: u128 = 10_000;

pub(crate) fn fee_amount(amount: u64, fee_bps: u16) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .and_then(|value| value.checked_div(BPS_DENOMINATOR))
        .ok_or(BasingamarketError::Overflow)?;
    u64::try_from(fee).map_err(|_| BasingamarketError::Overflow.into())
}

pub(crate) fn early_flip_fee(amount: u64, held_seconds: i64) -> Result<u64> {
    let fee_bps = if held_seconds < 10 {
        500
    } else if held_seconds < 30 {
        300
    } else if held_seconds < 60 {
        100
    } else {
        0
    };
    fee_amount(amount, fee_bps)
}

pub(crate) fn mul_div(amount: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, BasingamarketError::ZeroAmount);
    let value = (amount as u128)
        .checked_mul(numerator as u128)
        .and_then(|value| value.checked_div(denominator as u128))
        .ok_or(BasingamarketError::Overflow)?;
    u64::try_from(value).map_err(|_| BasingamarketError::Overflow.into())
}

pub(crate) fn checked_add(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| BasingamarketError::Overflow.into())
}

pub(crate) fn checked_sub(left: u64, right: u64) -> Result<u64> {
    left.checked_sub(right)
        .ok_or_else(|| BasingamarketError::Overflow.into())
}

pub(crate) fn seconds_to_millis(seconds: i64) -> Result<i64> {
    seconds
        .checked_mul(1_000)
        .ok_or_else(|| BasingamarketError::Overflow.into())
}

pub(crate) fn expected_close_time_ms(end_at: i64) -> Result<i64> {
    seconds_to_millis(end_at)?
        .checked_sub(1)
        .ok_or_else(|| BasingamarketError::Overflow.into())
}
