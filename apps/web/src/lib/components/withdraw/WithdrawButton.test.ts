import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import {
  default as WithdrawButton,
  withdrawButtonLabel,
  withdrawErrorMessage,
  withdrawSetupMessage
} from './WithdrawButton';

const authMock = vi.hoisted(() => ({
  authenticated: true,
  getAccessToken: vi.fn(async () => 'access-token'),
  identityToken: 'identity-token',
  loginSolana: vi.fn(),
  solanaWallet: { address: 'Identity1111111111111111111111111111111111' },
  solanaWalletAddress: 'Identity1111111111111111111111111111111111',
  solanaWalletsReady: true,
  solanaWalletResolving: false
}));

const signMessageMock = vi.hoisted(() => vi.fn(async () => ({ signature: new Uint8Array([1, 2, 3]) })));
const authTokensMock = vi.hoisted(() => ({
  getAuthTokens: vi.fn(async () => ({
    accessToken: 'access-token',
    identityToken: 'identity-token'
  }))
}));

const apiMock = vi.hoisted(() => ({
  getWithdrawConfig: vi.fn(),
  createWithdrawalQuote: vi.fn(),
  verifyWithdrawal: vi.fn()
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
  useAuth: () => authMock,
  useProtectedAuthTokens: () => authTokensMock
}));

vi.mock('@privy-io/react-auth/solana', () => ({
  useSignMessage: () => ({ signMessage: signMessageMock })
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

describe('WithdrawButton helpers', () => {
  it('maps withdraw config state to button labels', () => {
    expect(withdrawButtonLabel(undefined, true)).toBe('Withdraw');
    expect(withdrawButtonLabel('ready', false)).toBe('Withdraw');
    expect(withdrawButtonLabel('setup_pending', false)).toBe('Setup pending');
    expect(withdrawButtonLabel(undefined, false, true)).toBe('API offline');
  });

  it('explains setup pending reasons', () => {
    expect(withdrawSetupMessage('withdraw_disabled')).toContain('SOLANA_WITHDRAW_ENABLED');
    expect(withdrawSetupMessage('vault_owner_mismatch')).toContain('keypair');
    expect(withdrawSetupMessage('vault_keypair_missing')).toContain('okunamadi');
  });

  it('maps backend withdraw errors to Turkish messages', () => {
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_insufficient_cash',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('yetersiz');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_quote_expired',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('suresi doldu');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_wrong_signer',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('Solana wallet');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_invalid_destination',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('gecersiz');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_destination_token_account',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('token account');
  });

});

describe('WithdrawButton external wallet destination', () => {
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
    signMessageMock.mockResolvedValue({ signature: new Uint8Array([1, 2, 3]) });
    apiMock.getWithdrawConfig.mockResolvedValue({ status: 'ready' });
    apiMock.createWithdrawalQuote.mockResolvedValue({
      status: 'ready',
      quote_id: 'quote-1',
      message: 'withdraw message'
    });
    apiMock.verifyWithdrawal.mockResolvedValue({
      withdrawn_amount: '250000'
    });
    externalWalletMock.connected = true;
    externalWalletMock.walletAddress = 'Stale111111111111111111111111111111111111';
    externalWalletMock.availableWallets = walletCatalogOptions();
    externalWalletMock.connectFresh.mockReset();
    externalWalletMock.reset.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  });

  it('shows the full external withdraw wallet catalog and leaves not-detected wallets disabled', async () => {
    await renderWithdraw();

    await clickButton('External wallet');

    for (const walletName of ['Phantom', 'OKX Wallet', 'Backpack', 'Solflare', 'Jupiter']) {
      expect(container.textContent).toContain(walletName);
    }
    expect(container.textContent).not.toContain('Privy');
    expect(buttonByText('Backpack').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/backpack.png');
    expect(buttonByText('Solflare').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/solflare.svg');
    expect(buttonByText('Jupiter').querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/jupiter.svg');
    expect(buttonByText('Jupiter').disabled).toBe(true);

    await clickButton('Jupiter');

    expect(externalWalletMock.connectFresh).not.toHaveBeenCalled();
  });

  it('does not show a stale global external wallet address while a fresh withdraw connect is pending', async () => {
    const pendingConnect = deferred<{ address: string }>();
    externalWalletMock.connectFresh.mockReturnValueOnce(pendingConnect.promise);
    await renderWithdraw();

    await clickButton('External wallet');
    await clickButton('Phantom');

    expect(externalWalletMock.reset).toHaveBeenCalled();
    expect(externalWalletMock.connectFresh).toHaveBeenCalledWith('Phantom');
    expect(externalWalletMock.connectFresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Connecting external wallet...');
    expect(container.textContent).not.toContain(shortAddress(externalWalletMock.walletAddress));
    expect(buttonByText('Continue').disabled).toBe(true);
  });

  it('uses only the fresh returned external wallet as the withdraw destination', async () => {
    const freshAddress = 'Fresh111111111111111111111111111111111111';
    externalWalletMock.connectFresh.mockImplementationOnce(async () => {
      externalWalletMock.walletAddress = freshAddress;
      return { address: freshAddress };
    });
    await renderWithdraw();

    await clickButton('External wallet');
    await clickButton('Phantom');

    expect(container.textContent).toContain('Use this account');
    expect(container.textContent).toContain(freshAddress);
    expect(buttonByText('Continue').disabled).toBe(true);

    await clickButton('Use this account');

    expect(container.textContent).toContain(shortAddress(freshAddress));
    expect(container.textContent).not.toContain(shortAddress('Stale111111111111111111111111111111111111'));

    await setInputValue('#withdraw-amount', '0.25');
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(apiMock.createWithdrawalQuote).toHaveBeenCalledWith(
      'Identity1111111111111111111111111111111111',
      '250000',
      'access-token',
      freshAddress,
      'identity-token'
    );
  });

  async function renderWithdraw() {
    await act(async () => {
      root.render(React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(WithdrawButton, {
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

  async function setInputValue(selector: string, value: string) {
    await act(async () => {
      const input = container.querySelector(selector) as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
