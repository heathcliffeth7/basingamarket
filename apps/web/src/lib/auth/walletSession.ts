'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSignMessage } from '@privy-io/react-auth/solana';
import { ApiClientError, api } from '@/lib/api/client';
import { encodeBase58 } from '@/lib/utils/solana';
import { useAuth } from './privy';

type CachedWalletSession = {
  token: string;
  expiresAtMs: number;
};

type WalletSessionTokens = {
  accessToken: string;
  walletSessionToken: string;
};

const SESSION_REFRESH_SKEW_MS = 15_000;

export function useWalletSession() {
  const {
    authenticated,
    getAccessToken,
    solanaWallet,
    solanaWalletAddress,
    solanaWalletResolving,
    solanaWalletsReady,
    user
  } = useAuth();
  const { signMessage } = useSignMessage();
  const cacheRef = useRef(new Map<string, CachedWalletSession>());

  useEffect(() => {
    cacheRef.current.clear();
  }, [authenticated, solanaWalletAddress, user]);

  const getWalletSession = useCallback(async (walletAddress: string): Promise<WalletSessionTokens> => {
    if (!authenticated) throw new Error('Login session required.');
    if (!solanaWalletsReady || solanaWalletResolving) {
      throw new Error('Solana wallet syncing. Try again in a moment.');
    }
    if (!solanaWallet || solanaWallet.address !== walletAddress) {
      throw new Error('Connected Solana wallet does not match this action.');
    }
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('Login session required.');
    const cacheKey = walletSessionCacheKey(accessToken, walletAddress, userIdForCache(user));
    const cached = cacheRef.current.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now() + SESSION_REFRESH_SKEW_MS) {
      return { accessToken, walletSessionToken: cached.token };
    }

    try {
      const challenge = await api.createWalletChallenge(walletAddress, accessToken);
      const { signature } = await signMessage({
        message: new TextEncoder().encode(challenge.message),
        wallet: solanaWallet,
        options: {
          uiOptions: {
            buttonText: 'Verify wallet',
            description: 'BasingaMarket app cash security check'
          }
        }
      });
      const session = await api.createWalletSession({
        walletAddress,
        challengeId: challenge.challenge_id,
        signature: encodeBase58(signature),
        accessToken
      });
      cacheRef.current.set(cacheKey, {
        token: session.wallet_session_token,
        expiresAtMs: Date.parse(session.expires_at)
      });
      return { accessToken, walletSessionToken: session.wallet_session_token };
    } catch (error) {
      if (isWalletSessionAuthError(error)) {
        cacheRef.current.clear();
      }
      throw error;
    }
  }, [
    authenticated,
    getAccessToken,
    signMessage,
    solanaWallet,
    solanaWalletAddress,
    solanaWalletResolving,
    solanaWalletsReady,
    user
  ]);

  return { getWalletSession };
}

export function walletSessionCacheKey(accessToken: string, walletAddress: string, userId?: string | null) {
  const sessionId = accessTokenSessionId(accessToken) ?? 'unknown-session';
  return `${userId ?? 'unknown-user'}:${sessionId}:${walletAddress}`;
}

function isWalletSessionAuthError(error: unknown) {
  return error instanceof ApiClientError
    && (error.status === 401 || error.status === 403 || error.code.startsWith('wallet_session_'));
}

function userIdForCache(user: unknown) {
  if (!user || typeof user !== 'object') return null;
  const id = (user as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

function accessTokenSessionId(accessToken: string) {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof decoded.sid === 'string' ? decoded.sid : null;
  } catch {
    return null;
  }
}
