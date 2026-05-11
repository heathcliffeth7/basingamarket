import type { MarketPriceHeader } from '@/lib/api/types';
import { formatUsdPrice } from '@/lib/utils/amount';

type MarketPricePanelProps = {
  priceHeader: MarketPriceHeader | null | undefined;
  compact?: boolean;
  showAssetImage?: boolean;
};

export default function MarketPricePanel({ priceHeader, compact = false, showAssetImage = true }: MarketPricePanelProps) {
  if (!priceHeader) return null;

  const secondaryLabel = priceHeader.price_display_state === 'closed' ? 'Close' : 'Now';
  const secondaryValue =
    priceHeader.price_display_state === 'closed'
      ? priceHeader.close_price
      : priceHeader.current_price;
  const assetLabel = `${priceHeader.asset} ${Math.round(priceHeader.duration_seconds / 60)}m`;

  return (
    <div className={`flex min-w-0 items-center gap-3 ${compact ? '' : 'lg:min-w-[420px]'}`}>
      {showAssetImage ? (
        <img
          src={priceHeader.asset_image_url}
          alt={`${priceHeader.asset} market`}
          className={`${compact ? 'h-11 w-11' : 'h-14 w-14'} shrink-0 rounded-full border border-terminal-line bg-terminal-bg`}
        />
      ) : null}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-black text-terminal-text">{assetLabel}</span>
          <span className="mono-label rounded-full border border-terminal-line bg-terminal-bg px-2 py-0.5 text-terminal-muted">
            {priceHeader.symbol}
          </span>
        </div>
        <div className={`mt-2 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:min-w-[340px]'}`}>
          <PriceCell label="Open" value={priceHeader.open_price} />
          <PriceCell label={secondaryLabel} value={secondaryValue} locked={priceHeader.price_display_state === 'closed'} />
        </div>
      </div>
    </div>
  );
}

function PriceCell({
  label,
  value,
  locked = false
}: {
  label: string;
  value: string | null;
  locked?: boolean;
}) {
  return (
    <div className="rounded-xl border border-terminal-line bg-terminal-bg px-3 py-2">
      <p className="mono-label text-terminal-muted">{label}</p>
      <p className={`mt-0.5 whitespace-nowrap font-mono text-sm font-black ${locked ? 'text-market-warning' : 'text-terminal-text'}`}>
        {formatUsdPrice(value)}
      </p>
    </div>
  );
}
