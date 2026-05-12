const TOKEN_DECIMALS = 6n;
const TOKEN_SCALE = 10n ** TOKEN_DECIMALS;

export function formatTokenAmount(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '0.000000';

  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const whole = amount / TOKEN_SCALE;
  const fraction = (amount % TOKEN_SCALE).toString().padStart(Number(TOKEN_DECIMALS), '0');
  const trimmed = fraction.replace(/0+$/, '');

  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function parseTokenAmountToBaseUnits(value: string, decimals = Number(TOKEN_DECIMALS)) {
  const trimmed = value.trim();
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.replace(',', '.').split('.');
  if (fraction.length > decimals) return null;

  const baseUnits = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, '0') || '0');

  return baseUnits > 0n ? baseUnits.toString() : null;
}

export function formatOdds(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '0.00%';

  const scaled = Number(value) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(scaled);
}

export function formatUsdPrice(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';

  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const whole = amount / TOKEN_SCALE;
  const fractional = amount % TOKEN_SCALE;
  const cents = (fractional / 10_000n).toString().padStart(2, '0');
  const wholeFormatted = new Intl.NumberFormat('en-US').format(Number(whole));

  return `$${wholeFormatted}.${cents}`;
}

export function scaledUsdToNumber(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;

  try {
    const amount = typeof value === 'bigint' ? value : BigInt(value);
    const sign = amount < 0n ? -1 : 1;
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / TOKEN_SCALE;
    const fractional = absolute % TOKEN_SCALE;
    return sign * (Number(whole) + Number(fractional) / Number(TOKEN_SCALE));
  } catch {
    return null;
  }
}
