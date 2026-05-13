'use client';

import { Check, RotateCcw, Wallet } from 'lucide-react';
import Button from '@/lib/components/ui/Button';

type ExternalWalletAccountConfirmationProps = {
  walletName: string;
  address: string;
  warning?: string | null;
  onConfirm: () => void;
  onChooseAgain: () => void;
};

export default function ExternalWalletAccountConfirmation({
  walletName,
  address,
  warning,
  onConfirm,
  onChooseAgain
}: ExternalWalletAccountConfirmationProps) {
  return (
    <div className="mt-4 rounded-lg border border-terminal-line bg-terminal-bg p-4 text-center">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-market-positive/40 bg-market-positive/10 text-terminal-text">
        <Wallet size={18} />
      </span>
      <p className="mt-3 text-sm font-black text-terminal-text">{walletName}</p>
      <p className="mt-1 break-all font-mono text-xs font-semibold text-terminal-muted">{address}</p>
      {warning ? <p className="mt-3 text-xs font-semibold text-market-warning">{warning}</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button type="button" className="h-10 text-sm" onClick={onConfirm}>
          <Check size={15} /> Use this account
        </Button>
        <Button type="button" variant="secondary" className="h-10 text-sm" onClick={onChooseAgain}>
          <RotateCcw size={15} /> Choose again
        </Button>
      </div>
    </div>
  );
}
