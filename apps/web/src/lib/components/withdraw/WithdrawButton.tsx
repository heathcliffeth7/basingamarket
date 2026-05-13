'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from '@privy-io/react-auth/solana';
import { Loader2, Send, Wallet, X } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey, cashBalanceQueryOptions } from '@/lib/api/cashBalanceQuery';
import { useAuth } from '@/lib/auth/privy';
import { useWalletSession } from '@/lib/auth/walletSession';
import Button from '@/lib/components/ui/Button';
import ExternalWalletAccountConfirmation from '@/lib/components/wallet/ExternalWalletAccountConfirmation';
import ExternalWalletSelector from '@/lib/components/wallet/ExternalWalletSelector';
import { formatTokenAmount, parseTokenAmountToBaseUnits } from '@/lib/utils/amount';
import { encodeDepositSignature } from '@/lib/components/deposit/signature';
import { isSolanaPubkey } from '@/lib/utils/solana';
import { useExternalWallet } from '@/lib/wallet/ExternalWalletContext';

type WithdrawButtonProps = {
  walletAddress: string | null;
  renderTrigger?: (open: () => void, label: string) => ReactNode;
  openRequest?: number;
};

type ExternalWalletSession = { address: string; walletName: string };

export default function WithdrawButton({ walletAddress, renderTrigger, openRequest = 0 }: WithdrawButtonProps) {
  const queryClient = useQueryClient();
  const { loginSolana, solanaWallet, solanaWalletAddress, solanaWalletsReady, solanaWalletResolving, authenticated } = useAuth();
  const { getWalletSession } = useWalletSession();
  const { signMessage } = useSignMessage();
  const externalWallet = useExternalWallet();
  const lastOpenRequestRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [destinationMode, setDestinationMode] = useState<'connected' | 'external' | 'custom'>('connected');
  const [externalDestinationAddress, setExternalDestinationAddress] = useState<string | null>(null);
  const [pendingExternalDestinationWallet, setPendingExternalDestinationWallet] = useState<ExternalWalletSession | null>(null);
  const [externalDestinationConnecting, setExternalDestinationConnecting] = useState(false);
  const [selectedExternalWallet, setSelectedExternalWallet] = useState<string | null>(null);
  const [lastExternalDestinationAddress, setLastExternalDestinationAddress] = useState<string | null>(null);
  const [externalWalletWarning, setExternalWalletWarning] = useState<string | null>(null);
  const [customDestination, setCustomDestination] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const externalDestinationSessionRef = useRef(0);
  const activeWalletAddress = solanaWalletAddress ?? walletAddress;
  const selectedWallet = activeWalletAddress && solanaWallet?.address === activeWalletAddress ? solanaWallet : null;
  const walletSigningPending = !solanaWalletsReady || solanaWalletResolving || !selectedWallet;
  const needsWallet = !activeWalletAddress;

  const configQuery = useQuery({
    queryKey: ['withdraw-config'],
    queryFn: () => api.getWithdrawConfig(),
    staleTime: 30_000
  });
  const cashQuery = useQuery(cashBalanceQueryOptions({ walletAddress: activeWalletAddress }));
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
      const destination = destinationMode === 'external' ? externalDestinationAddress : destinationMode === 'custom' ? customDestination.trim() || null : null;
      if (destinationMode === 'external' && !destination) {
        throw new Error('External wallet not connected.');
      }
      if (destinationMode === 'external' && (!externalWallet.connected || externalWallet.walletAddress !== externalDestinationAddress)) {
        throw new Error('External wallet session expired, connect again.');
      }
      if (destinationMode === 'custom' && destination && !isSolanaPubkey(destination)) {
        throw new Error('Destination Solana wallet adresi gecersiz.');
      }
      if (!solanaWalletsReady || solanaWalletResolving) {
        throw new Error('Solana wallet syncing. Try again in a moment.');
      }
      if (!selectedWallet) {
        throw new Error('Solana wallet bulunamadi.');
      }
      if (selectedWallet.address !== activeWalletAddress) {
        throw new Error('Bagli Solana wallet hesapla eslesmiyor.');
      }

      const walletSession = await getWalletSession(activeWalletAddress!);
      const quote = await api.createWithdrawalQuote(
        activeWalletAddress!,
        baseUnits,
        walletSession.accessToken,
        destination,
        walletSession.walletSessionToken
      );
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
      return api.verifyWithdrawal(
        activeWalletAddress!,
        quote.quote_id,
        encodeDepositSignature(signature),
        walletSession.accessToken,
        walletSession.walletSessionToken
      );
    },
    onSuccess: (result) => {
      setAmount('');
      clearExternalDestination(true);
      setDestinationMode('connected');
      setMessage(`Withdraw sent: ${formatTokenAmount(result.withdrawn_amount)} BUSDC`);
      if (activeWalletAddress) {
        void queryClient.invalidateQueries({ queryKey: cashBalanceQueryKey(activeWalletAddress) });
      }
      void queryClient.invalidateQueries({ queryKey: ['deposit-liquidity'] });
    },
    onError: (error) => {
      setMessage(withdrawErrorMessage(error));
    }
  });

  function openWithdraw() {
    clearExternalDestination(true);
    setLastExternalDestinationAddress(null);
    setExternalWalletWarning(null);
    setAmount('');
    setDestinationMode('connected');
    setCustomDestination('');
    setMessage(null);
    setIsOpen(true);
  }

  useEffect(() => {
    if (!openRequest || openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    openWithdraw();
  }, [openRequest]);

  useEffect(() => {
    if (isOpen && needsWallet && activeWalletAddress) {
      setMessage(null);
    }
  }, [isOpen, needsWallet, activeWalletAddress]);

  function applyPercent(percent: number) {
    const next = (BigInt(cashBaseUnits) * BigInt(percent)) / 100n;
    if (next > 0n) setAmount(formatTokenAmount(next.toString()));
  }

  function clearExternalDestination(resetProvider = false) {
    externalDestinationSessionRef.current += 1;
    setExternalDestinationAddress(null);
    setPendingExternalDestinationWallet(null);
    setExternalDestinationConnecting(false);
    setSelectedExternalWallet(null);
    setExternalWalletWarning(null);
    if (resetProvider) {
      void externalWallet.reset();
    }
  }

  function connectExternalDestination() {
    externalDestinationSessionRef.current += 1;
    setDestinationMode('external');
    setExternalDestinationAddress(null);
    setPendingExternalDestinationWallet(null);
    setExternalDestinationConnecting(false);
    setSelectedExternalWallet(null);
    setExternalWalletWarning(null);
    setMessage(null);
  }

  function handleExternalDestinationConnect(walletName: string) {
    const session = externalDestinationSessionRef.current + 1;
    externalDestinationSessionRef.current = session;
    setSelectedExternalWallet(walletName);
    setExternalDestinationConnecting(true);
    setExternalDestinationAddress(null);
    setPendingExternalDestinationWallet(null);
    setMessage(null);
    setExternalWalletWarning(null);
    void (async () => {
      await externalWallet.reset();
      return externalWallet.connectFresh(walletName);
    })().then((wallet) => {
      if (externalDestinationSessionRef.current !== session) return;
      const address = wallet.address;
      let warning: string | null = null;
      if (address === activeWalletAddress) {
        warning = 'This wallet matches your app identity wallet. Choose a different account in the extension if needed.';
      } else if (address === lastExternalDestinationAddress) {
        warning = 'Same wallet reselected. If you want a different account, switch it in the extension before connecting.';
      }
      setLastExternalDestinationAddress(address);
      setPendingExternalDestinationWallet({ address, walletName: wallet.walletName ?? walletName });
      setExternalWalletWarning(warning);
    }).catch((error: unknown) => {
      if (externalDestinationSessionRef.current !== session) return;
      setMessage(error instanceof Error ? error.message : 'Failed to connect wallet.');
    }).finally(() => {
      if (externalDestinationSessionRef.current === session) {
        setExternalDestinationConnecting(false);
      }
    });
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
          <div
            className="w-full max-w-[520px] rounded-lg border border-terminal-line bg-terminal-panel p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="h-8 w-8" />
              <div className="min-w-0 text-center">
                <h2 className="text-base font-black text-terminal-text">Withdraw</h2>
                {activeWalletAddress ? (
                  <p className="text-xs font-semibold text-terminal-muted">BUSDC Balance: {formatTokenAmount(cashBaseUnits)} BUSDC</p>
                ) : null}
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full border border-terminal-line text-terminal-muted transition hover:text-terminal-text"
                aria-label="Close withdraw"
                onClick={() => {
                  clearExternalDestination(true);
                  setIsOpen(false);
                }}
              >
                <X size={15} />
              </button>
            </div>

            {needsWallet ? (
              <div className="mt-6 flex flex-col items-center gap-4 pb-4 text-center">
                <Wallet size={32} className="text-terminal-muted" />
                <div>
                  <p className="text-sm font-black text-terminal-text">Solana cüzdanı bağla</p>
                  <p className="mt-1 text-xs font-semibold text-terminal-muted">Withdraw yapabilmek için Solana cüzdanını bağlaman gerekiyor.</p>
                </div>
                <Button
                  className="h-12 w-full max-w-[280px] text-sm"
                  disabled={!authenticated}
                  onClick={() => void loginSolana()}
                >
                  <Wallet size={16} /> Connect Solana wallet
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate();
                }}
              >
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
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      className={destinationMode === 'connected' ? destinationTabClass(true) : destinationTabClass(false)}
                      onClick={() => {
                        clearExternalDestination(true);
                        setDestinationMode('connected');
                      }}
                    >
                      Connected wallet
                    </button>
                    <button
                      type="button"
                      className={destinationMode === 'external' ? destinationTabClass(true) : destinationTabClass(false)}
                      onClick={connectExternalDestination}
                    >
                      External wallet
                    </button>
                    <button
                      type="button"
                      className={destinationMode === 'custom' ? destinationTabClass(true) : destinationTabClass(false)}
                      onClick={() => {
                        clearExternalDestination(true);
                        setDestinationMode('custom');
                      }}
                    >
                      Custom address
                    </button>
                  </div>
                  {destinationMode === 'connected' ? (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs font-mono text-terminal-muted">
                        {activeWalletAddress ? `${activeWalletAddress.slice(0, 4)}...${activeWalletAddress.slice(-4)}` : ''}
                      </span>
                    </div>
                  ) : null}
                  {destinationMode === 'external' ? (
                    <div className="mt-3">
                      {pendingExternalDestinationWallet ? (
                        <ExternalWalletAccountConfirmation
                          walletName={pendingExternalDestinationWallet.walletName}
                          address={pendingExternalDestinationWallet.address}
                          warning={externalWalletWarning}
                          onConfirm={() => {
                            setExternalDestinationAddress(pendingExternalDestinationWallet.address);
                            setPendingExternalDestinationWallet(null);
                          }}
                          onChooseAgain={() => clearExternalDestination(true)}
                        />
                      ) : !externalDestinationAddress && !externalDestinationConnecting ? (
                        <ExternalWalletSelector
                          mode="withdraw"
                          wallets={externalWallet.availableWallets}
                          connecting={externalDestinationConnecting}
                          connectingWalletName={selectedExternalWallet}
                          walletConnectQrUri={externalWallet.walletConnectQrUri}
                          walletConnectDeepLink={externalWallet.walletConnectDeepLink}
                          onClearWalletConnectQr={externalWallet.clearWalletConnectQr}
                          message={message}
                          onConnect={handleExternalDestinationConnect}
                        />
                      ) : externalDestinationConnecting ? (
                        <span className="text-xs text-terminal-muted">Connecting external wallet...</span>
                      ) : (
                        <span className="text-xs font-mono text-terminal-muted">
                          {externalDestinationAddress ? `${externalDestinationAddress.slice(0, 4)}...${externalDestinationAddress.slice(-4)}` : null}
                        </span>
                      )}
                      {externalWalletWarning && !pendingExternalDestinationWallet ? (
                        <p className="mt-2 text-xs font-semibold text-market-warning">{externalWalletWarning}</p>
                      ) : null}
                    </div>
                  ) : null}
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
                  disabled={setupPending || walletSigningPending || mutation.isPending || cashBaseUnits === '0' || (destinationMode === 'custom' && !customDestination.trim()) || (destinationMode === 'external' && (!externalDestinationAddress || externalDestinationConnecting))}
                >
                  {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Continue
                </Button>
              </form>
            )}
          </div>
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
