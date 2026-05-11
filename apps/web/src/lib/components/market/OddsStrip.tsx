import type { Outcome } from '@/lib/api/types';
import { formatOdds, formatTokenAmount } from '@/lib/utils/amount';

export default function OddsStrip({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <div className="grid gap-2">
      {outcomes.map((outcome) => (
        <div key={outcome.outcome_id} className="flex items-center justify-between gap-3 rounded-2xl border border-terminal-line bg-terminal-bg p-3 text-sm">
          <span className="font-semibold text-terminal-text">{outcome.label}</span>
          <span className="font-mono text-terminal-muted">
            {formatOdds(outcome.current_odds)} · {formatTokenAmount(outcome.total_stake)}
          </span>
        </div>
      ))}
    </div>
  );
}
