import { Activity } from 'lucide-react';
import type { SimpleMarketRead } from '@/lib/utils/signals';
import Badge from '@/lib/components/ui/Badge';
import type { RealtimeStatus } from './LiveConnectionBadge';

export default function MarketPulseStrip({
  read,
  realtimeState = 'live',
  mock = false
}: {
  read: SimpleMarketRead;
  realtimeState?: Exclude<RealtimeStatus, 'mock'>;
  mock?: boolean;
}) {
  const statusTone = realtimeState === 'live' ? 'positive' : realtimeState === 'offline' ? 'negative' : realtimeState === 'refetching' ? 'warning' : 'neutral';

  return (
    <section aria-label="Market pulse strip">
      <div className="flex flex-col gap-1.5 border-b border-terminal-line pb-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <strong className="block truncate text-xl font-black text-terminal-text">Crowd leans {read.dominantOutcomeLabel}</strong>
          <p className="mt-0.5 truncate text-xs font-bold text-terminal-text sm:text-sm">
            {read.dominantOutcomeName} · {read.strengthLabel} · {read.confidenceLabel} confidence
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {mock ? <Badge tone="warning">MOCK</Badge> : null}
          <Badge tone={statusTone}>
            <Activity size={13} />
            {realtimeState}
          </Badge>
        </div>
      </div>
    </section>
  );
}
