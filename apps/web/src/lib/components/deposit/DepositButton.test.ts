import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import {
  default as DepositButton,
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

const authMock = vi.hoisted(() => ({
  authenticated: true,
  getAccessToken: vi.fn(async () => 'access-token'),
  loginSolana: vi.fn(),
  solanaWallet: { address: 'Identity1111111111111111111111111111111111' },
  solanaWalletAddress: 'Identity1111111111111111111111111111111111',
  solanaWalletsReady: true,
  solanaWalletResolving: false
}));

const signAndSendTransactionMock = vi.hoisted(() => vi.fn(async () => ({ signature: new Uint8Array([1, 2, 3]) })));
const walletSessionMock = vi.hoisted(() => ({
  getWalletSession: vi.fn(async () => ({
    accessToken: 'access-token',
    walletSessionToken: 'wallet-session-token'
  }))
}));

const apiMock = vi.hoisted(() => ({
  getDepositConfig: vi.fn(),
  createTransferDepositQuote: vi.fn(),
  verifyTransferDeposit: vi.fn(),
  getSolDepositQuote: vi.fn(),
  verifySolDeposit: vi.fn(),
  verifyDeposit: vi.fn()
}));

const externalWalletMock = vi.hoisted(() => ({
  connected: true,
  connecting: false,
  walletAddress: 'Stale111111111111111111111111111111111111',
  walletName: null,
  publicKey: null,
  availableWallets: [] as Array<{ name: string; accent: string; icon: string | null; installed: boolean; providerKey: string; source: 'privy-standard' | 'injected' | 'fallback' }>,
  connect: vi.fn(),
  connectFresh: vi.fn(),
  disconnect: vi.fn(),
  reset: vi.fn(),
  signAndSendTransaction: vi.fn(),
  signMessage: vi.fn()
}));

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authMock
}));

vi.mock('@/lib/auth/walletSession', () => ({
  useWalletSession: () => walletSessionMock
}));

vi.mock('@privy-io/react-auth/solana', () => ({
  useSignAndSendTransaction: () => ({ signAndSendTransaction: signAndSendTransactionMock })
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/api/client');
  return {
    ...actual,
    api: apiMock
  };
});

vi.mock('@/lib/api/cashBalanceQuery', () => ({
  cashBalanceQueryKey: (walletAddress: string | null) => ['cash-balance', walletAddress],
  cashBalanceQueryOptions: ({ walletAddress }: { walletAddress: string | null }) => ({
    queryKey: ['cash-balance', walletAddress],
    queryFn: async () => ({ status: 'ready', cash_balance: '1000000' }),
    enabled: Boolean(walletAddress)
  })
}));

vi.mock('@/lib/wallet/ExternalWalletContext', () => ({
  useExternalWallet: () => externalWalletMock
}));

vi.mock('@solana/kit', () => ({
  address: (value: string) => value,
  appendTransactionMessageInstructions: vi.fn((instructions, message) => ({ ...message, instructions })),
  compileTransaction: vi.fn((message) => message),
  createNoopSigner: vi.fn((value) => ({ address: value })),
  createSolanaRpc: vi.fn(() => ({
    getBalance: vi.fn(() => ({ send: async () => ({ value: 0n }) })),
    getLatestBlockhash: vi.fn(() => ({ send: async () => ({ value: { blockhash: 'hash', lastValidBlockHeight: 1 } }) })),
    getTokenAccountBalance: vi.fn(() => ({ send: async () => ({ value: { amount: '0' } }) })),
    sendTransaction: vi.fn(() => ({ send: async () => 'signature' }))
  })),
  createTransactionMessage: vi.fn((message) => message),
  getTransactionEncoder: vi.fn(() => ({ encode: () => new Uint8Array([1, 2, 3]) })),
  pipe: vi.fn((value, ...fns) => fns.reduce((current, fn) => fn(current), value)),
  setTransactionMessageFeePayerSigner: vi.fn((signer, message) => ({ ...message, feePayer: signer })),
  setTransactionMessageLifetimeUsingBlockhash: vi.fn((blockhash, message) => ({ ...message, blockhash }))
}));

vi.mock('@solana-program/token', () => ({
  findAssociatedTokenPda: vi.fn(async () => ['TokenAccount111111111111111111111111111111']),
  getCreateAssociatedTokenIdempotentInstruction: vi.fn(() => ({ kind: 'createAta' })),
  getTransferCheckedInstruction: vi.fn(() => ({ kind: 'transferChecked' })),
  TOKEN_PROGRAM_ADDRESS: 'Token111111111111111111111111111111111111'
}));

vi.mock('@solana-program/system', () => ({
  getTransferSolInstruction: vi.fn(() => ({ kind: 'transferSol' }))
}));

vi.mock('@solana-program/memo', () => ({
  getAddMemoInstruction: vi.fn(() => ({ kind: 'memo' }))
}));

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
      walletSessionToken: 'wallet-session-token',
      verifyDeposit,
      retryDelaysMs: [25],
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
      onRetry: (attempt) => {
        retryAttempts.push(attempt);
      }
    })).resolves.toEqual(credited);
    expect(verifyDeposit).toHaveBeenLastCalledWith('wallet', 'signature', 'token', 'wallet-session-token');

    expect(verifyDeposit).toHaveBeenCalledTimes(2);
    expect(verifyDeposit).toHaveBeenNthCalledWith(1, 'wallet', 'signature', 'token', 'wallet-session-token');
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

describe('DepositButton external wallet session isolation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });

    authMock.authenticated = true;
    authMock.getAccessToken.mockResolvedValue('access-token');
    authMock.solanaWallet = { address: 'Identity1111111111111111111111111111111111' };
    authMock.solanaWalletAddress = 'Identity1111111111111111111111111111111111';
    authMock.solanaWalletsReady = true;
    authMock.solanaWalletResolving = false;
    apiMock.getDepositConfig.mockResolvedValue(projectionPendingConfig());
    apiMock.createTransferDepositQuote.mockResolvedValue({
      status: 'ready',
      quote_id: 'quote-1',
      destination: 'Destination1111111111111111111111111111111',
      transfer_amount: '250000',
      reference: 'bm:quote-1',
      asset: 'BUSDC'
    });
    apiMock.verifyTransferDeposit.mockResolvedValue({
      deposited_amount: '250000'
    });
    externalWalletMock.connected = true;
    externalWalletMock.connecting = false;
    externalWalletMock.walletAddress = 'Stale111111111111111111111111111111111111';
    externalWalletMock.availableWallets = walletCatalogOptions();
    externalWalletMock.connectFresh.mockReset();
    externalWalletMock.reset.mockReset();
    externalWalletMock.signAndSendTransaction.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    localStorage.clear();
  });

  it('does not render a stale global external wallet on deposit home', async () => {
    await renderDeposit();

    expect(container.textContent).toContain('Connect Wallet');
    expect(container.textContent).not.toContain('External Wallet (...1111)');
    expect(container.textContent).not.toContain(shortAddress(externalWalletMock.walletAddress));
  });

  it('shows the full external deposit wallet catalog and leaves not-detected wallets disabled', async () => {
    await renderDeposit();

    await clickButton('Connect Wallet');

    for (const walletName of ['Phantom', 'OKX Wallet', 'Backpack', 'Solflare', 'Jupiter']) {
      expect(container.textContent).toContain(walletName);
    }
    expect(container.textContent).not.toContain('Privy');
    expect(buttonByText('Backpack').disabled).toBe(true);
    expect(buttonByText('Backpack').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/backpack.png');
    expect(buttonByText('Solflare').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/solflare.svg');
    expect(buttonByText('Jupiter').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/jupiter.svg');

    await clickButton('Backpack');

    expect(externalWalletMock.connectFresh).not.toHaveBeenCalled();
  });

  it('starts a fresh external wallet connect without showing the stale global address while pending', async () => {
    const pendingConnect = deferred<{ address: string }>();
    externalWalletMock.connectFresh.mockReturnValueOnce(pendingConnect.promise);
    await renderDeposit();

    await clickButton('Connect Wallet');
    await clickButton('Phantom');

    expect(externalWalletMock.reset).toHaveBeenCalled();
    expect(externalWalletMock.connectFresh).toHaveBeenCalledWith('Phantom');
    expect(externalWalletMock.connectFresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(shortAddress(externalWalletMock.walletAddress));
  });

  it('shows only the fresh external wallet returned for this deposit session', async () => {
    apiMock.getDepositConfig.mockResolvedValue(readyConfig());
    const freshAddress = 'Fresh111111111111111111111111111111111111';
    externalWalletMock.connectFresh.mockResolvedValueOnce({ address: freshAddress });
    await renderDeposit();

    await clickButton('Connect Wallet');
    await clickButton('Phantom');

    expect(container.textContent).toContain('Use this account');
    expect(container.textContent).toContain(freshAddress);
    expect(() => buttonByText('BUSDC')).toThrow();

    await clickButton('Use this account');
    await clickAsset('BUSDC');

    expect(container.textContent).toContain(freshAddress);
    expect(container.textContent).not.toContain(shortAddress(externalWalletMock.walletAddress));
  });

  it('rejects external deposit submit when global provider no longer matches the local session wallet', async () => {
    apiMock.getDepositConfig.mockResolvedValue(readyConfig());
    const freshAddress = 'Fresh111111111111111111111111111111111111';
    externalWalletMock.connected = true;
    externalWalletMock.walletAddress = 'Stale111111111111111111111111111111111111';
    externalWalletMock.connectFresh.mockResolvedValueOnce({ address: freshAddress });
    await renderDeposit();

    await clickButton('Connect Wallet');
    await clickButton('Phantom');
    await clickButton('Use this account');
    await clickAsset('BUSDC');

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain('External wallet session expired, connect again.');
    expect(externalWalletMock.signAndSendTransaction).not.toHaveBeenCalled();
  });

  async function renderDeposit() {
    await act(async () => {
      root.render(React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DepositButton, {
          walletAddress: 'Identity1111111111111111111111111111111111',
          openRequest: 1,
          renderTrigger: () => null
        })
      ));
      await flushPromises();
    });
  }

  async function clickButton(label: string) {
    await act(async () => {
      buttonByText(label).click();
      await flushPromises();
    });
  }

  async function clickAsset(asset: string) {
    await act(async () => {
      const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes(asset) && (candidate.textContent.includes('Ready') || candidate.textContent.includes('Low Balance'))
      );
      if (!button) throw new Error(`Asset button not found: ${asset}`);
      (button as HTMLButtonElement).click();
      await flushPromises();
    });
  }

  function buttonByText(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(label)
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    return button as HTMLButtonElement;
  }
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function projectionPendingConfig() {
  return {
    cluster: 'devnet' as const,
    currency: 'BUSDC' as const,
    decimals: 6 as const,
    mint: null,
    vault_owner: null,
    vault_token_account: null,
    commitment: 'confirmed' as const,
    status: 'projection_pending' as const
  };
}

function readyConfig() {
  return {
    cluster: 'devnet' as const,
    currency: 'BUSDC' as const,
    decimals: 6 as const,
    mint: 'Mint111111111111111111111111111111111111',
    vault_owner: 'VaultOwner111111111111111111111111111111',
    vault_token_account: 'VaultAta1111111111111111111111111111111',
    commitment: 'confirmed' as const,
    status: 'ready' as const
  };
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function walletCatalogOptions() {
  return [
    walletOption('Phantom'),
    walletOption('OKX Wallet'),
    walletOption('Backpack', false, '/wallet-icons/backpack.png'),
    walletOption('Solflare', false, '/wallet-icons/solflare.svg'),
    walletOption('Jupiter', false, '/wallet-icons/jupiter.svg')
  ];
}

function walletOption(name: string, installed = true, icon = `data:image/svg+xml;utf8,${name}`) {
  return {
    name,
    accent: '#14f195',
    icon,
    installed,
    providerKey: name.toLowerCase().replace(/\s+/g, '_'),
    source: 'fallback' as const
  };
}
