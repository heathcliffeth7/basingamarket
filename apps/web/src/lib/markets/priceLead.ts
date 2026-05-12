import { formatUsdPrice } from '@/lib/utils/amount';

export type PriceLeadTone = 'up' | 'down' | 'neutral';

export type PriceLead = {
  tone: PriceLeadTone;
  amount: string;
  value: string;
  available: boolean;
};

const USD_SCALE = 1_000_000n;
export const PRICE_LEAD_NEUTRAL_BAND = 2n * USD_SCALE;

export function derivePriceLead(openPrice: string | null | undefined, displayPrice: string | null | undefined): PriceLead {
  const open = safeBigInt(openPrice);
  const display = safeBigInt(displayPrice);

  if (open === null || display === null) {
    return neutralLead(0n, false);
  }

  const diff = display - open;
  const amount = diff < 0n ? -diff : diff;

  if (amount <= PRICE_LEAD_NEUTRAL_BAND) {
    return neutralLead(amount, true);
  }

  return {
    tone: diff > 0n ? 'up' : 'down',
    amount: amount.toString(),
    value: formatUsdPrice(amount),
    available: true
  };
}

function neutralLead(amount: bigint, available: boolean): PriceLead {
  return {
    tone: 'neutral',
    amount: amount.toString(),
    value: formatUsdPrice(amount),
    available
  };
}

function safeBigInt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
