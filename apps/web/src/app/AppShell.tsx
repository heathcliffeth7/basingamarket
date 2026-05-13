'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, Copy, RefreshCcw, Search, User, Wallet, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cashBalanceQueryOptions } from '@/lib/api/cashBalanceQuery';
import { isMockFallbackEnabled } from '@/lib/api/env';
import { useAuth } from '@/lib/auth/privy';
import type { DirectSolanaLoginStatus, SolanaAuthError } from '@/lib/auth/solanaLogin';
import BusdcMintButton from '@/lib/components/busdc/BusdcMintButton';
import DepositButton from '@/lib/components/deposit/DepositButton';
import WithdrawButton from '@/lib/components/withdraw/WithdrawButton';
import Button from '@/lib/components/ui/Button';
import LiveConnectionBadge from '@/lib/components/market/LiveConnectionBadge';
import { cashDisplayValue } from '@/lib/utils/cash';

export const marketCategories = [
  { label: 'Trending', href: '/markets' },
  { label: 'New', href: '/markets' },
  { label: 'Sports', href: '/markets' },
  { label: 'Crypto', href: '/markets?category=crypto' },
  { label: 'Finance', href: '/markets' }
];

type HeaderCashQueryLike = Parameters<typeof cashDisplayValue>[0];

export function headerCashDisplayValue({
  isAuthenticated,
  walletAddress,
  cashQuery
}: {
  isAuthenticated: boolean;
  walletAddress?: string | null;
  cashQuery: HeaderCashQueryLike;
}) {
  if (!isAuthenticated) return '';
  if (!walletAddress) return 'Connect wallet';
  return cashDisplayValue(cashQuery);
}

export function authNoticeCopy(authError: SolanaAuthError | null | undefined, directSolanaLoginStatus: DirectSolanaLoginStatus) {
  if (authError) {
    return {
      title: authError.title,
      message: authError.message
    };
  }
  return {
    title: 'Giriş ve cüzdan bağlantısı',
    message: directSolanaLoginStatus === 'opening'
      ? 'Privy modalı açılıyor. Google ile giriş yapabilir veya trade için Solana cüzdanını ayrıca bağlayabilirsin.'
      : 'Privy oturumu doğrulanıyor.'
  };
}

export function shortWalletAddress(address?: string | null) {
  if (!address) return 'No wallet';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function AuthenticatedHeaderControls({
  cashValue,
  walletAddress,
  onSwitchWallet,
  onLogin,
  switchWalletDisabled = false,
  onLogout,
  compact = false,
  mintNode,
  depositNode,
  withdrawNode
}: {
  cashValue: string;
  walletAddress?: string | null;
  onSwitchWallet?: () => void;
  onLogin?: () => void;
  switchWalletDisabled?: boolean;
  onLogout?: () => void;
  compact?: boolean;
  mintNode?: ReactNode;
  depositNode?: ReactNode;
  withdrawNode?: ReactNode;
}) {
  const mintControl = mintNode ?? (
    walletAddress ? (
      <BusdcMintButton walletAddress={walletAddress} compact={compact} />
    ) : (
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-terminal-line bg-terminal-panel px-4 text-sm font-black text-terminal-muted"
        aria-label="Mint BUSDC"
        disabled
      >
        Mint BUSDC
      </button>
    )
  );

  return (
    <>
      <BusdcBalancePill
        cashValue={cashValue}
        compact={compact}
      />
      {mintControl}
      {!compact ? (
        <button className="text-terminal-muted hover:text-terminal-text" type="button" aria-label="Notifications">
          <Bell size={19} />
        </button>
      ) : null}
      {walletAddress ? (
        <WalletAccountMenu
          compact={compact}
          disabled={switchWalletDisabled}
          onLogout={onLogout}
          onSwitchWallet={onSwitchWallet}
          walletAddress={walletAddress}
          depositNode={depositNode}
          withdrawNode={withdrawNode}
        />
      ) : (
        <>
          <DepositButton walletAddress={null} />
          <WithdrawButton walletAddress={null} />
          <WalletLoginControl compact={compact} disabled={switchWalletDisabled || !onLogin} label="Connect wallet" onLogin={onLogin} />
        </>
      )}
    </>
  );
}

function BusdcBalancePill({
  cashValue,
  compact
}: {
  cashValue: string;
  compact: boolean;
}) {
  return (
    <div
      className={compact
        ? 'inline-flex h-9 min-w-[118px] items-center gap-1.5 rounded-lg border border-terminal-line bg-terminal-panel px-2 text-left leading-tight'
        : 'inline-flex h-10 min-w-[150px] items-center gap-2 rounded-lg border border-terminal-line bg-terminal-panel px-3 text-left leading-tight'}
      aria-label="BUSDC balance"
    >
      <Wallet
        size={compact ? 14 : 16}
        className="shrink-0 text-terminal-muted"
        aria-hidden="true"
        data-testid="cash-wallet-icon"
      />
      <span className="min-w-0">
        <span className={compact ? 'block truncate text-[10px] font-semibold text-terminal-muted' : 'block truncate text-[11px] font-semibold text-terminal-muted'}>
          BUSDC
        </span>
        <span className={compact ? 'block truncate text-xs font-black text-terminal-text' : 'block truncate text-sm font-black text-terminal-text'}>
          {cashValue}
        </span>
      </span>
    </div>
  );
}

function WalletAccountMenu({
  compact,
  disabled,
  onLogout,
  onSwitchWallet,
  walletAddress,
  depositNode,
  withdrawNode
}: {
  compact: boolean;
  disabled: boolean;
  onLogout?: () => void;
  onSwitchWallet?: () => void;
  walletAddress: string;
  depositNode?: ReactNode;
  withdrawNode?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [depositHostMounted, setDepositHostMounted] = useState(false);
  const [withdrawHostMounted, setWithdrawHostMounted] = useState(false);
  const [depositOpenRequest, setDepositOpenRequest] = useState(0);
  const [withdrawOpenRequest, setWithdrawOpenRequest] = useState(0);

  function closeMenu() {
    setMenuOpen(false);
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
    closeMenu();
  }

  function openDepositFromMenu() {
    closeMenu();
    setDepositHostMounted(true);
    setDepositOpenRequest((request) => request + 1);
  }

  function openWithdrawFromMenu() {
    closeMenu();
    setWithdrawHostMounted(true);
    setWithdrawOpenRequest((request) => request + 1);
  }

  useEffect(() => {
    function handleDocClick(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleDocClick);
      return () => document.removeEventListener('mousedown', handleDocClick);
    }
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      {!depositNode && depositHostMounted ? (
        <DepositButton
          walletAddress={walletAddress}
          openRequest={depositOpenRequest}
          renderTrigger={() => null}
        />
      ) : null}
      {!withdrawNode && withdrawHostMounted ? (
        <WithdrawButton
          walletAddress={walletAddress}
          openRequest={withdrawOpenRequest}
          renderTrigger={() => null}
        />
      ) : null}
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-disabled={disabled || undefined}
        aria-label="Active wallet"
        className={compact
          ? 'inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-terminal-line bg-terminal-panel-strong text-terminal-text transition hover:border-terminal-line-strong hover:bg-terminal-elevated aria-disabled:pointer-events-none aria-disabled:opacity-45'
          : 'inline-flex h-10 min-w-[132px] cursor-pointer list-none items-center justify-center gap-2 rounded-lg border border-terminal-line bg-terminal-panel px-3 text-left transition hover:border-terminal-line-strong hover:bg-terminal-panel-strong aria-disabled:pointer-events-none aria-disabled:opacity-45'}
        onClick={() => {
          if (!disabled) setMenuOpen((prev) => !prev);
        }}
      >
        <Wallet size={compact ? 15 : 15} className="shrink-0 text-terminal-muted" aria-hidden="true" />
        {!compact ? (
          <>
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-semibold text-terminal-muted">Wallet</span>
              <span className="block truncate font-mono text-xs font-black text-terminal-text">{shortWalletAddress(walletAddress)}</span>
            </span>
            <ChevronDown size={13} className={`shrink-0 text-terminal-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </>
        ) : null}
      </button>
      {menuOpen ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 min-w-[192px] rounded-lg border border-terminal-line bg-terminal-panel p-1.5 shadow-2xl" role="menu">
          <Link
            href={`/profiles/${walletAddress}`}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-text hover:bg-terminal-panel-strong"
            onClick={() => setMenuOpen(false)}
          >
            <User size={13} className="shrink-0 text-terminal-muted" />
            Profile
          </Link>
          <div className="my-1 border-t border-terminal-line" />
          {depositNode ?? (
            <button
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-text hover:bg-terminal-panel-strong"
              onClick={(event) => {
                event.stopPropagation();
                openDepositFromMenu();
              }}
            >
              Deposit
            </button>
          )}
          {withdrawNode ?? (
            <button
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-text hover:bg-terminal-panel-strong"
              onClick={(event) => {
                event.stopPropagation();
                openWithdrawFromMenu();
              }}
            >
              Withdraw
            </button>
          )}
          <div className="my-1 border-t border-terminal-line" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-text hover:bg-terminal-panel-strong disabled:cursor-not-allowed disabled:text-terminal-muted"
            disabled={disabled || !onSwitchWallet}
            onClick={() => {
              closeMenu();
              onSwitchWallet?.();
            }}
          >
            Switch wallet
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-text hover:bg-terminal-panel-strong"
            onClick={copyAddress}
          >
            <Copy size={12} className="shrink-0 text-terminal-muted" />
            {copied ? 'Copied!' : 'Copy address'}
          </button>
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2 text-left text-xs font-bold text-terminal-muted hover:bg-terminal-panel-strong hover:text-terminal-text disabled:cursor-not-allowed disabled:text-terminal-muted"
            disabled={!onLogout}
            onClick={() => {
              closeMenu();
              onLogout?.();
            }}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WalletLoginControl({
  compact,
  disabled,
  label = 'Login',
  onLogin
}: {
  compact: boolean;
  disabled: boolean;
  label?: string;
  onLogin?: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={compact ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm'}
      disabled={disabled}
      onClick={onLogin}
      variant="secondary"
    >
      {label}
    </Button>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
    privyConfigured,
    privyAppIdFingerprint,
    authError,
    directSolanaLoginStatus,
    walletAddress,
    loginSolana,
    clearAuthError,
    logout
  } = useAuth();
  const isAuthenticated = ready && authenticated;
  const authCtaDisabled = !ready || !privyConfigured;
  const directLoginBusy = directSolanaLoginStatus === 'opening';
  const { title: authNoticeTitle, message: authNoticeMessage } = authNoticeCopy(authError, directSolanaLoginStatus);
  const cashQuery = useQuery(cashBalanceQueryOptions({ walletAddress, enabled: isAuthenticated }));
  const cashValue = headerCashDisplayValue({ isAuthenticated, walletAddress, cashQuery });

  return (
    <div className="terminal-shell min-h-screen">
      <header className="sticky top-0 z-40 border-b border-terminal-line bg-terminal-bg/94 backdrop-blur-xl" aria-label="Top navigation">
        <div className="mx-auto flex max-w-[1920px] items-center gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/markets" className="flex shrink-0 items-center gap-2.5" aria-label="basingamarket markets">
            <span className="grid h-9 w-9 place-items-center">
              <img src="/brand/bm-logo-mark.svg" alt="" aria-hidden="true" className="app-icon h-7 w-7" />
            </span>
            <span className="hidden text-lg font-black text-terminal-text sm:block">basingamarket</span>
          </Link>

          <label className="relative hidden min-w-[260px] max-w-[700px] flex-1 md:block">
            <span className="sr-only">Global market search</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-terminal-muted" size={18} />
            <input className="h-11 w-full rounded-xl border border-terminal-line bg-terminal-panel px-11 text-sm text-terminal-text placeholder:text-terminal-muted focus:border-market-positive" placeholder="Search markets..." suppressHydrationWarning />
          </label>

          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <div className="hidden items-center gap-2 xl:flex">
              {isMockFallbackEnabled ? <LiveConnectionBadge status="mock" label="Mock" /> : null}
              <LiveConnectionBadge status="live" label="Live" />
            </div>
            {isAuthenticated ? (
              <AuthenticatedHeaderControls
                cashValue={cashValue}
                walletAddress={walletAddress}
                onLogin={() => void loginSolana()}
                onSwitchWallet={() => void loginSolana()}
                switchWalletDisabled={authCtaDisabled || directLoginBusy}
                onLogout={() => void logout()}
              />
            ) : (
              <WalletLoginControl compact={false} disabled={authCtaDisabled} onLogin={() => void loginSolana()} />
            )}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-2 lg:hidden">
            {isMockFallbackEnabled ? <LiveConnectionBadge status="mock" label="Mock" /> : null}
            <LiveConnectionBadge status="live" label="Live" />
            {!isAuthenticated ? (
              <WalletLoginControl compact disabled={authCtaDisabled} onLogin={() => void loginSolana()} />
            ) : (
              <AuthenticatedHeaderControls
                compact
                cashValue={cashValue}
                walletAddress={walletAddress}
                onLogin={() => void loginSolana()}
                onSwitchWallet={() => void loginSolana()}
                switchWalletDisabled={authCtaDisabled || directLoginBusy}
                onLogout={() => void logout()}
              />
            )}
          </div>
        </div>

        <nav className="mx-auto flex max-w-3xl justify-start gap-8 overflow-x-auto border-t border-terminal-line px-4 py-2.5 text-[15px] font-bold text-terminal-muted sm:justify-center sm:px-6" aria-label="Market categories">
          {marketCategories.map((category, index) => (
            <Link key={category.label} href={category.href} className="inline-flex shrink-0 items-center gap-1 hover:text-terminal-text">
              {index === 0 ? <span className="text-market-positive">↗</span> : null}
              {category.label}
            </Link>
          ))}
        </nav>
        {!isAuthenticated && (authError || directLoginBusy) ? (
          <div className="border-t border-terminal-line bg-terminal-panel/95 px-4 py-2 sm:px-6">
            <div className="mx-auto flex max-w-[1920px] flex-col gap-2 text-xs text-terminal-text md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="font-black">{authNoticeTitle}</p>
                <p className="text-terminal-muted">{authNoticeMessage}</p>
                {authError ? <p className="mt-1 font-mono text-[10px] text-terminal-muted">Privy app: {privyAppIdFingerprint}</p> : null}
                {authError?.detail ? <p className="mt-1 break-all font-mono text-[10px] text-terminal-muted">Privy: {authError.detail}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button className="h-8 px-3 text-xs" variant="secondary" onClick={() => void loginSolana()} disabled={authCtaDisabled || directLoginBusy}>
                  <RefreshCcw size={14} /> Tekrar dene
                </Button>
                {authError && !directLoginBusy ? (
                  <Button className="h-8 px-2 text-xs" variant="ghost" onClick={clearAuthError} aria-label="Login error message kapat">
                    <X size={14} />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
