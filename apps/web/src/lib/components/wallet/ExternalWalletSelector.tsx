'use client';

import { Loader2, QrCode, Wallet } from 'lucide-react';
import type { ExternalWalletOption } from '@/lib/wallet/ExternalWalletContext';

type ExternalWalletSelectorProps = {
  mode: 'deposit' | 'withdraw';
  wallets: ExternalWalletOption[];
  connecting: boolean;
  connectingWalletName: string | null;
  walletConnectQrUri?: string | null;
  walletConnectDeepLink?: string | null;
  onClearWalletConnectQr?: () => void;
  message?: string | null;
  onConnect: (walletName: string) => void;
};

export default function ExternalWalletSelector({
  mode,
  wallets,
  connecting,
  connectingWalletName,
  walletConnectQrUri,
  walletConnectDeepLink,
  onClearWalletConnectQr,
  message,
  onConnect
}: ExternalWalletSelectorProps) {
  const installedCount = wallets.filter((wallet) => wallet.installed).length;
  const title = mode === 'deposit' ? 'Deposit wallet' : 'Withdraw wallet';

  return (
    <div className="w-full space-y-3">
      <div className="text-center">
        <p className="text-sm font-black text-terminal-text">{title}</p>
        <p className="mt-1 text-xs font-semibold text-terminal-muted">
          {message ?? (connecting ? 'Connecting external wallet...' : 'Choose an external Solana wallet.')}
        </p>
      </div>

      {installedCount === 0 ? (
        <p className="rounded-lg border border-market-warning/40 bg-market-warning/10 p-3 text-center text-xs font-semibold text-market-warning">
          No installed Solana wallet detected.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {wallets.map((wallet) => {
          const isConnecting = connecting && connectingWalletName === wallet.name;
          const status = wallet.kind === 'walletconnect'
            ? wallet.installed ? 'QR ready' : wallet.disabledReason ?? 'Not configured'
            : wallet.installed ? 'Detected' : wallet.disabledReason ?? 'Not detected';
          return (
            <button
              key={wallet.name}
              type="button"
              className={[
                'flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs font-black transition',
                wallet.installed
                  ? 'border-terminal-line bg-terminal-bg text-terminal-text hover:border-market-positive/60'
                  : 'cursor-not-allowed border-terminal-line bg-terminal-bg/50 text-terminal-muted opacity-60',
                isConnecting ? 'border-market-positive bg-market-positive/10' : ''
              ].join(' ')}
              disabled={connecting || !wallet.installed}
              onClick={() => onConnect(wallet.name)}
            >
              <WalletOptionIcon wallet={wallet} loading={isConnecting} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{wallet.name}</span>
                <span className="block text-[11px] font-semibold text-terminal-muted">
                  {status}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {walletConnectQrUri ? (
        <div className="rounded-lg border border-market-positive/30 bg-market-positive/10 p-3 text-center">
          <div className="mx-auto grid h-44 w-44 place-items-center rounded-lg bg-white p-2">
            <img src={walletConnectQrUri} alt="WalletConnect QR" className="h-full w-full" />
          </div>
          <p className="mt-3 flex items-center justify-center gap-2 text-xs font-black text-terminal-text">
            <QrCode size={14} /> Scan to connect WalletConnect
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {walletConnectDeepLink ? (
              <a
                href={walletConnectDeepLink}
                className="rounded-md border border-market-positive/40 bg-market-positive/10 px-3 py-2 text-xs font-black text-terminal-text hover:bg-market-positive/20"
              >
                Open wallet
              </a>
            ) : null}
            {onClearWalletConnectQr ? (
              <button
                type="button"
                className="rounded-md border border-terminal-line px-3 py-2 text-xs font-black text-terminal-muted hover:text-terminal-text"
                onClick={onClearWalletConnectQr}
              >
                Cancel QR
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WalletOptionIcon({ wallet, loading }: { wallet: ExternalWalletOption; loading: boolean }) {
  if (loading) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-market-positive/40 bg-market-positive/10 text-terminal-text">
        <Loader2 size={16} className="animate-spin" />
      </span>
    );
  }

  if (wallet.icon) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-terminal-line bg-terminal-panel">
        <img src={wallet.icon} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-terminal-line text-[10px] font-black"
      style={{
        backgroundColor: wallet.accent,
        color: wallet.accent.toLowerCase() === '#ffffff' ? '#0b0f14' : '#ffffff'
      }}
      aria-hidden="true"
    >
      {walletInitials(wallet.name)}
    </span>
  );
}

function walletInitials(name: string) {
  if (name.toLowerCase().includes('okx')) return 'OKX';
  if (name.toLowerCase().includes('solana')) return 'SOL';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
