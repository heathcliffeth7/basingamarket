'use client';

import type { ReactNode } from 'react';

export default function Sheet({
  open = false,
  side = 'right',
  children,
  onClose
}: {
  open?: boolean;
  side?: 'right' | 'left' | 'bottom';
  children?: ReactNode;
  onClose?: () => void;
}) {
  if (!open) return null;

  const panelClass =
    side === 'bottom'
      ? 'bottom-0 left-0 right-0 max-h-[85vh] overflow-auto rounded-t-[28px] border-t p-5'
      : side === 'right'
        ? 'right-0 top-0 h-screen w-full max-w-md overflow-auto rounded-l-[28px] border-l p-5'
        : 'left-0 top-0 h-screen w-full max-w-md overflow-auto rounded-r-[28px] border-r p-5';

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/72 backdrop-blur-sm" onClick={onClose} role="presentation" aria-hidden="true" />
      <div className={`fixed z-50 border-terminal-line-strong bg-terminal-panel shadow-market ${panelClass}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
