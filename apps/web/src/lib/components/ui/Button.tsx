'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'default' | 'secondary' | 'ghost' | 'danger' | 'warning';
type Size = 'sm' | 'md' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45';
const variants: Record<Variant, string> = {
  default: 'border-market-positive bg-market-positive text-white shadow-[0_0_24px_rgba(83,102,242,0.24)] hover:bg-market-positive/90',
  secondary: 'border-terminal-line bg-terminal-panel-strong text-terminal-text hover:border-terminal-line-strong hover:bg-terminal-elevated',
  ghost: 'border-transparent bg-transparent text-terminal-muted hover:bg-terminal-panel-strong hover:text-terminal-text',
  danger: 'border-market-negative/35 bg-market-negative/10 text-market-negative hover:bg-market-negative/18',
  warning: 'border-market-warning/35 bg-market-warning/10 text-market-warning hover:bg-market-warning/18'
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-11 px-5 text-sm',
  icon: 'h-10 w-10 p-0'
};

type CommonProps = {
  children?: ReactNode;
  className?: string;
  variant?: Variant;
  size?: Size;
};

type ButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href?: string;
  };

export default function Button({
  children,
  className,
  variant = 'default',
  size = 'md',
  href,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);

  if (href) {
    return (
      <Link className={classes} href={href} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} type={type} {...rest}>
      {children}
    </button>
  );
}
