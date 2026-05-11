import type { Market } from '@/lib/api/types';
import Badge from '@/lib/components/ui/Badge';
import { formatTokenAmount } from '@/lib/utils/amount';
import MarketPricePanel from './MarketPricePanel';

export default function MarketStatusBar({ market }: { market: Market }) {
  const total = market.outcomes.reduce((sum, outcome) => sum + BigInt(outcome.total_stake || '0'), 0n);
  const priceHeader = market.price_header;

  return (
    <section className="terminal-panel px-4 py-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {priceHeader ? (
            <img
              src={priceHeader.asset_image_url}
              alt={`${priceHeader.asset} market`}
              className="h-14 w-14 shrink-0 rounded-xl border border-terminal-line bg-terminal-bg"
            />
          ) : null}
          <div className="min-w-0">
            <p className="mono-label text-terminal-muted">market #{market.market_id}</p>
            <h1 className="mt-1 truncate text-xl font-black text-terminal-text sm:text-2xl">{market.question_hash}</h1>
            {priceHeader ? <p className="mt-2 text-xs font-semibold text-terminal-muted">{priceHeader.settlement_source}</p> : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <MarketPricePanel priceHeader={priceHeader} showAssetImage={false} />
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Badge tone={market.status === 'open' ? 'positive' : market.status === 'resolved' ? 'success' : 'neutral'}>{market.status}</Badge>
            <Badge tone="neutral">{market.outcome_count} outcomes</Badge>
            <Badge tone="neutral">{formatTokenAmount(total)} staked</Badge>
          </div>
        </div>
      </div>
    </section>
  );
}
