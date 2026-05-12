import { cn } from '@/lib/utils/cn';
import type { PriceLeadTone } from '@/lib/markets/priceLead';

const toneClasses: Record<PriceLeadTone, string> = {
  up: 'bg-market-success',
  down: 'bg-market-negative',
  neutral: 'bg-market-warning'
};

export default function LivePingDot({
  className,
  testId = 'live-ping-dot',
  tone = 'down'
}: {
  className?: string;
  testId?: string;
  tone?: PriceLeadTone;
}) {
  const toneClass = toneClasses[tone];

  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn('relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center', className)}
      aria-hidden="true"
    >
      <span
        data-testid={`${testId}-ping`}
        className={cn('absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping motion-reduce:animate-none', toneClass)}
        style={{ animationDuration: '1.5s' }}
      />
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', toneClass)} />
    </span>
  );
}
