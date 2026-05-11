'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';
import { useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { ArrowRight, ChevronLeft, Copy, Loader2, QrCode, Send, Wallet, X } from 'lucide-react';
import { ApiClientError, api } from '@/lib/api/client';
import { cashBalanceQueryKey, cashBalanceQueryOptions } from '@/lib/api/cashBalanceQuery';
import { solanaRpcUrl } from '@/lib/api/env';
import type { DepositConfig, DepositVerification, TransferDepositAsset, TransferDepositQuote, SolDepositQuote } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/privy';
import Button from '@/lib/components/ui/Button';
import { formatTokenAmount, parseTokenAmountToBaseUnits } from '@/lib/utils/amount';
import { encodeDepositSignature } from './signature';

type DepositButtonProps = {
  walletAddress: string;
};

type DepositView = 'home' | 'wallet-assets' | 'wallet-amount' | 'transfer';
type DepositSource = 'wallet' | 'transfer';

const DEPOSIT_VERIFY_RETRY_DELAYS_MS = [1200, 1800, 2500];

export default function DepositButton({ walletAddress }: DepositButtonProps) {
  const queryClient = useQueryClient();
  const { getAccessToken, solanaWallet, solanaWalletsReady, solanaWalletResolving } = useAuth();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<DepositView>('home');
  const [source, setSource] = useState<DepositSource>('wallet');
  const [asset, setAsset] = useState<TransferDepositAsset>('BUSDC');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingWalletDepositSignature, setPendingWalletDepositSignature] = useState('');
  const [transferQuote, setTransferQuote] = useState<TransferDepositQuote | null>(null);
  const [transferSignature, setTransferSignature] = useState('');

  const configQuery = useQuery({
    queryKey: ['deposit-config'],
    queryFn: () => api.getDepositConfig(),
    staleTime: 30_000
  });
  const selectedWallet = solanaWallet?.address === walletAddress ? solanaWallet : null;
  const config = configQuery.data;
  const readyConfig = isDepositReady(config) ? config : null;
  const walletSigningPending = !solanaWalletsReady || solanaWalletResolving || !selectedWallet;
  const balancesQuery = useQuery({
    queryKey: ['deposit-balances', walletAddress, readyConfig?.mint],
    queryFn: () => readyConfig ? fetchDepositBalances(walletAddress, readyConfig) : null,
    enabled: Boolean(readyConfig && walletAddress),
    staleTime: 10_000
  });
  const setupPending = configQuery.isError || Boolean(config && !isDepositReady(config));
  const buttonLabel = depositButtonLabel(config, configQuery.isLoading, configQuery.isError);
  const cashQuery = useQuery(cashBalanceQueryOptions({ walletAddress }));
  const cashBalance = cashQuery.data?.status === 'ready' && cashQuery.data.cash_balance
    ? `${formatTokenAmount(cashQuery.data.cash_balance)} BUSDC`
    : cashQuery.isError
      ? 'API offline'
      : 'loading';

  const walletMutation = useMutation({
    mutationFn: async () => {
      if (configQuery.isError) {
        throw new Error(depositApiOfflineMessage());
      }
      if (!isDepositReady(config)) {
        throw new Error(depositSetupPendingMessage(config));
      }
      if (!solanaWalletsReady || solanaWalletResolving) {
        throw new Error('Solana wallet syncing. Try again in a moment.');
      }
      if (!selectedWallet) {
        throw new Error('Solana wallet unavailable');
      }
      if (pendingWalletDepositSignature) {
        const accessToken = await getAccessToken();
        return verifyDepositWithRetry({
          walletAddress,
          signature: pendingWalletDepositSignature,
          accessToken,
          onRetry: () => setMessage('Waiting for devnet confirmation; verifying again...')
        });
      }
      const baseUnits = parseTokenAmountToBaseUnits(amount, config.decimals);
      if (!baseUnits) {
        throw new Error('Invalid amount');
      }

      const balances = await fetchDepositBalances(walletAddress, config);
      if (asset === 'BUSDC') {
        if (chooseDepositFunding(balances.cashBaseUnits, baseUnits) !== 'busdc') {
          throw new Error('BUSDC balance is too low. Use the SOL option.');
        }
        const transaction = await buildDepositTransaction(walletAddress, config, baseUnits);
        const { signature } = await signAndSendTransaction({
          transaction,
          wallet: selectedWallet,
          chain: 'solana:devnet',
          options: {
            uiOptions: {
              buttonText: 'Approve deposit',
              description: `${formatTokenAmount(baseUnits)} BUSDC`
            }
          }
        });
        const accessToken = await getAccessToken();
        const encodedSignature = encodeDepositSignature(signature);
        setPendingWalletDepositSignature(encodedSignature);
        return verifyDepositWithRetry({
          walletAddress,
          signature: encodedSignature,
          accessToken,
          onRetry: () => setMessage('Waiting for devnet confirmation; verifying again...')
        });
      }

      const quote = await api.getSolDepositQuote(walletAddress, baseUnits);
      if (!isReadySolDepositQuote(quote)) {
        throw new Error(solDepositQuoteMessage(quote, config));
      }
      if (BigInt(balances.solLamports) <= BigInt(quote.lamports) + 5_000n) {
        throw new Error('SOL balance is too low for the deposit and network fee.');
      }

      const transaction = await buildSolDepositTransaction(walletAddress, quote);
      const { signature } = await signAndSendTransaction({
        transaction,
        wallet: selectedWallet,
        chain: 'solana:devnet',
        options: {
          uiOptions: {
            buttonText: 'Approve SOL deposit',
            description: `${formatTokenAmount(baseUnits)} BUSDC icin SOL ode`
          }
        }
      });
      const accessToken = await getAccessToken();
      return verifySolDepositWithRetry({
        walletAddress,
        quoteId: quote.quote_id,
        signature: encodeDepositSignature(signature),
        accessToken,
        onRetry: () => setMessage('Waiting for devnet confirmation; verifying again...')
      });
    },
    onSuccess: (result) => {
      setAmount('');
      setPendingWalletDepositSignature('');
      setMessage(`Credited ${formatTokenAmount(result.deposited_amount)} BUSDC`);
      for (const queryKey of depositSuccessInvalidationKeys(walletAddress)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (error) => {
      setPendingWalletDepositSignature((signature) => pendingWalletDepositSignatureAfterError(error, signature));
      setMessage(depositErrorMessage(error));
    }
  });

  const transferQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!isDepositReady(config)) {
        throw new Error(configQuery.isError ? depositApiOfflineMessage() : depositSetupPendingMessage(config));
      }
      const baseUnits = parseTokenAmountToBaseUnits(amount, config.decimals);
      if (!baseUnits) {
        throw new Error('Invalid amount');
      }
      const accessToken = await getAccessToken();
      return api.createTransferDepositQuote(walletAddress, asset, baseUnits, accessToken);
    },
    onSuccess: (quote) => {
      setTransferQuote(quote);
      setTransferSignature('');
      setMessage(manualTransferQuoteMessage(quote, config));
    },
    onError: (error) => {
      setMessage(depositErrorMessage(error));
    }
  });

  const transferVerifyMutation = useMutation({
    mutationFn: async () => {
      if (!transferQuote?.quote_id) {
        throw new Error('Create a transfer quote first.');
      }
      const signature = transferSignature.trim();
      if (!signature) {
        throw new Error('Enter a transaction signature.');
      }
      const accessToken = await getAccessToken();
      return api.verifyTransferDeposit(walletAddress, transferQuote.quote_id, signature, accessToken);
    },
    onSuccess: (result) => {
      setAmount('');
      setTransferSignature('');
      setMessage(`Credited ${formatTokenAmount(result.deposited_amount)} BUSDC`);
      for (const queryKey of depositSuccessInvalidationKeys(walletAddress)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (error) => {
      setMessage(depositErrorMessage(error));
    }
  });

  function openDeposit() {
    setView('home');
    setSource('wallet');
    setAsset('BUSDC');
    setAmount('');
    setPendingWalletDepositSignature('');
    setMessage(configQuery.isError ? depositApiOfflineMessage() : isDepositReady(config) ? null : depositSetupPendingMessage(config));
    setTransferQuote(null);
    setTransferSignature('');
    setIsOpen(true);
  }

  function selectWalletAsset(nextAsset: TransferDepositAsset) {
    setSource('wallet');
    setAsset(nextAsset);
    setAmount('');
    setPendingWalletDepositSignature('');
    setMessage(null);
    setView('wallet-amount');
  }

  function openTransferCrypto() {
    setSource('transfer');
    setAsset('BUSDC');
    setAmount('');
    setPendingWalletDepositSignature('');
    setTransferQuote(null);
    setTransferSignature('');
    setMessage(null);
    setView('transfer');
  }

  function applyAmountPercent(percent: number) {
    const baseUnits = maxCashBaseUnitsForAsset(asset, balancesQuery.data);
    if (!baseUnits || baseUnits === '0') return;
    const next = (BigInt(baseUnits) * BigInt(percent)) / 100n;
    setAmount(formatTokenAmount(next.toString()));
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-market-positive/45 bg-market-positive/10 px-4 text-sm font-black text-terminal-text transition hover:border-market-positive/70 hover:bg-market-positive/18 disabled:cursor-not-allowed disabled:border-terminal-line disabled:bg-terminal-panel disabled:text-terminal-muted"
        aria-label="Deposit"
        disabled={configQuery.isLoading}
        onClick={openDeposit}
      >
        <Wallet size={16} /> {buttonLabel}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm" role="presentation">
          <form
            className="w-full max-w-[520px] rounded-lg border border-terminal-line bg-terminal-panel p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Deposit"
            onSubmit={(event) => {
              event.preventDefault();
              if (view === 'wallet-amount') {
                walletMutation.mutate();
              } else if (view === 'transfer') {
                transferQuoteMutation.mutate();
              }
            }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full border border-transparent text-terminal-muted transition hover:text-terminal-text disabled:opacity-0"
                aria-label="Back"
                disabled={view === 'home'}
                onClick={() => {
                  setMessage(null);
                  setPendingWalletDepositSignature('');
                  setView(view === 'wallet-amount' ? 'wallet-assets' : 'home');
                }}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="min-w-0 text-center">
                <h2 className="text-base font-black text-terminal-text">Deposit</h2>
                <p className="text-xs font-semibold text-terminal-muted">BUSDC Balance: {cashBalance}</p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full border border-terminal-line text-terminal-muted transition hover:text-terminal-text"
                aria-label="Close deposit"
                onClick={() => {
                  setPendingWalletDepositSignature('');
                  setIsOpen(false);
                }}
              >
                <X size={15} />
              </button>
            </div>

            {view === 'home' ? (
              <DepositHome
                walletAddress={walletAddress}
                balances={balancesQuery.data}
                onConnectedWallet={() => {
                  setMessage(null);
                  setView('wallet-assets');
                }}
                onTransferCrypto={openTransferCrypto}
              />
            ) : null}

            {view === 'wallet-assets' ? (
              <WalletAssetList
                balances={balancesQuery.data}
                onSelect={selectWalletAsset}
              />
            ) : null}

            {view === 'wallet-amount' ? (
              <WalletAmountStep
                asset={asset}
                amount={amount}
                balances={balancesQuery.data}
                selectedWalletAddress={selectedWallet?.address}
                config={config}
                configError={configQuery.isError}
                message={message}
                isPending={walletMutation.isPending}
                hasPendingSignature={Boolean(pendingWalletDepositSignature)}
                setupPending={setupPending}
                walletSigningPending={walletSigningPending}
                buttonLabel={buttonLabel}
                onAmountChange={(nextAmount) => {
                  setPendingWalletDepositSignature('');
                  setAmount(nextAmount);
                }}
                onApplyPercent={applyAmountPercent}
              />
            ) : null}

            {view === 'transfer' ? (
              <TransferCryptoStep
                asset={asset}
                amount={amount}
                config={config}
                message={message}
                quote={transferQuote}
                signature={transferSignature}
                isQuotePending={transferQuoteMutation.isPending}
                isVerifyPending={transferVerifyMutation.isPending}
                onAssetChange={(nextAsset) => {
                  setAsset(nextAsset);
                  setTransferQuote(null);
                  setTransferSignature('');
                  setMessage(null);
                }}
                onAmountChange={(nextAmount) => {
                  setAmount(nextAmount);
                  setTransferQuote(null);
                  setTransferSignature('');
                  setMessage(null);
                }}
                onSignatureChange={setTransferSignature}
                onVerify={() => transferVerifyMutation.mutate()}
              />
            ) : null}
          </form>
        </div>
      ) : null}
    </>
  );
}

function DepositHome({
  walletAddress,
  balances,
  onConnectedWallet,
  onTransferCrypto
}: {
  walletAddress: string;
  balances?: DepositBalances | null;
  onConnectedWallet: () => void;
  onTransferCrypto: () => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <p className="mb-2 text-xs font-black text-terminal-muted">Connected</p>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border border-terminal-line bg-terminal-bg px-4 py-4 text-left transition hover:border-market-positive/60"
          onClick={onConnectedWallet}
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-market-positive/20 text-terminal-text">
            <Wallet size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-terminal-text">Wallet ({shortWalletAddress(walletAddress)})</span>
            <span className="block text-xs font-semibold text-terminal-muted">
              {walletSummaryText(balances)} · Instant
            </span>
          </span>
          <ArrowRight size={16} className="text-terminal-muted" />
        </button>
      </section>

      <section>
        <p className="mb-2 text-xs font-black text-terminal-muted">Other options</p>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border border-terminal-line bg-terminal-bg px-4 py-4 text-left transition hover:border-market-positive/60"
          onClick={onTransferCrypto}
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-terminal-line text-terminal-text">
            <QrCode size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-terminal-text">Transfer Crypto</span>
            <span className="block text-xs font-semibold text-terminal-muted">No limit · Signature required</span>
          </span>
          <span className="hidden text-xs font-bold text-terminal-muted sm:inline">SOL · BUSDC</span>
        </button>
      </section>
    </div>
  );
}

function WalletAssetList({
  balances,
  onSelect
}: {
  balances?: DepositBalances | null;
  onSelect: (asset: TransferDepositAsset) => void;
}) {
  const busdc = balances?.cashBaseUnits ?? '0';
  const sol = balances?.solLamports ?? '0';
  return (
    <div className="space-y-2">
      <AssetRow
        asset="BUSDC"
        balance={`${formatTokenAmount(busdc)} BUSDC`}
        badge={BigInt(busdc) > 0n ? 'Ready' : 'Low Balance'}
        onClick={() => onSelect('BUSDC')}
      />
      <AssetRow
        asset="SOL"
        balance={`${formatSolFromLamports(sol)} SOL`}
        badge={BigInt(sol) > 5_000n ? 'Ready' : 'Low Balance'}
        onClick={() => onSelect('SOL')}
      />
    </div>
  );
}

function AssetRow({
  asset,
  balance,
  badge,
  onClick
}: {
  asset: TransferDepositAsset;
  balance: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border border-terminal-line bg-terminal-bg px-4 py-4 text-left transition hover:border-market-positive/60"
      onClick={onClick}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-market-positive/15 text-terminal-text">
        {asset === 'SOL' ? 'S' : '$'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-terminal-text">{asset}</span>
        <span className="block text-xs font-semibold text-terminal-muted">{balance}</span>
      </span>
      <span className="rounded-full bg-terminal-panel-strong px-2 py-1 text-xs font-bold text-terminal-muted">{badge}</span>
    </button>
  );
}

function WalletAmountStep({
  asset,
  amount,
  balances,
  selectedWalletAddress,
  config,
  configError,
  message,
  isPending,
  hasPendingSignature,
  setupPending,
  walletSigningPending,
  buttonLabel,
  onAmountChange,
  onApplyPercent
}: {
  asset: TransferDepositAsset;
  amount: string;
  balances?: DepositBalances | null;
  selectedWalletAddress?: string;
  config?: DepositConfig;
  configError: boolean;
  message: string | null;
  isPending: boolean;
  hasPendingSignature: boolean;
  setupPending: boolean;
  walletSigningPending: boolean;
  buttonLabel: string;
  onAmountChange: (amount: string) => void;
  onApplyPercent: (percent: number) => void;
}) {
  return (
    <div>
      <AmountInput amount={amount} onAmountChange={onAmountChange} />
      <PercentButtons onApplyPercent={onApplyPercent} disabled={!maxCashBaseUnitsForAsset(asset, balances)} />
      <div className="mt-12 flex justify-center">
        <div className="inline-flex items-center gap-3 rounded-full bg-terminal-bg px-4 py-3">
          <span className="text-xs font-semibold text-terminal-muted">You send<br /><span className="text-sm font-black text-terminal-text">{asset}</span></span>
          <ArrowRight size={18} className="text-terminal-muted" />
          <span className="text-xs font-semibold text-terminal-muted">You receive<br /><span className="text-sm font-black text-terminal-text">App BUSDC</span></span>
        </div>
      </div>
      <div className="mt-4 min-h-5 text-xs font-semibold text-terminal-muted">
        {message ?? (walletSigningPending ? 'Solana wallet syncing. Try again in a moment.' : depositModalMessage(config, balances, amount, selectedWalletAddress, configError, asset))}
      </div>
      <Button type="submit" className="mt-4 h-12 w-full text-sm" disabled={setupPending || walletSigningPending || isPending}>
        {isPending ? <Loader2 size={16} className="animate-spin" /> : hasPendingSignature ? <Wallet size={16} /> : <Send size={16} />}
        {setupPending ? buttonLabel : hasPendingSignature ? 'Verify again' : 'Continue'}
      </Button>
    </div>
  );
}

function TransferCryptoStep({
  asset,
  amount,
  config,
  message,
  quote,
  signature,
  isQuotePending,
  isVerifyPending,
  onAssetChange,
  onAmountChange,
  onSignatureChange,
  onVerify
}: {
  asset: TransferDepositAsset;
  amount: string;
  config: DepositConfig | undefined;
  message: string | null;
  quote: TransferDepositQuote | null;
  signature: string;
  isQuotePending: boolean;
  isVerifyPending: boolean;
  onAssetChange: (asset: TransferDepositAsset) => void;
  onAmountChange: (amount: string) => void;
  onSignatureChange: (signature: string) => void;
  onVerify: () => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {(['BUSDC', 'SOL'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`rounded-lg border px-3 py-3 text-sm font-black ${asset === candidate ? 'border-market-positive bg-market-positive/10 text-terminal-text' : 'border-terminal-line bg-terminal-bg text-terminal-muted'}`}
            onClick={() => onAssetChange(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>
      <AmountInput amount={amount} onAmountChange={onAmountChange} />
      <Button type="submit" className="mt-4 h-11 w-full text-sm" disabled={isQuotePending}>
        {isQuotePending ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
        Create transfer quote
      </Button>

      {quote ? <TransferInstructions quote={quote} config={config} /> : null}

      <label className="mt-4 block text-xs font-bold text-terminal-muted" htmlFor="transfer-signature">
        Transaction signature
      </label>
      <input
        id="transfer-signature"
        value={signature}
        placeholder="Paste devnet signature"
        className="mt-2 h-10 w-full rounded-lg border border-terminal-line bg-terminal-bg px-3 text-xs font-semibold text-terminal-text outline-none placeholder:text-terminal-muted focus:border-market-positive"
        onChange={(event) => onSignatureChange(event.target.value)}
      />
      <Button type="button" className="mt-3 h-11 w-full text-sm" disabled={!quote?.quote_id || isVerifyPending} onClick={onVerify}>
        {isVerifyPending ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
        Verify transfer
      </Button>
      <div className="mt-3 min-h-5 text-xs font-semibold text-terminal-muted">
        {message ?? 'Enter the signature after transferring from another wallet or exchange.'}
      </div>
    </div>
  );
}

function AmountInput({ amount, onAmountChange }: { amount: string; onAmountChange: (amount: string) => void }) {
  return (
    <div className="mt-6 text-center">
      <label className="sr-only" htmlFor="deposit-amount">Amount</label>
      <div className="flex items-center justify-center">
        <span className="text-5xl font-black text-terminal-text">$</span>
        <input
          id="deposit-amount"
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          className="min-w-0 max-w-[260px] bg-transparent text-center text-5xl font-black text-terminal-text outline-none placeholder:text-terminal-muted"
          onChange={(event) => onAmountChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function PercentButtons({ onApplyPercent, disabled }: { onApplyPercent: (percent: number) => void; disabled: boolean }) {
  return (
    <div className="mt-6 grid grid-cols-4 gap-2">
      {[25, 50, 75, 100].map((percent) => (
        <button
          key={percent}
          type="button"
          className="rounded-lg bg-terminal-bg px-3 py-3 text-sm font-black text-terminal-text disabled:opacity-40"
          disabled={disabled}
          onClick={() => onApplyPercent(percent)}
        >
          {percent === 100 ? 'Max' : `${percent}%`}
        </button>
      ))}
    </div>
  );
}

function TransferInstructions({ quote, config }: { quote: TransferDepositQuote; config: DepositConfig | undefined }) {
  if (quote.status === 'liquidity_pending') {
    return (
      <div className="mt-4 space-y-2 rounded-lg border border-market-warning/40 bg-market-warning/10 p-3 text-xs font-semibold text-market-warning">
        <p>Vault reserve is missing or too low. Add app/admin devnet BUSDC reserve before SOL transfers can be credited as App BUSDC.</p>
        {config?.vault_token_account ? <InstructionRow label="Vault ATA" value={config.vault_token_account} /> : null}
        <InstructionRow label="Command" value="npm run reserve:devnet-cash -- --amount <BUSDC>" />
      </div>
    );
  }
  if (quote.status !== 'ready') {
    return (
      <div className="mt-4 rounded-lg border border-terminal-line bg-terminal-bg p-3 text-xs font-semibold text-terminal-muted">
        Transfer setup pending. API config is not ready.
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-terminal-line bg-terminal-bg p-3 text-xs">
      <p className="font-black text-terminal-text">Send exact {quote.asset}</p>
      <InstructionRow label="Destination" value={quote.destination ?? ''} />
      {quote.mint ? <InstructionRow label="Mint" value={quote.mint} /> : null}
      <InstructionRow label={quote.asset === 'SOL' ? 'Lamports' : 'Base units'} value={quote.transfer_amount ?? ''} />
      <InstructionRow label="Memo" value={quote.reference ?? ''} />
    </div>
  );
}

function InstructionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-terminal-panel px-2 py-2">
      <span className="w-24 shrink-0 font-bold text-terminal-muted">{label}</span>
      <span className="min-w-0 flex-1 break-all font-mono text-terminal-text">{value}</span>
      <Copy size={13} className="shrink-0 text-terminal-muted" />
    </div>
  );
}

export function depositButtonLabel(config: DepositConfig | undefined, isLoading: boolean, isError = false) {
  if (isError) return 'API offline';
  return isLoading || isDepositReady(config) ? 'Deposit' : 'Setup pending';
}

export function depositApiOfflineMessage() {
  return 'API offline. Could not read deposit config; check that the 127.0.0.1:8080 API is running.';
}

export function depositSetupPendingMessage(config: DepositConfig | undefined) {
  if (!config || config.status === 'projection_pending') {
    return 'Devnet BUSDC setup pending. API .env needs SOLANA_CASH_MINT and SOLANA_DEPOSIT_VAULT_OWNER.';
  }
  return 'Deposit setup pending. Restart API after updating devnet cash config.';
}

type DepositBalances = {
  cashBaseUnits: string;
  solLamports: string;
};

export function chooseDepositFunding(cashBaseUnits: string | null | undefined, requestedBaseUnits: string) {
  return BigInt(cashBaseUnits ?? '0') >= BigInt(requestedBaseUnits) ? 'busdc' : 'sol';
}

export function solDepositQuoteMessage(quote: Pick<SolDepositQuote, 'status'>, config?: DepositConfig) {
  if (quote.status === 'liquidity_pending') {
    const vault = config?.vault_token_account ? ` Vault ATA: ${config.vault_token_account}.` : '';
    return `Liquidity pending: Vault reserve is missing or too low. Add app/admin devnet BUSDC reserve before SOL deposits can be credited as App BUSDC.${vault} Dev command: npm run reserve:devnet-cash -- --amount <BUSDC>`;
  }
  return 'SOL deposit setup pending. API config or price service is not ready.';
}

export function manualTransferQuoteMessage(quote: Pick<TransferDepositQuote, 'status' | 'asset'>, config?: DepositConfig) {
  if (quote.status === 'ready') {
    return `${quote.asset} transfer quote is ready. Transfer the exact amount with the memo/reference.`;
  }
  if (quote.status === 'liquidity_pending') {
    const vault = config?.vault_token_account ? ` Vault ATA: ${config.vault_token_account}.` : '';
    return `Liquidity pending: Vault reserve is missing or too low. Transfer Crypto SOL requires app/admin BUSDC reserve.${vault} Dev command: npm run reserve:devnet-cash -- --amount <BUSDC>`;
  }
  return 'Transfer deposit setup pending. API config is not ready.';
}

export function isTransientDepositVerifyError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
    && (error.code === 'deposit_not_confirmed' || error.code === 'deposit_transaction_unavailable');
}

export function pendingWalletDepositSignatureAfterError(error: unknown, signature: string) {
  return signature && isTransientDepositVerifyError(error) ? signature : '';
}

export function depositSuccessInvalidationKeys(walletAddress: string) {
  return [
    cashBalanceQueryKey(walletAddress),
    ['deposit-balances', walletAddress] as const
  ];
}

export function depositErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : 'Deposit failed';
  }

  const withRequestId = (message: string) => error.requestId ? `${message} Request: ${error.requestId}` : message;
  switch (error.code) {
    case 'deposit_not_confirmed':
    case 'deposit_transaction_unavailable':
      return withRequestId('Transaction is not confirmed on devnet yet. Try again in a few seconds.');
    case 'sol_deposit_quote_expired':
    case 'transfer_deposit_quote_expired':
      return withRequestId('Quote expired. Press Continue again to get a new quote.');
    case 'deposit_wrong_signer':
    case 'wrong_signer':
      return withRequestId('This transfer was not signed by the connected Solana wallet. Try again with the correct wallet.');
    case 'sol_deposit_wrong_source':
    case 'deposit_wrong_source_owner':
    case 'deposit_wrong_authority':
      return withRequestId('Transfer source does not match the connected wallet. Try again with the correct Solana wallet.');
    case 'sol_deposit_wrong_treasury':
    case 'wrong_treasury':
      return withRequestId('SOL transfer was sent to the wrong treasury. Get a new quote and try again.');
    case 'sol_deposit_wrong_lamports':
    case 'sol_deposit_missing_lamports':
    case 'wrong_lamports':
      return withRequestId('SOL transfer amount does not match the quote. Get a new quote and try again.');
    case 'sol_deposit_liquidity_pending':
    case 'transfer_deposit_liquidity_pending':
    case 'liquidity_pending':
      return withRequestId('Liquidity pending: Vault reserve is missing or too low. Add app/admin devnet BUSDC reserve before SOL deposits can be credited as App BUSDC.');
    case 'sol_deposit_quote_used':
    case 'transfer_deposit_quote_used':
      return withRequestId('This quote has already been used. Get a new quote.');
    case 'sol_deposit_quote_not_found':
    case 'transfer_deposit_quote_not_found':
      return withRequestId('Quote not found. Get a new quote and try again.');
    case 'sol_deposit_quote_wallet_mismatch':
    case 'transfer_deposit_quote_wallet_mismatch':
      return withRequestId('Quote does not match this wallet. Get a new quote with the correct wallet.');
    case 'sol_deposit_treasury_mismatch':
    case 'transfer_deposit_destination_mismatch':
      return withRequestId('Quote does not match the current config. Refresh the page and try again.');
    case 'sol_deposit_price_unavailable':
      return withRequestId('SOL price is unavailable right now. Try again shortly.');
    case 'deposit_wrong_mint':
      return withRequestId('BUSDC mint does not match the config. Try again with the configured devnet BUSDC mint.');
    case 'deposit_wrong_vault':
      return withRequestId('BUSDC transfer was sent to the wrong vault. Start a new deposit.');
    case 'deposit_transfer_not_found':
    case 'sol_deposit_transfer_not_found':
    case 'transfer_deposit_transfer_not_found':
      return withRequestId('Expected transfer was not found in this transaction. Make sure the signature is correct.');
    case 'deposit_signature_already_used':
      return withRequestId('This signature has already been used. App BUSDC will not be credited again.');
    default:
      return withRequestId(error.message);
  }
}

export function depositModalMessage(
  config: DepositConfig | undefined,
  balances: DepositBalances | null | undefined,
  amount: string,
  fallbackAddress?: string,
  configError = false,
  asset: TransferDepositAsset = 'BUSDC'
) {
  if (configError) return depositApiOfflineMessage();
  if (!isDepositReady(config)) return depositSetupPendingMessage(config);
  const baseUnits = parseTokenAmountToBaseUnits(amount, config.decimals);
  if (!baseUnits || !balances) return fallbackAddress;
  if (asset === 'BUSDC') {
    return chooseDepositFunding(balances.cashBaseUnits, baseUnits) === 'busdc'
      ? `${formatTokenAmount(balances.cashBaseUnits)} BUSDC wallet balance available for deposit.`
      : 'BUSDC balance is too low. Go back and use the SOL option.';
  }
  return 'SOL will be used for this deposit. Your Solana wallet will ask you to sign a SOL transfer.';
}

export function shortWalletAddress(address: string) {
  return address.length <= 10 ? address : `...${address.slice(-4)}`;
}

export function formatSolFromLamports(lamports: string | null | undefined) {
  const value = BigInt(lamports ?? '0');
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').slice(0, 4);
  return `${whole}.${fraction}`;
}

function walletSummaryText(balances?: DepositBalances | null) {
  if (!balances) return 'Loading balances';
  return `${formatTokenAmount(balances.cashBaseUnits)} BUSDC · ${formatSolFromLamports(balances.solLamports)} SOL`;
}

function maxCashBaseUnitsForAsset(asset: TransferDepositAsset, balances?: DepositBalances | null) {
  if (asset !== 'BUSDC') return null;
  return balances?.cashBaseUnits ?? null;
}

function isDepositReady(config: DepositConfig | undefined): config is DepositConfig & {
  mint: string;
  vault_owner: string;
  vault_token_account: string;
} {
  return Boolean(
    config
      && config.status === 'ready'
      && config.cluster === 'devnet'
      && config.mint
      && config.vault_owner
      && config.vault_token_account
  );
}

async function buildDepositTransaction(
  walletAddress: string,
  config: DepositConfig & { mint: string; vault_owner: string; vault_token_account: string },
  amount: string
) {
  const rpc = createSolanaRpc(solanaRpcUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const owner = address(walletAddress);
  const ownerSigner = createNoopSigner(owner);
  const mint = address(config.mint);
  const vaultOwner = address(config.vault_owner);
  const vaultTokenAccount = address(config.vault_token_account);
  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const [derivedVaultTokenAccount] = await findAssociatedTokenPda({
    owner: vaultOwner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const maybeCreateVaultAta = derivedVaultTokenAccount === vaultTokenAccount
    ? [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: ownerSigner,
          ata: vaultTokenAccount,
          owner: vaultOwner,
          mint
        })
      ]
    : [];
  const transfer = getTransferCheckedInstruction({
    source: sourceTokenAccount,
    mint,
    destination: vaultTokenAccount,
    authority: ownerSigner,
    amount: BigInt(amount),
    decimals: config.decimals
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(ownerSigner, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions([...maybeCreateVaultAta, transfer], transactionMessage)
  );

  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

async function buildSolDepositTransaction(
  walletAddress: string,
  quote: SolDepositQuote & { quote_id: string; lamports: string; treasury: string }
) {
  const rpc = createSolanaRpc(solanaRpcUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const owner = address(walletAddress);
  const ownerSigner = createNoopSigner(owner);
  const transfer = getTransferSolInstruction({
    source: ownerSigner,
    destination: address(quote.treasury),
    amount: BigInt(quote.lamports)
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(ownerSigner, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) => appendTransactionMessageInstructions([transfer], transactionMessage)
  );

  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

async function fetchDepositBalances(
  walletAddress: string,
  config: DepositConfig & { mint: string; vault_owner: string; vault_token_account: string }
): Promise<DepositBalances> {
  const rpc = createSolanaRpc(solanaRpcUrl);
  const owner = address(walletAddress);
  const mint = address(config.mint);
  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint
  });
  const [solBalance, cashBalance] = await Promise.all([
    rpc.getBalance(owner, { commitment: 'confirmed' }).send(),
    rpc.getTokenAccountBalance(sourceTokenAccount, { commitment: 'confirmed' }).send().catch(() => null)
  ]);

  return {
    cashBaseUnits: cashBalance?.value.amount ?? '0',
    solLamports: solBalance.value.toString()
  };
}

function isReadySolDepositQuote(quote: SolDepositQuote): quote is SolDepositQuote & {
  quote_id: string;
  lamports: string;
  treasury: string;
} {
  return Boolean(quote.status === 'ready' && quote.quote_id && quote.lamports && quote.treasury);
}

async function verifySolDepositWithRetry({
  walletAddress,
  quoteId,
  signature,
  accessToken,
  onRetry
}: {
  walletAddress: string;
  quoteId: string;
  signature: string;
  accessToken?: string | null;
  onRetry?: (attempt: number, error: ApiClientError) => void;
}) {
  for (let attempt = 0; attempt <= DEPOSIT_VERIFY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await api.verifySolDeposit(walletAddress, quoteId, signature, accessToken);
    } catch (error) {
      if (
        !isTransientDepositVerifyError(error)
        || attempt >= DEPOSIT_VERIFY_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      onRetry?.(attempt + 1, error);
      await delay(DEPOSIT_VERIFY_RETRY_DELAYS_MS[attempt] ?? 1000);
    }
  }

  throw new Error('SOL deposit verify failed');
}

export async function verifyDepositWithRetry({
  walletAddress,
  signature,
  accessToken,
  onRetry,
  verifyDeposit = api.verifyDeposit,
  retryDelaysMs = DEPOSIT_VERIFY_RETRY_DELAYS_MS,
  sleep = delay
}: {
  walletAddress: string;
  signature: string;
  accessToken?: string | null;
  onRetry?: (attempt: number, error: ApiClientError) => void;
  verifyDeposit?: (address: string, signature: string, accessToken?: string | null) => Promise<DepositVerification>;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await verifyDeposit(walletAddress, signature, accessToken);
    } catch (error) {
      if (
        !isTransientDepositVerifyError(error)
        || attempt >= retryDelaysMs.length
      ) {
        throw error;
      }
      onRetry?.(attempt + 1, error);
      await sleep(retryDelaysMs[attempt] ?? 1000);
    }
  }

  throw new Error('BUSDC deposit verify failed');
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
