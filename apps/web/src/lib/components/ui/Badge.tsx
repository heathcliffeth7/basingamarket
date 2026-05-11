import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'euphoric' | 'success';

const tones: Record<Tone, string> = {
  neutral: 'border-market-neutral/35 bg-market-neutral/10 text-market-neutral',
  positive: 'border-market-positive/35 bg-market-positive/10 text-market-positive',
  success: 'border-market-success/35 bg-market-success/10 text-market-success',
  negative: 'border-market-negative/35 bg-market-negative/10 text-market-negative',
  warning: 'border-market-warning/35 bg-market-warning/10 text-market-warning',
  euphoric: 'border-market-euphoric/35 bg-market-euphoric/10 text-market-euphoric'
};

export default function Badge({
  children,
  className,
  tone = 'neutral'
}: {
  children?: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return <span className={cn('mono-label inline-flex items-center gap-1 rounded-full border px-2.5 py-1', tones[tone], className)}>{children}</span>;
}
