'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, RefreshCcw, Search, UserRound, Wallet, X } from 'lucide-react';
import { type ReactNode } from 'react';
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
import { isSolanaPubkey } from '@/lib/utils/solana';

export const marketCategories = [
  { label: 'Trending', href: '/markets' },
  { label: 'New', href: '/markets' },
  { label: 'Sports', href: '/markets' },
  { label: 'Crypto', href: '/markets?category=crypto' },
  { label: 'Finance', href: '/markets' }
];
const fallbackProfileHref = '/profiles/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function walletAddressForUser(user: unknown) {
  const authUser = user as { wallet?: { address?: string }; linkedAccounts?: Array<{ type?: string; address?: string; chainType?: string }> } | null;
  const addresses = [
    authUser?.wallet?.address,
    ...(authUser?.linkedAccounts?.map((account) => account.address) ?? [])
  ];

  return addresses.find((address): address is string => Boolean(address && isSolanaPubkey(address)));
}

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
  if (!walletAddress) return 'Wallet bağlanıyor';
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
    title: 'Solana cüzdanı ile giriş',
    message: directSolanaLoginStatus === 'opening'
      ? 'Privy cüzdan modalı açılıyor. OKX kullanıyorsan OKX içinde Solana hesabını seçip bağlantı isteğini onayla.'
      : 'Privy oturumu doğrulanıyor.'
  };
}

export function AuthenticatedHeaderControls({
  cashValue,
  walletAddress,
  profileHref,
  onLogout,
  compact = false,
  mintNode,
  depositNode,
  withdrawNode
}: {
  cashValue: string;
  walletAddress?: string | null;
  profileHref: string;
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
  const depositControl = depositNode ?? (walletAddress ? <DepositButton walletAddress={walletAddress} /> : null);
  const withdrawControl = withdrawNode ?? (walletAddress ? <WithdrawButton walletAddress={walletAddress} /> : null);

  return (
    <>
      <BusdcBalancePill
        cashValue={cashValue}
        compact={compact}
      />
      {mintControl}
      {depositControl}
      {withdrawControl}
      {!compact ? (
        <button className="text-terminal-muted hover:text-terminal-text" type="button" aria-label="Notifications">
          <Bell size={19} />
        </button>
      ) : null}
      <Link
        href={profileHref}
        className={compact
          ? 'grid h-8 w-8 place-items-center rounded-full border border-terminal-line bg-terminal-panel-strong text-terminal-text'
          : 'flex items-center gap-2'}
        aria-label="Profile"
      >
        <span className={compact ? '' : 'grid h-9 w-9 place-items-center rounded-full border border-terminal-line bg-terminal-panel-strong text-terminal-text'}>
          <UserRound size={17} />
        </span>
        {!compact ? <ChevronDown size={14} className="text-terminal-muted" /> : null}
      </Link>
      {!compact ? (
        <Button className="h-9 px-4 text-sm" variant="ghost" onClick={onLogout}>
          Logout
        </Button>
      ) : null}
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

export default function AppShell({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
    user,
    privyConfigured,
    privyAppIdFingerprint,
    authError,
    directSolanaLoginStatus,
    solanaWalletAddress,
    loginSolana,
    clearAuthError,
    logout
  } = useAuth();
  const isAuthenticated = ready && authenticated;
  const walletAddress = solanaWalletAddress ?? walletAddressForUser(user);
  const profileHref = walletAddress ? `/profiles/${walletAddress}` : fallbackProfileHref;
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
            <input className="h-11 w-full rounded-xl border border-terminal-line bg-terminal-panel px-11 text-sm text-terminal-text placeholder:text-terminal-muted focus:border-market-positive" placeholder="Search markets..." />
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
                profileHref={profileHref}
                onLogout={() => void logout()}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Button className="h-9 px-4 text-sm" variant="secondary" onClick={() => void loginSolana()} disabled={authCtaDisabled}>Login</Button>
                <Button className="h-9 px-4 text-sm" onClick={() => void loginSolana()} disabled={authCtaDisabled}>Sign up</Button>
              </div>
            )}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-2 lg:hidden">
            {isMockFallbackEnabled ? <LiveConnectionBadge status="mock" label="Mock" /> : null}
            <LiveConnectionBadge status="live" label="Live" />
            {!isAuthenticated ? (
              <>
                <Button className="h-8 px-3 text-xs" variant="secondary" onClick={() => void loginSolana()} disabled={authCtaDisabled}>Login</Button>
                <Button className="h-8 px-3 text-xs" onClick={() => void loginSolana()} disabled={authCtaDisabled}>Sign up</Button>
              </>
            ) : (
              <AuthenticatedHeaderControls
                compact
                cashValue={cashValue}
                walletAddress={walletAddress}
                profileHref={profileHref}
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
