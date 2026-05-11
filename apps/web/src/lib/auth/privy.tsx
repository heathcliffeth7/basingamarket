'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useLinkAccount, useLogin, useModalStatus, usePrivy } from '@privy-io/react-auth';
import type { User } from '@privy-io/react-auth';
import { toSolanaWalletConnectors, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { privyAppId, privyClientId, solanaRpcUrl, solanaWsUrl } from '@/lib/api/env';
import {
  buildSolanaAuthError,
  chooseSolanaWalletAuthAction,
  getPrivyAppIdFingerprint,
  resolveStickySolanaWallet,
  solanaConnectWalletOptions,
  solanaLoginModalOptions,
  solanaWalletConnectorOptions,
  solanaWalletList,
  type DirectSolanaLoginStatus,
  type SolanaAuthError
} from './solanaLogin';

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  privyConfigured: boolean;
  privyAppIdFingerprint: string;
  authError: SolanaAuthError | null;
  directSolanaLoginStatus: DirectSolanaLoginStatus;
  solanaWalletAddress: string | null;
  solanaWallet: SolanaWallet | null;
  solanaWalletsReady: boolean;
  solanaWalletResolving: boolean;
  hasSolanaWallet: boolean;
  loginSolana: () => Promise<void>;
  clearAuthError: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

type SolanaWallet = ReturnType<typeof useSolanaWallets>['wallets'][number];

const AuthContext = createContext<AuthContextValue | null>(null);
const privyAppIdFingerprint = getPrivyAppIdFingerprint(privyAppId);

function RealPrivyBridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { isOpen: privyModalOpen } = useModalStatus();
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();
  const [stickySolanaWalletAddress, setStickySolanaWalletAddress] = useState<string | null>(null);
  const [authError, setAuthError] = useState<SolanaAuthError | null>(null);
  const [directSolanaLoginStatus, setDirectSolanaLoginStatus] = useState<DirectSolanaLoginStatus>('idle');
  const loginModalOpened = useRef(false);
  const stickySolanaWallet = resolveStickySolanaWallet({
    authenticated: privy.authenticated,
    wallets: solanaWallets,
    walletsReady: solanaWalletsReady,
    previousAddress: stickySolanaWalletAddress
  });
  const solanaWallet = stickySolanaWallet.wallet;
  const solanaWalletAddress = stickySolanaWallet.address;
  const solanaWalletResolving = stickySolanaWallet.resolving;
  const hasSolanaWallet = stickySolanaWallet.hasSolanaWallet;
  const { login } = useLogin({
    onComplete: () => {
      setAuthError(null);
      setDirectSolanaLoginStatus('idle');
      loginModalOpened.current = false;
    },
    onError: (error) => {
      setAuthError(buildSolanaAuthError('login', error));
      setDirectSolanaLoginStatus('error');
      loginModalOpened.current = false;
    }
  });
  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      setAuthError(null);
      setDirectSolanaLoginStatus('idle');
      loginModalOpened.current = false;
    },
    onError: (error) => {
      setAuthError(buildSolanaAuthError('link', error));
      setDirectSolanaLoginStatus('error');
      loginModalOpened.current = false;
    }
  });

  useEffect(() => {
    if (directSolanaLoginStatus !== 'opening') return;
    if (privyModalOpen) {
      loginModalOpened.current = true;
      return;
    }
    if (loginModalOpened.current) {
      loginModalOpened.current = false;
      setDirectSolanaLoginStatus('idle');
    }
  }, [directSolanaLoginStatus, privy.authenticated, privyModalOpen]);

  useEffect(() => {
    setStickySolanaWalletAddress((currentAddress) => {
      if (currentAddress === stickySolanaWallet.nextStickyAddress) return currentAddress;
      return stickySolanaWallet.nextStickyAddress;
    });
  }, [stickySolanaWallet.nextStickyAddress]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
    if (directSolanaLoginStatus === 'error') {
      setDirectSolanaLoginStatus('idle');
    }
  }, [directSolanaLoginStatus]);

  const loginSolana = useCallback(async () => {
    setAuthError(null);
    loginModalOpened.current = false;
    const authAction = chooseSolanaWalletAuthAction({
      authenticated: privy.authenticated,
      solanaWalletCount: hasSolanaWallet ? 1 : 0
    });
    if (authAction === 'none') {
      setDirectSolanaLoginStatus('idle');
      return;
    }

    setDirectSolanaLoginStatus('opening');
    try {
      if (authAction === 'login') {
        login(solanaLoginModalOptions);
      } else {
        linkWallet(solanaConnectWalletOptions);
      }
    } catch (error) {
      setAuthError(buildSolanaAuthError(authAction === 'linkWallet' ? 'link' : 'login', error));
      setDirectSolanaLoginStatus('error');
    }
  }, [hasSolanaWallet, linkWallet, login, privy.authenticated]);

  const value = useMemo(
    () => ({
      ready: privy.ready,
      authenticated: privy.authenticated,
      user: privy.user,
      privyConfigured: true,
      privyAppIdFingerprint,
      authError,
      directSolanaLoginStatus,
      solanaWalletAddress,
      solanaWallet,
      solanaWalletsReady,
      solanaWalletResolving,
      hasSolanaWallet,
      loginSolana,
      clearAuthError,
      logout: () => privy.logout(),
      getAccessToken: () => privy.getAccessToken()
    }),
    [
      authError,
      clearAuthError,
      directSolanaLoginStatus,
      hasSolanaWallet,
      loginSolana,
      privy,
      solanaWallet,
      solanaWalletAddress,
      solanaWalletResolving,
      solanaWalletsReady
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

function LocalAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        ready: true,
        authenticated: false,
        user: null,
        privyConfigured: false,
        privyAppIdFingerprint,
        authError: null,
        directSolanaLoginStatus: 'idle',
        solanaWalletAddress: null,
        solanaWallet: null,
        solanaWalletsReady: true,
        solanaWalletResolving: false,
        hasSolanaWallet: false,
        loginSolana: async () => undefined,
        clearAuthError: () => undefined,
        logout: async () => undefined,
        getAccessToken: async () => null
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!privyAppId) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId || undefined}
      config={{
        loginMethods: ['wallet', 'email'],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(solanaWalletConnectorOptions)
          }
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'off'
          },
          solana: {
            createOnLogin: 'users-without-wallets'
          }
        },
        solana: {
          rpcs: {
            'solana:devnet': {
              rpc: createSolanaRpc(solanaRpcUrl),
              rpcSubscriptions: createSolanaRpcSubscriptions(solanaWsUrl),
              blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet'
            }
          }
        },
        appearance: {
          theme: 'dark',
          accentColor: '#1995ff',
          logo: '/brand/bm-logo-mark.png',
          showWalletLoginFirst: true,
          walletList: solanaWalletList,
          walletChainType: 'solana-only'
        }
      }}
    >
      <RealPrivyBridge>{children}</RealPrivyBridge>
    </PrivyProvider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
