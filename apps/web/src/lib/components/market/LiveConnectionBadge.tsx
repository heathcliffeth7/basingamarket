import { cn } from '@/lib/utils/cn';

export type RealtimeStatus = 'connecting' | 'live' | 'refetching' | 'offline' | 'mock';

const classes: Record<RealtimeStatus, string> = {
  connecting: 'border-market-neutral bg-market-neutral/10 text-market-neutral',
  live: 'border-market-positive bg-market-positive/10 text-market-positive',
  refetching: 'border-market-neutral bg-market-neutral/10 text-market-neutral',
  offline: 'border-market-negative bg-market-negative/10 text-market-negative',
  mock: 'border-market-warning bg-market-warning/10 text-market-warning'
};

const dots: Record<RealtimeStatus, string> = {
  connecting: 'bg-market-neutral',
  live: 'bg-market-positive',
  refetching: 'bg-market-neutral',
  offline: 'bg-market-negative',
  mock: 'bg-market-warning'
};

export default function LiveConnectionBadge({ status = 'live', label }: { status?: RealtimeStatus; label?: string }) {
  const display = label ?? (status === 'mock' ? 'MOCK FALLBACK ACTIVE' : status);

  return (
    <span className={cn('mono-label inline-flex items-center gap-2 rounded-full border px-2.5 py-1', classes[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dots[status])} />
      {display}
    </span>
  );
}
