import type { ReactNode } from 'react';

export default function Tooltip({
  children,
  content,
  side = 'top'
}: {
  children?: ReactNode;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const pos = {
    top: 'bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
    bottom: 'top-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
    left: 'right-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2',
    right: 'left-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2'
  };

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        className={`pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-xl border border-terminal-line bg-terminal-bg px-2 py-1 text-xs text-terminal-text shadow-market group-hover:block group-focus-within:block ${pos[side]}`}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
