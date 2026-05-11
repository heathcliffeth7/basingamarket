import { cn } from '@/lib/utils/cn';

export default function Toast({ message = '', tone = 'neutral' }: { message?: string; tone?: 'neutral' | 'positive' | 'negative' }) {
  if (!message) return null;

  const toneClass = {
    neutral: 'border-market-neutral text-market-neutral',
    positive: 'border-market-positive text-market-positive',
    negative: 'border-market-negative text-market-negative'
  };

  return (
    <div className={cn('rounded-2xl border bg-terminal-bg px-3 py-2 text-sm shadow-market', toneClass[tone])} role="status">
      {message}
    </div>
  );
}
