import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletSession, walletSessionCacheKey } from './walletSession';

const authState = vi.hoisted(() => ({
  authenticated: true,
  getAccessToken: vi.fn(async () => 'header.eyJzaWQiOiJzZXNzaW9uLTEifQ.signature'),
  solanaWallet: { address: 'wallet-1' } as { address: string } | null,
  solanaWalletAddress: 'wallet-1',
  solanaWalletResolving: false,
  solanaWalletsReady: true,
  user: { id: 'user-1' } as { id: string } | null
}));

const apiState = vi.hoisted(() => {
  const futureIso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  class MockApiClientError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string) {
      super(code);
      this.name = 'ApiClientError';
      this.status = status;
      this.code = code;
    }
  }

  return {
    ApiClientError: MockApiClientError,
    createWalletChallenge: vi.fn(async () => ({
      challenge_id: 'challenge-1',
      wallet_address: 'wallet-1',
      message: 'Verify wallet-1',
      expires_at: futureIso(5)
    })),
    createWalletSession: vi.fn(async () => ({
      wallet_session_token: 'wallet-session-token',
      wallet_address: 'wallet-1',
      expires_at: futureIso(30)
    }))
  };
});

const signState = vi.hoisted(() => ({
  signMessage: vi.fn(async () => ({ signature: Uint8Array.from([1, 2, 3, 4]) }))
}));

vi.mock('@/lib/auth/privy', () => ({
  useAuth: () => authState
}));

vi.mock('@/lib/api/client', () => ({
  ApiClientError: apiState.ApiClientError,
  api: {
    createWalletChallenge: apiState.createWalletChallenge,
    createWalletSession: apiState.createWalletSession
  }
}));

vi.mock('@privy-io/react-auth/solana', () => ({
  useSignMessage: () => ({ signMessage: signState.signMessage })
}));

type WalletSessionHook = ReturnType<typeof useWalletSession>;

describe('useWalletSession', () => {
  beforeEach(() => {
    authState.authenticated = true;
    authState.getAccessToken.mockReset();
    authState.getAccessToken.mockResolvedValue(accessTokenWithSession('session-1'));
    authState.solanaWallet = { address: 'wallet-1' };
    authState.solanaWalletAddress = 'wallet-1';
    authState.solanaWalletResolving = false;
    authState.solanaWalletsReady = true;
    authState.user = { id: 'user-1' };
    apiState.createWalletChallenge.mockReset();
    apiState.createWalletChallenge.mockResolvedValue({
      challenge_id: 'challenge-1',
      wallet_address: 'wallet-1',
      message: 'Verify wallet-1',
      expires_at: futureIso(5)
    });
    apiState.createWalletSession.mockReset();
    apiState.createWalletSession.mockResolvedValue({
      wallet_session_token: 'wallet-session-token',
      wallet_address: 'wallet-1',
      expires_at: futureIso(30)
    });
    signState.signMessage.mockReset();
    signState.signMessage.mockResolvedValue({ signature: Uint8Array.from([1, 2, 3, 4]) });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('signs once and reuses the wallet session until expiry', async () => {
    const harness = await renderHookHarness();

    const first = await harness.current.getWalletSession('wallet-1');
    const second = await harness.current.getWalletSession('wallet-1');

    expect(first).toEqual({
      accessToken: accessTokenWithSession('session-1'),
      walletSessionToken: 'wallet-session-token'
    });
    expect(second.walletSessionToken).toBe('wallet-session-token');
    expect(apiState.createWalletChallenge).toHaveBeenCalledTimes(1);
    expect(signState.signMessage).toHaveBeenCalledTimes(1);
    expect(apiState.createWalletSession).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it('clears the cached wallet session after wallet switch and logout', async () => {
    const harness = await renderHookHarness();

    await harness.current.getWalletSession('wallet-1');
    authState.solanaWallet = { address: 'wallet-2' };
    authState.solanaWalletAddress = 'wallet-2';
    await harness.rerender();
    authState.solanaWallet = { address: 'wallet-1' };
    authState.solanaWalletAddress = 'wallet-1';
    await harness.rerender();
    await harness.current.getWalletSession('wallet-1');
    authState.authenticated = false;
    await harness.rerender();
    authState.authenticated = true;
    await harness.rerender();
    await harness.current.getWalletSession('wallet-1');

    expect(apiState.createWalletChallenge).toHaveBeenCalledTimes(3);
    expect(signState.signMessage).toHaveBeenCalledTimes(3);

    harness.unmount();
  });

  it('clears stale cache after a wallet auth error', async () => {
    const harness = await renderHookHarness();

    apiState.createWalletSession.mockResolvedValueOnce({
      wallet_session_token: 'expired-wallet-session-token',
      wallet_address: 'wallet-1',
      expires_at: pastIso()
    });
    await harness.current.getWalletSession('wallet-1');
    apiState.createWalletChallenge.mockRejectedValueOnce(
      new apiState.ApiClientError(401, 'wallet_session_invalid')
    );
    await expect(harness.current.getWalletSession('wallet-1')).rejects.toThrow('wallet_session_invalid');
    apiState.createWalletSession.mockResolvedValueOnce({
      wallet_session_token: 'fresh-wallet-session-token',
      wallet_address: 'wallet-1',
      expires_at: futureIso(30)
    });
    const fresh = await harness.current.getWalletSession('wallet-1');

    expect(fresh.walletSessionToken).toBe('fresh-wallet-session-token');
    expect(apiState.createWalletChallenge).toHaveBeenCalledTimes(3);
    expect(signState.signMessage).toHaveBeenCalledTimes(2);

    harness.unmount();
  });
});

describe('walletSessionCacheKey', () => {
  it('includes Privy user, session, and wallet', () => {
    expect(walletSessionCacheKey(accessTokenWithSession('session-abc'), 'wallet-1', 'user-1'))
      .toBe('user-1:session-abc:wallet-1');
  });
});

async function renderHookHarness() {
  const element = document.createElement('div');
  document.body.appendChild(element);
  let current: WalletSessionHook | null = null;
  const root = createRoot(element);
  await render(root, <HookCapture onValue={(value) => { current = value; }} />);

  return {
    get current() {
      if (!current) throw new Error('hook not captured');
      return current;
    },
    rerender: () => render(root, <HookCapture onValue={(value) => { current = value; }} />),
    unmount: () => {
      act(() => {
        root.unmount();
      });
      element.remove();
    }
  };
}

function HookCapture({ onValue }: { onValue: (value: WalletSessionHook) => void }) {
  const value = useWalletSession();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

async function render(root: Root, node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function accessTokenWithSession(sessionId: string) {
  return `header.${base64Url(JSON.stringify({ sid: sessionId }))}.signature`;
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function futureIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function pastIso() {
  return new Date(Date.now() - 1_000).toISOString();
}
