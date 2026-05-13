import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PENDING_EXTERNAL_DEPOSIT_KEY } from '@/lib/components/deposit/transferConfirmation';
import { ExternalWalletProvider, useExternalWallet } from './ExternalWalletContext';

const authState = vi.hoisted(() => ({
  authenticated: false
}));

const standardWalletState = vi.hoisted(() => ({
  wallets: [] as any[]
}));

const envState = vi.hoisted(() => ({
  walletConnectProjectId: ''
}));

const walletConnectMockState = vi.hoisted(() => ({
  displayUriListeners: [] as Array<(uri: string) => void>,
  connect: vi.fn(async () => ({
    namespaces: {
      solana: {
        accounts: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:WalletConnect1111111111111111111111111111']
      }
    }
  })),
  disconnect: vi.fn(async () => undefined),
  request: vi.fn(async () => ({ signature: 'WalletConnectSignature111111111111111111111111' })),
  toDataURL: vi.fn(async (uri: string) => `data:image/png;base64,${uri}`)
}));

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authState
}));

vi.mock('@/lib/api/env', () => ({
  solanaRpcUrl: 'https://api.devnet.solana.com',
  get walletConnectProjectId() {
    return envState.walletConnectProjectId;
  }
}));

vi.mock('@privy-io/react-auth/solana', () => ({
  useStandardWallets: () => ({
    ready: true,
    wallets: standardWalletState.wallets
  })
}));

vi.mock('@walletconnect/universal-provider', () => ({
  default: {
    init: vi.fn(async () => ({
      session: undefined,
      on: vi.fn((event: string, listener: (uri: string) => void) => {
        if (event === 'display_uri') walletConnectMockState.displayUriListeners.push(listener);
      }),
      connect: walletConnectMockState.connect,
      request: walletConnectMockState.request,
      disconnect: walletConnectMockState.disconnect
    }))
  }
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: walletConnectMockState.toDataURL
  },
  toDataURL: walletConnectMockState.toDataURL
}));

type CapturedExternalWallet = {
  connected: boolean;
  walletAddress: string | null;
  availableWallets: Array<{
    name: string;
    icon: string | null;
    installed: boolean;
    providerKey: string;
    source: string;
    kind?: string;
    disabledReason?: string;
  }>;
  walletConnectQrUri: string | null;
  walletConnectDeepLink: string | null;
  connect: (walletName?: string) => Promise<void>;
  connectFresh: (walletName?: string) => Promise<{ address: string }>;
  reset: () => void;
};

describe('ExternalWalletProvider', () => {
  let container: HTMLDivElement;
  let root: Root;
  let captured: CapturedExternalWallet | null;

  beforeEach(() => {
    authState.authenticated = false;
    standardWalletState.wallets = [];
    envState.walletConnectProjectId = '';
    walletConnectMockState.displayUriListeners = [];
    walletConnectMockState.connect.mockReset();
    walletConnectMockState.connect.mockImplementation(async () => ({
      namespaces: {
        solana: {
          accounts: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:WalletConnect1111111111111111111111111111']
        }
      }
    }));
    walletConnectMockState.disconnect.mockClear();
    walletConnectMockState.request.mockClear();
    walletConnectMockState.toDataURL.mockClear();
    captured = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('disconnects the active external wallet when auth transitions to logged in', async () => {
    const provider = mockSolanaProvider('External11111111111111111111111111111111111');
    vi.stubGlobal('phantom', { solana: provider });

    await renderProvider();
    await act(async () => {
      await captured!.connect('Phantom');
    });

    expect(captured?.connected).toBe(true);
    expect(captured?.walletAddress).toBe('External11111111111111111111111111111111111');

    localStorage.setItem(PENDING_EXTERNAL_DEPOSIT_KEY, '{"signature":"kept"}');
    authState.authenticated = true;
    await renderProvider();

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(false);
    expect(localStorage.getItem(PENDING_EXTERNAL_DEPOSIT_KEY)).toBe('{"signature":"kept"}');
  });

  it('shows the prioritized wallet catalog with fallback icons even when nothing is installed', async () => {
    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter',
      'WalletConnect QR'
    ]);
    for (const walletName of ['Phantom', 'OKX Wallet']) {
      expect(captured?.availableWallets.find((wallet) => wallet.name === walletName)).toMatchObject({
        installed: false,
        icon: expect.stringContaining('data:image/svg+xml'),
        source: 'fallback'
      });
    }
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Backpack')).toMatchObject({
      installed: false,
      icon: '/wallet-icons/backpack.png',
      source: 'fallback'
    });
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Solflare')).toMatchObject({
      installed: false,
      icon: '/wallet-icons/solflare.svg',
      source: 'fallback'
    });
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Jupiter')).toMatchObject({
      installed: false,
      icon: '/wallet-icons/jupiter.svg',
      source: 'fallback'
    });
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'WalletConnect QR')).toMatchObject({
      installed: false,
      providerKey: 'walletconnect_qr',
      kind: 'walletconnect',
      disabledReason: 'WalletConnect QR is not configured'
    });
  });

  it('enables the explicit WalletConnect QR option only when project id is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'test-project-id');

    await renderProvider();

    expect(captured?.availableWallets.find((wallet) => wallet.name === 'WalletConnect QR')).toMatchObject({
      installed: true,
      kind: 'walletconnect',
      disabledReason: undefined
    });
  });

  it('exposes prioritized wallet options with adapter icons and installed state', async () => {
    const provider = mockSolanaProvider('External11111111111111111111111111111111111');
    const fallbackIconProvider = mockSolanaProvider('Solflare111111111111111111111111111111111');
    provider.icon = 'data:image/svg+xml,provider-phantom';
    standardWalletState.wallets = [mockStandardWallet('Phantom', 'data:image/svg+xml,privy-phantom')];
    vi.stubGlobal('phantom', { solana: provider });
    vi.stubGlobal('solflare', fallbackIconProvider);

    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter',
      'WalletConnect QR'
    ]);
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Phantom')).toMatchObject({
      icon: 'data:image/svg+xml,privy-phantom',
      installed: true,
      providerKey: 'phantom',
      source: 'privy-standard'
    });
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'OKX Wallet')).toMatchObject({
      installed: false,
      icon: expect.stringContaining('data:image/svg+xml')
    });
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Solflare')).toMatchObject({
      installed: true,
      icon: '/wallet-icons/solflare.svg',
      source: 'fallback'
    });
  });

  it('detects Backpack from window.solana flags without adding a generic duplicate', async () => {
    vi.stubGlobal('solana', {
      ...mockSolanaProvider('Backpack1111111111111111111111111111111111'),
      isBackpack: true
    });

    await renderProvider();

    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Backpack')).toMatchObject({
      installed: true
    });
    expect(captured?.availableWallets.map((wallet) => wallet.name)).not.toContain('Detected Solana Wallet');
  });

  it('detects Solflare from window.solana flags without adding a generic duplicate', async () => {
    vi.stubGlobal('solana', {
      ...mockSolanaProvider('Solflare111111111111111111111111111111111'),
      isSolflare: true
    });

    await renderProvider();

    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Solflare')).toMatchObject({
      installed: true
    });
    expect(captured?.availableWallets.map((wallet) => wallet.name)).not.toContain('Detected Solana Wallet');
  });

  it('uses Wallet Standard metadata for Jupiter before injected fallbacks', async () => {
    standardWalletState.wallets = [mockStandardWallet('Jupiter', 'data:image/svg+xml,privy-jupiter')];
    vi.stubGlobal('jupiter', mockSolanaProvider('InjectedJupiter111111111111111111111111111'));

    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name).slice(0, 5)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter'
    ]);
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Jupiter')).toMatchObject({
      installed: true,
      icon: 'data:image/svg+xml,privy-jupiter',
      providerKey: 'jupiter',
      source: 'privy-standard'
    });
  });

  it('shows a generic injected wallet only for catalog-unknown window.solana providers', async () => {
    vi.stubGlobal('solana', mockSolanaProvider('Unknown11111111111111111111111111111111111'));

    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter',
      'WalletConnect QR',
      'Detected Solana Wallet'
    ]);
    expect(captured?.availableWallets.find((wallet) => wallet.name === 'Detected Solana Wallet')).toMatchObject({
      installed: true,
      providerKey: 'detected_solana_wallet'
    });
  });

  it('filters Privy standard wallets from external wallet options', async () => {
    standardWalletState.wallets = [
      mockStandardWallet('Privy', 'data:image/svg+xml,privy-wallet', 'Privy111111111111111111111111111111111111', { isPrivyWallet: true }),
      mockStandardWallet('Privy Wallet', 'data:image/svg+xml,privy-wallet-name'),
      mockStandardWallet('Embedded Solana', 'data:image/svg+xml,privy-feature', 'Embedded111111111111111111111111111111111', { features: { 'privy:': { privy: {} } } }),
      mockStandardWallet('Glow', 'data:image/svg+xml,glow')
    ];

    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter',
      'WalletConnect QR',
      'Glow'
    ]);
    expect(captured?.availableWallets.map((wallet) => wallet.name)).not.toContain('Privy');
    expect(captured?.availableWallets.map((wallet) => wallet.name)).not.toContain('Privy Wallet');
    expect(captured?.availableWallets.map((wallet) => wallet.name)).not.toContain('Embedded Solana');
  });

  it('filters WalletConnect standard wallets and keeps only the explicit QR option', async () => {
    standardWalletState.wallets = [
      mockStandardWallet('WalletConnect', 'data:image/svg+xml,walletconnect'),
      mockStandardWallet('Wallet Connect', 'data:image/svg+xml,wallet-connect', 'WalletConnect2222222222222222222222222222', { isWalletConnectSolana: true }),
      mockStandardWallet('Glow', 'data:image/svg+xml,glow')
    ];

    await renderProvider();

    expect(captured?.availableWallets.map((wallet) => wallet.name)).toEqual([
      'Phantom',
      'OKX Wallet',
      'Backpack',
      'Solflare',
      'Jupiter',
      'WalletConnect QR',
      'Glow'
    ]);
  });

  it('sets WalletConnect QR state while a QR connection is pending', async () => {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'test-project-id');
    const pendingConnect = deferred<{
      namespaces: { solana: { accounts: string[] } };
    }>();
    walletConnectMockState.connect.mockImplementationOnce(async () => {
      walletConnectMockState.displayUriListeners.forEach((listener) => listener('wc:test-uri'));
      return pendingConnect.promise;
    });

    await renderProvider();
    let connectResult: Promise<{ address: string }> | undefined;
    act(() => {
      connectResult = captured!.connectFresh('WalletConnect QR');
    });
    await act(async () => {
      await waitForCondition(() => walletConnectMockState.toDataURL.mock.calls.length > 0);
    });

    expect(walletConnectMockState.toDataURL).toHaveBeenCalledWith('wc:test-uri', { margin: 1, width: 260 });
    expect(captured?.walletConnectDeepLink).toBe('wc:test-uri');
    expect(captured?.walletConnectQrUri).toBe('data:image/png;base64,wc:test-uri');

    await act(async () => {
      pendingConnect.resolve({
        namespaces: {
          solana: {
            accounts: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:WalletConnect3333333333333333333333333333']
          }
        }
      });
      await connectResult;
    });

    expect(captured?.walletAddress).toBe('WalletConnect3333333333333333333333333333');
    expect(captured?.walletConnectQrUri).toBeNull();
  });

  it('best-effort disconnects detected wallets even when none is active in context', async () => {
    const provider = mockSolanaProvider('Solflare111111111111111111111111111111111');
    vi.stubGlobal('solflare', provider);

    await renderProvider();

    authState.authenticated = true;
    await renderProvider();

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(false);
  });

  it('resets the active wallet and detected connected wallets without clearing pending deposits', async () => {
    const activeProvider = mockSolanaProvider('External11111111111111111111111111111111111');
    const detectedProvider = mockSolanaProvider('Detected1111111111111111111111111111111111');
    vi.stubGlobal('phantom', { solana: activeProvider });
    vi.stubGlobal('solflare', detectedProvider);

    await renderProvider();
    await act(async () => {
      await captured!.connect('Phantom');
    });
    expect(captured?.connected).toBe(true);

    localStorage.setItem(PENDING_EXTERNAL_DEPOSIT_KEY, '{"signature":"kept"}');
    await act(async () => {
      captured!.reset();
    });

    expect(activeProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(detectedProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(false);
    expect(captured?.walletAddress).toBeNull();
    expect(localStorage.getItem(PENDING_EXTERNAL_DEPOSIT_KEY)).toBe('{"signature":"kept"}');
  });

  it('connectFresh disconnects stale providers before connecting and does not reuse isConnected state', async () => {
    const provider = mockSolanaProvider('Fresh111111111111111111111111111111111111');
    provider.isConnected = true;
    provider.publicKey = { toString: () => 'Stale111111111111111111111111111111111111' };
    vi.stubGlobal('phantom', { solana: provider });

    await renderProvider();
    let wallet: { address: string } | undefined;
    await act(async () => {
      wallet = await captured!.connectFresh('Phantom');
    });

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.connect).toHaveBeenCalledWith({ onlyIfTrusted: false });
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(true);
    expect(captured?.walletAddress).toBe('Fresh111111111111111111111111111111111111');
    expect(wallet?.address).toBe('Fresh111111111111111111111111111111111111');
  });

  it('does not restore a wallet when a pending fresh connect resolves after reset', async () => {
    const pendingConnect = deferred<{ publicKey: { toString(): string } }>();
    const provider = mockSolanaProvider('Fresh111111111111111111111111111111111111');
    provider.connect.mockReturnValueOnce(pendingConnect.promise);
    vi.stubGlobal('phantom', { solana: provider });

    await renderProvider();
    let connectResult: Promise<unknown> | undefined;
    act(() => {
      connectResult = captured!.connectFresh('Phantom').catch((error) => error);
    });

    await act(async () => {
      captured!.reset();
    });

    await act(async () => {
      pendingConnect.resolve({ publicKey: { toString: () => 'Late1111111111111111111111111111111111111' } });
      await connectResult;
    });

    expect(await connectResult).toBeInstanceOf(Error);
    expect(captured?.connected).toBe(false);
    expect(captured?.walletAddress).toBeNull();
  });

  it('ignores late provider account events after reset', async () => {
    const provider = mockEventedSolanaProvider('External11111111111111111111111111111111111');
    vi.stubGlobal('phantom', { solana: provider });

    await renderProvider();
    await act(async () => {
      await captured!.connect('Phantom');
    });
    expect(captured?.connected).toBe(true);

    await act(async () => {
      captured!.reset();
    });

    await act(async () => {
      provider.emit('accountChanged', { toString: () => 'Late1111111111111111111111111111111111111' });
    });

    expect(captured?.connected).toBe(false);
    expect(captured?.walletAddress).toBeNull();
  });

  it('clears app state even when wallet disconnect fails', async () => {
    const provider = mockSolanaProvider('External11111111111111111111111111111111111');
    provider.disconnect.mockRejectedValueOnce(new Error('disconnect rejected'));
    vi.stubGlobal('phantom', { solana: provider });

    await renderProvider();
    await act(async () => {
      await captured!.connect('Phantom');
    });
    expect(captured?.connected).toBe(true);

    await act(async () => {
      captured!.reset();
    });

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(false);
    expect(captured?.walletAddress).toBeNull();
  });

  it('disconnects detected wallets when mounted into an already authenticated session', async () => {
    const provider = mockSolanaProvider('Okx111111111111111111111111111111111111111');
    vi.stubGlobal('okxwallet', { solana: provider });
    authState.authenticated = true;

    await renderProvider();

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(captured?.connected).toBe(false);
  });

  async function renderProvider() {
    await act(async () => {
      root.render(
        <ExternalWalletProvider>
          <CaptureExternalWallet onCapture={(value) => {
            captured = value;
          }}
          />
        </ExternalWalletProvider>
      );
    });
  }
});

function CaptureExternalWallet({ onCapture }: { onCapture: (value: CapturedExternalWallet) => void }) {
  const externalWallet = useExternalWallet();
  onCapture(externalWallet);
  return null;
}

function mockSolanaProvider(publicKey: string) {
  return {
    icon: null as string | null,
    isConnected: false,
    publicKey: { toString: () => publicKey },
    connect: vi.fn(async () => ({ publicKey: { toString: () => publicKey } })),
    disconnect: vi.fn(async () => undefined),
    signAndSendTransaction: vi.fn(),
    signMessage: vi.fn()
  };
}

function mockStandardWallet(
  name: string,
  icon: string,
  address = 'Standard1111111111111111111111111111111111',
  options: { isPrivyWallet?: boolean; isWalletConnectSolana?: boolean; features?: Record<string, unknown> } = {}
) {
  const account = {
    address,
    publicKey: new Uint8Array([1, 2, 3]),
    chains: ['solana:devnet'],
    features: [],
    label: name,
    icon
  };
  return {
    version: '1.0.0',
    name,
    icon,
    chains: ['solana:devnet'],
    accounts: [account],
    features: {
      ...options.features,
      'standard:connect': {
        version: '1.0.0',
        connect: vi.fn(async () => ({ accounts: [account] }))
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: vi.fn(async () => undefined)
      }
    },
    ...(options.isPrivyWallet === undefined ? {} : { isPrivyWallet: options.isPrivyWallet }),
    ...(options.isWalletConnectSolana === undefined ? {} : { isWalletConnectSolana: options.isWalletConnectSolana })
  };
}

function mockEventedSolanaProvider(publicKey: string) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    ...mockSolanaProvider(publicKey),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string) => {
      listeners.delete(event);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.(...args);
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForCondition(condition: () => boolean) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
