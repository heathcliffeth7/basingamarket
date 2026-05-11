import { cn } from '@/lib/utils/cn';

export default function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-3xl border border-terminal-line bg-terminal-elevated/80', className)} aria-hidden="true" />;
}
