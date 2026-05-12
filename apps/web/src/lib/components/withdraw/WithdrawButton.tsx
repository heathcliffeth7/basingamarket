'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from '@privy-io/react-auth/solana';
import { Loader2, Send, Wallet, X } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey, cashBalanceQueryOptions } from '@/lib/api/cashBalanceQuery';
import { useAuth } from '@/lib/auth/privy';
import Button from '@/lib/components/ui/Button';
import { formatTokenAmount, parseTokenAmountToBaseUnits } from '@/lib/utils/amount';
import { encodeDepositSignature } from '@/lib/components/deposit/signature';
import { isSolanaPubkey } from '@/lib/utils/solana';

type WithdrawButtonProps = {
  walletAddress: string;
  renderTrigger?: (open: () => void, label: string) => ReactNode;
  openRequest?: number;
};

export default function WithdrawButton({ walletAddress, renderTrigger, openRequest = 0 }: WithdrawButtonProps) {
  const queryClient = useQueryClient();
  const { getAccessToken, solanaWallet, solanaWalletsReady, solanaWalletResolving } = useAuth();
  const { signMessage } = useSignMessage();
  const lastOpenRequestRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [destinationMode, setDestinationMode] = useState<'connected' | 'custom'>('connected');
  const [customDestination, setCustomDestination] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const selectedWallet = solanaWallet?.address === walletAddress ? solanaWallet : null;
  const walletSigningPending = !solanaWalletsReady || solanaWalletResolving || !selectedWallet;

  const configQuery = useQuery({
    queryKey: ['withdraw-config'],
    queryFn: () => api.getWithdrawConfig(),
    staleTime: 30_000
  });
  const cashQuery = useQuery(cashBalanceQueryOptions({ walletAddress }));
  const cashBaseUnits = cashQuery.data?.status === 'ready' ? cashQuery.data.cash_balance ?? '0' : '0';
  const setupPending = configQuery.isError || configQuery.data?.status !== 'ready';
  const label = withdrawButtonLabel(configQuery.data?.status, configQuery.isLoading, configQuery.isError);

  const mutation = useMutation({
    mutationFn: async () => {
      if (configQuery.isError) throw new Error('API offline. Withdraw config okunamadi.');
      if (configQuery.data?.status !== 'ready') throw new Error(withdrawSetupMessage(configQuery.data?.reason));
      const baseUnits = parseTokenAmountToBaseUnits(amount, 6);
      if (!baseUnits) throw new Error('Invalid amount');
      if (BigInt(cashBaseUnits) < BigInt(baseUnits)) throw new Error('BUSDC bakiyesi yetersiz.');
      const destination = destinationMode === 'custom' ? customDestination.trim() : null;
      if (destination && !isSolanaPubkey(destination)) {
        throw new Error('Destination Solana wallet adresi gecersiz.');
      }
      if (!solanaWalletsReady || solanaWalletResolving) {
        throw new Error('Solana wallet syncing. Try again in a moment.');
      }
      if (!selectedWallet) {
        throw new Error('Solana wallet bulunamadi.');
      }
      if (selectedWallet.address !== walletAddress) {
        throw new Error('Bagli Solana wallet hesapla eslesmiyor.');
      }

      const accessToken = await getAccessToken();
      const quote = await api.createWithdrawalQuote(walletAddress, baseUnits, accessToken, destination);
      if (quote.status !== 'ready' || !quote.quote_id || !quote.message) {
        throw new Error(withdrawSetupMessage('quote_pending'));
      }
      setMessage('Solana cuzdan imzasi bekleniyor.');
      const { signature } = await signMessage({
        message: new TextEncoder().encode(quote.message),
        wallet: selectedWallet,
        options: {
          uiOptions: {
            buttonText: 'Approve withdraw',
            description: `${formatTokenAmount(baseUnits)} BUSDC withdraw`
          }
        }
      });
      setMessage('Withdraw zincire gonderiliyor.');
      return api.verifyWithdrawal(walletAddress, quote.quote_id, encodeDepositSignature(signature), accessToken);
    },
    onSuccess: (result) => {
      setAmount('');
      setMessage(`Withdraw sent: ${formatTokenAmount(result.withdrawn_amount)} BUSDC`);
      void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(walletAddress) });
      void queryClient.invalidateQueries({ queryKey: ['deposit-liquidity'] });
    },
    onError: (error) => {
      setMessage(withdrawErrorMessage(error));
    }
  });

  function openWithdraw() {
    setAmount('');
    setDestinationMode('connected');
    setCustomDestination('');
    setMessage(setupPending ? withdrawSetupMessage(configQuery.data?.reason) : null);
    setIsOpen(true);
  }

  useEffect(() => {
    if (!openRequest || openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    openWithdraw();
  }, [openRequest]);

  function applyPercent(percent: number) {
    const next = (BigInt(cashBaseUnits) * BigInt(percent)) / 100n;
    if (next > 0n) setAmount(formatTokenAmount(next.toString()));
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openWithdraw, label)
      ) : (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-full border border-terminal-line bg-terminal-panel px-3 text-xs font-black text-terminal-text transition hover:border-market-positive/60 hover:bg-terminal-panel-strong disabled:cursor-not-allowed disabled:text-terminal-muted"
          aria-label="Withdraw"
          disabled={configQuery.isLoading}
          onClick={openWithdraw}
        >
          <Wallet size={14} /> {label}
        </button>
      )}

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm" role="presentation">
          <form
            className="w-full max-w-[520px] rounded-lg border border-terminal-line bg-terminal-panel p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="h-8 w-8" />
              <div className="min-w-0 text-center">
                <h2 className="text-base font-black text-terminal-text">Withdraw</h2>
                <p className="text-xs font-semibold text-terminal-muted">BUSDC Balance: {formatTokenAmount(cashBaseUnits)} BUSDC</p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full border border-terminal-line text-terminal-muted transition hover:text-terminal-text"
                aria-label="Close withdraw"
                onClick={() => setIsOpen(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-6 text-center">
              <label className="sr-only" htmlFor="withdraw-amount">Amount</label>
              <div className="flex items-center justify-center">
                <span className="text-5xl font-black text-terminal-text">$</span>
                <input
                  id="withdraw-amount"
                  value={amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="min-w-0 max-w-[260px] bg-transparent text-center text-5xl font-black text-terminal-text outline-none placeholder:text-terminal-muted"
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  type="button"
                  className="rounded-lg bg-terminal-bg px-3 py-3 text-sm font-black text-terminal-text disabled:opacity-40"
                  disabled={cashBaseUnits === '0'}
                  onClick={() => applyPercent(percent)}
                >
                  {percent === 100 ? 'Max' : `${percent}%`}
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-lg border border-terminal-line bg-terminal-bg p-3">
              <p className="mb-2 text-xs font-black uppercase text-terminal-muted">To</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={destinationMode === 'connected' ? destinationTabClass(true) : destinationTabClass(false)}
                  onClick={() => setDestinationMode('connected')}
                >
                  Connected wallet
                </button>
                <button
                  type="button"
                  className={destinationMode === 'custom' ? destinationTabClass(true) : destinationTabClass(false)}
                  onClick={() => setDestinationMode('custom')}
                >
                  Custom address
                </button>
              </div>
              {destinationMode === 'custom' ? (
                <label className="mt-3 block">
                  <span className="sr-only">Destination Solana wallet</span>
                  <input
                    value={customDestination}
                    placeholder="Solana wallet pubkey"
                    className="h-10 w-full rounded-lg border border-terminal-line bg-terminal-panel px-3 font-mono text-xs text-terminal-text outline-none placeholder:text-terminal-muted focus:border-market-positive"
                    onChange={(event) => setCustomDestination(event.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <div className="mt-4 rounded-lg border border-terminal-line bg-terminal-bg p-3 text-center text-xs font-semibold text-terminal-muted">
              You receive <span className="font-black text-terminal-text">devnet BUSDC</span> in the destination wallet ATA.
            </div>
            <div className="mt-4 min-h-5 text-xs font-semibold text-terminal-muted">
              {message ?? (walletSigningPending ? 'Solana wallet syncing. Try again in a moment.' : 'Solana cuzdan withdraw intent mesajini imzalayacak; backend vault transferini devnette gonderecek.')}
            </div>
            <Button
              type="submit"
              className="mt-4 h-12 w-full text-sm"
              disabled={setupPending || walletSigningPending || mutation.isPending || cashBaseUnits === '0' || (destinationMode === 'custom' && !customDestination.trim())}
            >
              {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Continue
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}

function destinationTabClass(active: boolean) {
  return [
    'h-10 rounded-lg border px-3 text-xs font-black transition',
    active
      ? 'border-market-positive/70 bg-terminal-panel-strong text-terminal-text'
      : 'border-terminal-line bg-terminal-panel text-terminal-muted hover:text-terminal-text'
  ].join(' ');
}

export function withdrawButtonLabel(status: string | undefined, isLoading: boolean, isError = false) {
  if (isError) return 'API offline';
  if (isLoading || status === 'ready') return 'Withdraw';
  return 'Setup pending';
}

export function withdrawSetupMessage(reason?: string | null) {
  if (reason === 'withdraw_disabled') return 'Withdraw setup pending. SOLANA_WITHDRAW_ENABLED=true olmali.';
  if (reason === 'vault_owner_mismatch') return 'Withdraw setup pending. Vault owner keypair config ile eslesmiyor.';
  if (reason === 'vault_keypair_missing') return 'Withdraw setup pending. Vault owner keypair okunamadi.';
  return 'Withdraw setup pending. Devnet vault config hazir degil.';
}

export function withdrawErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : 'Withdraw failed';
  }
  switch (error.code) {
    case 'withdraw_insufficient_cash':
      return 'BUSDC bakiyesi yetersiz.';
    case 'withdraw_quote_expired':
      return 'Withdraw quote suresi doldu. Tekrar Continue bas.';
    case 'withdraw_wrong_signer':
      return 'Withdraw imzasi bagli Solana wallet ile eslesmiyor.';
    case 'withdraw_invalid_destination':
      return 'Destination Solana wallet adresi gecersiz.';
    case 'withdraw_destination_token_account':
      return 'Destination wallet adresi olmali; token account adresi girme.';
    case 'withdrawal_processing':
      return 'Withdraw islemi isleniyor. Birazdan tekrar kontrol et.';
    case 'withdraw_setup_pending':
      return withdrawSetupMessage();
    case 'withdrawal_transfer_failed':
      return 'Vault transfer tamamlanamadi. Devnet RPC ve vault keypair kontrol edilmeli.';
    default:
      return error.message;
  }
}
