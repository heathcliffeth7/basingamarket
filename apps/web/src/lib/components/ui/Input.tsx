import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export default function Input({ className, type = 'text', suppressHydrationWarning = true, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-2xl border border-terminal-line bg-terminal-panel px-4 text-sm text-terminal-text placeholder:text-terminal-muted focus:border-market-positive',
        className
      )}
      type={type}
      suppressHydrationWarning={suppressHydrationWarning}
      {...rest}
    />
  );
}
