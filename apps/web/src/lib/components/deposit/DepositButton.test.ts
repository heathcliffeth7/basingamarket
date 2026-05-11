import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import {
  chooseDepositFunding,
  depositApiOfflineMessage,
  depositButtonLabel,
  depositErrorMessage,
  depositModalMessage,
  depositSuccessInvalidationKeys,
  depositSetupPendingMessage,
  formatSolFromLamports,
  isTransientDepositVerifyError,
  manualTransferQuoteMessage,
  pendingWalletDepositSignatureAfterError,
  shortWalletAddress,
  solDepositQuoteMessage,
  verifyDepositWithRetry
} from './DepositButton';

describe('DepositButton setup state', () => {
  it('shows setup pending when devnet cash config is incomplete', () => {
    const pendingConfig = {
      cluster: 'devnet' as const,
      currency: 'BUSDC' as const,
      decimals: 6 as const,
      mint: null,
      vault_owner: null,
      vault_token_account: null,
      commitment: 'confirmed' as const,
      status: 'projection_pending' as const
    };

    expect(depositButtonLabel(pendingConfig, false)).toBe('Setup pending');
    expect(depositSetupPendingMessage(pendingConfig)).toContain('SOLANA_CASH_MINT');
  });

  it('keeps deposit label when config is loading or ready', () => {
    const readyConfig = {
      cluster: 'devnet' as const,
      currency: 'BUSDC' as const,
      decimals: 6 as const,
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      vault_owner: 'So11111111111111111111111111111111111111112',
      vault_token_account: '9VgAk7ro7kVQZwGTQ6aoQ24ZY75hGdjL7ST4Tq3c4Eqf',
      commitment: 'confirmed' as const,
      status: 'ready' as const
    };

    expect(depositButtonLabel(undefined, true)).toBe('Deposit');
    expect(depositButtonLabel(readyConfig, false)).toBe('Deposit');
    expect(depositButtonLabel(undefined, false, true)).toBe('API offline');
    expect(depositApiOfflineMessage()).toContain('API offline');
  });

  it('chooses SOL funding when wallet BUSDC is below requested deposit', () => {
    expect(chooseDepositFunding('2000000', '1000000')).toBe('busdc');
    expect(chooseDepositFunding('999999', '1000000')).toBe('sol');
  });

  it('maps SOL quote pending states to English deposit messages', () => {
    expect(solDepositQuoteMessage({ status: 'liquidity_pending' })).toContain('Liquidity pending');
    expect(solDepositQuoteMessage({ status: 'liquidity_pending' })).toContain('Vault reserve');
    expect(solDepositQuoteMessage({ status: 'liquidity_pending' })).toContain('reserve:devnet-cash');
    expect(solDepositQuoteMessage({ status: 'projection_pending' })).toContain('setup pending');
  });

  it('explains when the modal will use SOL because wallet BUSDC is insufficient', () => {
    const readyConfig = {
      cluster: 'devnet' as const,
      currency: 'BUSDC' as const,
      decimals: 6 as const,
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      vault_owner: 'So11111111111111111111111111111111111111112',
      vault_token_account: '9VgAk7ro7kVQZwGTQ6aoQ24ZY75hGdjL7ST4Tq3c4Eqf',
      commitment: 'confirmed' as const,
      status: 'ready' as const
    };

    expect(
      depositModalMessage(
        readyConfig,
        { cashBaseUnits: '0', solLamports: '1000000000' },
        '1.00',
        '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        false,
        'SOL'
      )
    ).toContain('SOL will be used');
  });

  it('formats connected wallet labels and SOL balances', () => {
    expect(shortWalletAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')).toBe('...ncDU');
    expect(formatSolFromLamports('1234567890')).toBe('1.2345');
  });

  it('maps manual transfer quote states to clear instructions', () => {
    expect(manualTransferQuoteMessage({ asset: 'BUSDC', status: 'ready' })).toContain('reference');
    expect(manualTransferQuoteMessage({ asset: 'SOL', status: 'liquidity_pending' })).toContain('Vault reserve');
    expect(manualTransferQuoteMessage({ asset: 'SOL', status: 'liquidity_pending' })).toContain('reserve:devnet-cash');
    expect(manualTransferQuoteMessage({ asset: 'SOL', status: 'projection_pending' })).toContain('setup pending');
  });

  it('maps backend deposit errors to actionable English messages', () => {
    const notConfirmed = new ApiClientError({
      status: 400,
      code: 'deposit_not_confirmed',
      message: 'Deposit transaction is not confirmed yet.',
      requestId: 'req-1',
      path: '/profiles/wallet/sol-deposits'
    });
    const expired = new ApiClientError({
      status: 400,
      code: 'sol_deposit_quote_expired',
      message: 'Quote has expired.',
      path: '/profiles/wallet/sol-deposits'
    });
    const wrongLamports = new ApiClientError({
      status: 400,
      code: 'sol_deposit_wrong_lamports',
      message: 'SOL transfer amount does not match the quote.',
      path: '/profiles/wallet/sol-deposits'
    });
    const liquidity = new ApiClientError({
      status: 503,
      code: 'sol_deposit_liquidity_pending',
      message: 'App vault BUSDC reserve is too low.',
      path: '/profiles/wallet/sol-deposits'
    });

    expect(depositErrorMessage(notConfirmed)).toContain('confirmed');
    expect(depositErrorMessage(notConfirmed)).toContain('req-1');
    expect(depositErrorMessage(expired)).toContain('Quote expired');
    expect(depositErrorMessage(wrongLamports)).toContain('quote');
    expect(depositErrorMessage(liquidity)).toContain('Vault reserve');
  });

  it('detects temporary SOL verify states for retry', () => {
    expect(isTransientDepositVerifyError(new ApiClientError({
      status: 400,
      code: 'deposit_not_confirmed',
      path: '/profiles/wallet/sol-deposits'
    }))).toBe(true);
    expect(isTransientDepositVerifyError(new ApiClientError({
      status: 400,
      code: 'deposit_transaction_unavailable',
      path: '/profiles/wallet/sol-deposits'
    }))).toBe(true);
    expect(isTransientDepositVerifyError(new ApiClientError({
      status: 400,
      code: 'sol_deposit_quote_expired',
      path: '/profiles/wallet/sol-deposits'
    }))).toBe(false);
  });

  it('retries BUSDC wallet deposit verify when devnet confirmation is still catching up', async () => {
    const transient = new ApiClientError({
      status: 400,
      code: 'deposit_not_confirmed',
      path: '/profiles/wallet/deposits'
    });
    const credited = {
      wallet_address: 'wallet',
      signature: 'signature',
      currency: 'BUSDC' as const,
      decimals: 6,
      cash_balance: '5000000',
      deposited_amount: '5000000',
      status: 'credited' as const
    };
    const verifyDeposit = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(credited);
    const sleptMs: number[] = [];
    const retryAttempts: number[] = [];

    await expect(verifyDepositWithRetry({
      walletAddress: 'wallet',
      signature: 'signature',
      accessToken: 'token',
      verifyDeposit,
      retryDelaysMs: [25],
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
      onRetry: (attempt) => {
        retryAttempts.push(attempt);
      }
    })).resolves.toEqual(credited);

    expect(verifyDeposit).toHaveBeenCalledTimes(2);
    expect(verifyDeposit).toHaveBeenNthCalledWith(1, 'wallet', 'signature', 'token');
    expect(sleptMs).toEqual([25]);
    expect(retryAttempts).toEqual([1]);
  });

  it('keeps a pending BUSDC signature only after final transient verify errors', () => {
    const transient = new ApiClientError({
      status: 400,
      code: 'deposit_transaction_unavailable',
      path: '/profiles/wallet/deposits'
    });
    const permanent = new ApiClientError({
      status: 400,
      code: 'deposit_wrong_mint',
      path: '/profiles/wallet/deposits'
    });

    expect(pendingWalletDepositSignatureAfterError(transient, 'signature')).toBe('signature');
    expect(pendingWalletDepositSignatureAfterError(permanent, 'signature')).toBe('');
    expect(pendingWalletDepositSignatureAfterError(new Error('offline'), 'signature')).toBe('');
  });

  it('invalidates cash and deposit balance queries after a successful deposit', () => {
    expect(depositSuccessInvalidationKeys('wallet')).toEqual([
      ['cash-balance', 'wallet'],
      ['deposit-balances', 'wallet']
    ]);
  });
});
