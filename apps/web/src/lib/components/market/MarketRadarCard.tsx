'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Market } from '@/lib/api/types';
import { marketRoundHref } from '@/lib/markets/routes';
import { deriveSimpleMarketRead } from '@/lib/utils/signals';
import Badge from '@/lib/components/ui/Badge';
import MarketPricePanel from './MarketPricePanel';

export default function MarketRadarCard({ market }: { market: Market }) {
  const read = deriveSimpleMarketRead({ market });

  return (
    <Link href={marketRoundHref(market)} className="group block rounded-2xl border border-terminal-line bg-terminal-panel p-4 transition hover:border-market-positive/45" aria-label={`Open market ${market.market_id}`}>
      <div className="min-w-0">
        {market.price_header ? (
          <div className="mb-4">
            <MarketPricePanel priceHeader={market.price_header} compact />
          </div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={market.status === 'open' ? 'positive' : 'neutral'}>{market.status}</Badge>
          <Badge tone="neutral"><Sparkles size={12} /> {read.confidenceLabel}</Badge>
          {market.price_header ? <Badge tone="neutral">{market.price_header.settlement_source}</Badge> : null}
        </div>
        <h2 className="text-xl font-black text-terminal-text">{market.question_hash}</h2>
        <p className="mt-2 text-sm font-bold text-terminal-muted">Crowd leans {read.dominantOutcomeLabel} · {read.strengthLabel}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Market lean split">
          {market.outcomes.map((outcome) => (
            <span key={outcome.outcome_id} className="rounded-full border border-terminal-line bg-terminal-bg px-3 py-1 text-xs font-bold text-terminal-text">
              {outcome.label} <span className="font-mono text-terminal-muted">{Math.round(Number(outcome.current_odds) / 10000)}%</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 px-1 text-xs font-bold text-market-positive">
            Open market <ArrowRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}
