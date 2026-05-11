import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { RoundHistory, RoundHistoryItem } from '@/lib/api/types';
import { formatEtRoundDate, formatEtRoundTime } from '@/lib/markets/time';

export default function RoundTimeRail({
  history,
  selectedStartAt,
  liveStartAt,
  roundHref
}: {
  history: RoundHistory | null | undefined;
  selectedStartAt?: number;
  liveStartAt?: number;
  roundHref?: (round: RoundHistoryItem) => string;
}) {
  if (!history || history.rounds.length === 0) return null;
  const rounds = visibleRounds(history, selectedStartAt, liveStartAt);
  const selectedRound = rounds.find((round) => round.start_at === selectedStartAt) ?? null;
  const showEndedChip = selectedRound ? selectedRound.status !== 'open' && selectedRound.start_at !== liveStartAt : false;
  const endedAt = selectedRound?.start_at ?? 0;

  return (
    <nav className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Past crypto rounds">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-terminal-line bg-terminal-panel px-3 py-2 text-xs font-black text-terminal-text">
        <img src={history.rounds[0].asset_image_url} alt="" className="h-4 w-4 rounded-full" />
        Past
        <ChevronDown size={14} />
      </span>
      {showEndedChip ? (
        <span className="shrink-0 rounded-full border border-terminal-text bg-terminal-text px-4 py-2 text-xs font-black text-terminal-bg">
          Ended: {formatEtRoundDate(endedAt)}
        </span>
      ) : null}
      {rounds.map((round) => {
        const live = round.start_at === liveStartAt;
        const selected = round.start_at === selectedStartAt;
        return (
          <Link
            key={round.round_id}
            href={roundHref ? roundHref(round) : `/markets/${history.market_id}`}
            style={{ color: selected ? 'var(--bg)' : 'var(--text-muted)' }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-black transition ${
              selected
                ? 'border-terminal-text bg-terminal-text text-terminal-bg'
                : 'border-terminal-line bg-terminal-panel text-terminal-muted hover:text-terminal-text'
            }`}
          >
            {live ? <span data-testid="live-round-dot" className="h-2.5 w-2.5 rounded-full bg-market-negative animate-pulse" /> : null}
            {formatEtRoundTime(round.start_at)}
          </Link>
        );
      })}
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-terminal-line bg-terminal-panel px-4 py-2 text-xs font-black text-terminal-text">
        More
        <ChevronDown size={14} />
      </span>
    </nav>
  );
}

function visibleRounds(history: RoundHistory, selectedStartAt: number | undefined, liveStartAt: number | undefined) {
  const durationSeconds = history.duration_seconds;
  const liveStart = liveStartAt ?? history.rounds.at(-1)?.start_at;
  const reference = history.rounds.find((round) => round.start_at === liveStart) ?? history.rounds.at(-1) ?? history.rounds[0];

  if (!liveStart || !reference) {
    return history.rounds.slice(-5);
  }

  const deterministicRounds = [-4, -3, -2, -1, 0].map((offset) => {
    const startAt = liveStart + offset * durationSeconds;
    return buildRoundFromReference(reference, startAt, durationSeconds, startAt === liveStart);
  });

  if (!selectedStartAt || deterministicRounds.some((round) => round.start_at === selectedStartAt)) {
    return deterministicRounds;
  }

  const selectedRound = history.rounds.find((round) => round.start_at === selectedStartAt)
    ?? buildRoundFromReference(reference, selectedStartAt, durationSeconds, false);
  return dedupeRoundsByStartAt([selectedRound, ...deterministicRounds.slice(-4)]);
}

function buildRoundFromReference(reference: RoundHistoryItem, startAt: number, durationSeconds: number, live: boolean): RoundHistoryItem {
  return {
    ...reference,
    round_id: String(Math.floor(startAt / durationSeconds)),
    start_at: startAt,
    end_at: startAt + durationSeconds,
    status: live ? 'open' : 'closed'
  };
}

function dedupeRoundsByStartAt(rounds: RoundHistoryItem[]) {
  const seen = new Set<number>();
  return rounds.filter((round) => {
    if (seen.has(round.start_at)) {
      return false;
    }
    seen.add(round.start_at);
    return true;
  });
}
