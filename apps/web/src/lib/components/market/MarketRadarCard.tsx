'use client';

import Link from 'next/link';
import { Bookmark, Gift, TrendingUp } from 'lucide-react';
import type { Market, Outcome } from '@/lib/api/types';
import { marketRoundHref } from '@/lib/markets/routes';
import { formatOdds, formatTokenAmount } from '@/lib/utils/amount';

export default function MarketRadarCard({ market }: { market: Market }) {
  const visibleOutcomes = market.outcomes.slice(0, 3);
  const isBinary = market.outcomes.length === 2;
  const totalStake = market.outcomes.reduce((sum, outcome) => sum + safeBigInt(outcome.total_stake), 0n);
  const liveLabel = market.price_header?.price_display_state === 'live' ? 'LIVE' : market.status.toUpperCase();
  const assetLabel = market.price_header?.symbol ?? market.price_header?.asset ?? 'Market';

  return (
    <Link
      href={marketRoundHref(market)}
      className="group flex min-h-[255px] flex-col rounded-2xl border border-terminal-line bg-terminal-panel p-4 shadow-market transition hover:border-market-positive/45 hover:bg-terminal-panel-strong"
      aria-label={`Open market ${market.question_hash}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <MarketIcon market={market} />
        <h2 className="min-w-0 flex-1 text-lg font-black leading-snug text-terminal-text group-hover:text-white">
          {market.question_hash}
        </h2>
      </div>

      <div className="mt-5 flex-1">
        {isBinary ? (
          <div className="grid grid-cols-2 gap-3">
            {market.outcomes.map((outcome, index) => (
              <OutcomeButton key={outcome.outcome_id} outcome={outcome} tone={index === 0 ? 'positive' : 'negative'} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleOutcomes.map((outcome) => (
              <OutcomeRow key={outcome.outcome_id} outcome={outcome} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-sm font-semibold text-terminal-muted">
        <div className="min-w-0">
          <p className="truncate">{formatCompactVolume(totalStake)} Vol.</p>
          <p className="mt-1 flex items-center gap-2 truncate">
            <span className={market.price_header?.price_display_state === 'live' ? 'h-2 w-2 rounded-full bg-market-negative' : 'h-2 w-2 rounded-full bg-terminal-muted'} />
            <span className="truncate">{liveLabel}</span>
            <span className="text-terminal-line-strong">·</span>
            <span className="truncate">{assetLabel}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-terminal-muted">
          <Gift size={19} aria-hidden="true" />
          <Bookmark size={19} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

function MarketIcon({ market }: { market: Market }) {
  if (market.price_header?.asset_image_url) {
    return (
      <img
        src={market.price_header.asset_image_url}
        alt={`${market.price_header.asset} market`}
        className="h-14 w-14 shrink-0 rounded-xl border border-terminal-line bg-terminal-bg object-contain p-1"
      />
    );
  }

  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-terminal-line bg-terminal-bg text-market-positive">
      <TrendingUp size={22} />
    </span>
  );
}

function OutcomeButton({ outcome, tone }: { outcome: Outcome; tone: 'positive' | 'negative' }) {
  const classes = tone === 'positive'
    ? 'bg-market-success/18 text-market-success'
    : 'bg-market-negative/18 text-market-negative';

  return (
    <span className={`flex h-14 min-w-0 items-center justify-center rounded-xl px-3 text-base font-black ${classes}`}>
      <span className="truncate">{outcome.label}</span>
    </span>
  );
}

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-base">
      <span className="truncate font-semibold text-terminal-text">{outcome.label}</span>
      <span className="font-mono font-black text-terminal-text">{formatOdds(outcome.current_odds).replace('.0%', '%')}</span>
      <span className="rounded-lg bg-market-success/18 px-3 py-2 text-sm font-black text-market-success">Yes</span>
      <span className="rounded-lg bg-market-negative/18 px-3 py-2 text-sm font-black text-market-negative">No</span>
    </div>
  );
}

function safeBigInt(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    return 0n;
  }
}

function formatCompactVolume(value: bigint) {
  const whole = Number(value) / 1_000_000;
  if (whole >= 1_000_000) return `$${Math.round(whole / 1_000_000)}M`;
  if (whole >= 1_000) return `$${Math.round(whole / 1_000)}K`;
  return `$${formatTokenAmount(value)}`;
}
