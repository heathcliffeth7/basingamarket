'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useLinkAccount, useLogin, useModalStatus, usePrivy } from '@privy-io/react-auth';
import type { User } from '@privy-io/react-auth';
import { toSolanaWalletConnectors, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { privyAppId, privyClientId, solanaRpcUrl, solanaWsUrl } from '@/lib/api/env';
import { isSolanaPubkey } from '@/lib/utils/solana';
import {
  buildSolanaAuthError,
  chooseSolanaWalletAuthAction,
  getPrivyAppIdFingerprint,
  resolveStickySolanaWallet,
  solanaWalletAddressFromPrivyAccount,
  solanaConnectWalletOptions,
  solanaEmbeddedWalletCreateOnLogin,
  solanaLoginMethodsAndOrder,
  solanaLoginModalOptions,
  solanaWalletConnectorOptions,
  solanaWalletList,
  type DirectSolanaLoginStatus,
  type SolanaAuthError
} from './solanaLogin';

const PREFERRED_SOLANA_ADDRESS_KEY = 'bm_preferred_solana_wallet_address';
const STICKY_SOLANA_ADDRESS_KEY = 'bm_sticky_solana_wallet_address';

type IdentityWalletSnapshot = {
  userId: string | null;
  address: string | null;
};

function readPersistedAddress(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(key);
    return stored && isSolanaPubkey(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writePersistedAddress(key: string, address: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (address) {
      localStorage.setItem(key, address);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function clearPersistedAddresses() {
  writePersistedAddress(PREFERRED_SOLANA_ADDRESS_KEY, null);
  writePersistedAddress(STICKY_SOLANA_ADDRESS_KEY, null);
}

export function walletAddressForUser(user: User | null) {
  if (!user) return null;
  const authUser = user as unknown as { wallet?: { address?: string }; linkedAccounts?: Array<{ type?: string; address?: string; chainType?: string }> };
  const addresses = [
    authUser?.wallet?.address,
    ...(authUser?.linkedAccounts?.map((account) => account.address) ?? [])
  ];
  return addresses.find((address): address is string => Boolean(address && isSolanaPubkey(address))) ?? null;
}

function userIdForWalletSnapshot(user: User | null) {
  if (!user || typeof user !== 'object') return null;
  const record = user as unknown as Record<string, unknown>;
  return typeof record.id === 'string' && record.id ? record.id : null;
}

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  privyConfigured: boolean;
  privyAppIdFingerprint: string;
  authError: SolanaAuthError | null;
  directSolanaLoginStatus: DirectSolanaLoginStatus;
  identityWalletAddress: string | null;
  walletAddress: string | null;
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
  const privyUserId = userIdForWalletSnapshot(privy.user);
  const [preferredSolanaWalletAddress, setPreferredSolanaWalletAddress] = useState<string | null>(() =>
    readPersistedAddress(PREFERRED_SOLANA_ADDRESS_KEY)
  );
  const [stickySolanaWalletAddress, setStickySolanaWalletAddress] = useState<string | null>(() =>
    readPersistedAddress(STICKY_SOLANA_ADDRESS_KEY)
  );
  const [identityWalletSnapshot, setIdentityWalletSnapshot] = useState<IdentityWalletSnapshot>({
    userId: null,
    address: null
  });
  const [authError, setAuthError] = useState<SolanaAuthError | null>(null);
  const [directSolanaLoginStatus, setDirectSolanaLoginStatus] = useState<DirectSolanaLoginStatus>('idle');
  const loginModalOpened = useRef(false);
  const stickySolanaWallet = resolveStickySolanaWallet({
    authenticated: privy.authenticated,
    wallets: solanaWallets,
    walletsReady: solanaWalletsReady,
    identityAddress: identityWalletSnapshot.userId === privyUserId ? identityWalletSnapshot.address : null,
    preferredAddress: preferredSolanaWalletAddress,
    previousAddress: stickySolanaWalletAddress
  });
  const solanaWallet = stickySolanaWallet.wallet;
  const solanaWalletAddress = stickySolanaWallet.address;
  const identityWalletAddress = solanaWalletAddress;
  const solanaWalletResolving = stickySolanaWallet.resolving;
  const hasSolanaWallet = stickySolanaWallet.hasSolanaWallet;
  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
      const loginAddress = solanaWalletAddressFromPrivyAccount(loginAccount);
      if (loginAddress) {
        setPreferredSolanaWalletAddress(loginAddress);
      } else {
        setPreferredSolanaWalletAddress(null);
        setStickySolanaWalletAddress(null);
        clearPersistedAddresses();
      }
      setAuthError(null);
      setDirectSolanaLoginStatus('idle');
      loginModalOpened.current = false;
    },
    onError: (error) => {
      const err = buildSolanaAuthError('login', error);
      setAuthError(err);
      setDirectSolanaLoginStatus(err ? 'error' : 'idle');
      loginModalOpened.current = false;
    }
  });
  const { linkWallet } = useLinkAccount({
    onSuccess: ({ linkedAccount }) => {
      const linkedAddress = solanaWalletAddressFromPrivyAccount(linkedAccount);
      if (linkedAddress) {
        setPreferredSolanaWalletAddress(linkedAddress);
      }
      setAuthError(null);
      setDirectSolanaLoginStatus('idle');
      loginModalOpened.current = false;
    },
    onError: (error) => {
      const err = buildSolanaAuthError('link', error);
      setAuthError(err);
      setDirectSolanaLoginStatus(err ? 'error' : 'idle');
      loginModalOpened.current = false;
    }
  });

  useEffect(() => {
    if (!privy.ready || privy.authenticated) return;
    setPreferredSolanaWalletAddress(null);
    setStickySolanaWalletAddress(null);
    setIdentityWalletSnapshot({ userId: null, address: null });
    clearPersistedAddresses();
  }, [privy.authenticated, privy.ready]);

  useEffect(() => {
    if (!privy.authenticated || !privyUserId) return;

    setIdentityWalletSnapshot((currentSnapshot) => {
      if (currentSnapshot.userId === privyUserId) return currentSnapshot;
      return {
        userId: privyUserId,
        address: preferredSolanaWalletAddress ?? walletAddressForUser(privy.user)
      };
    });
  }, [preferredSolanaWalletAddress, privy.authenticated, privy.user, privyUserId]);

  useEffect(() => {
    writePersistedAddress(PREFERRED_SOLANA_ADDRESS_KEY, preferredSolanaWalletAddress);
  }, [preferredSolanaWalletAddress]);

  useEffect(() => {
    writePersistedAddress(STICKY_SOLANA_ADDRESS_KEY, stickySolanaWalletAddress);
  }, [stickySolanaWalletAddress]);

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

    setDirectSolanaLoginStatus('opening');
    try {
      if (authAction === 'login') {
        login(solanaLoginModalOptions);
      } else {
        linkWallet(solanaConnectWalletOptions);
      }
    } catch (error) {
      const err = buildSolanaAuthError(authAction === 'linkWallet' ? 'link' : 'login', error);
      setAuthError(err);
      setDirectSolanaLoginStatus(err ? 'error' : 'idle');
    }
  }, [hasSolanaWallet, linkWallet, login, privy.authenticated]);

  const logout = useCallback(async () => {
    setPreferredSolanaWalletAddress(null);
    setStickySolanaWalletAddress(null);
    setIdentityWalletSnapshot({ userId: null, address: null });
    clearPersistedAddresses();
    setAuthError(null);
    setDirectSolanaLoginStatus('idle');
    loginModalOpened.current = false;
    await privy.logout();
  }, [privy]);

  const walletAddress = identityWalletAddress;

  const value = useMemo(
    () => ({
      ready: privy.ready,
      authenticated: privy.authenticated,
      user: privy.user,
      privyConfigured: true,
      privyAppIdFingerprint,
      authError,
      directSolanaLoginStatus,
      identityWalletAddress,
      walletAddress,
      solanaWalletAddress,
      solanaWallet,
      solanaWalletsReady,
      solanaWalletResolving,
      hasSolanaWallet,
      loginSolana,
      clearAuthError,
      logout,
      getAccessToken: () => privy.getAccessToken()
    }),
    [
      authError,
      clearAuthError,
      directSolanaLoginStatus,
      hasSolanaWallet,
      identityWalletAddress,
      loginSolana,
      logout,
      privy,
      solanaWallet,
      solanaWalletAddress,
      walletAddress,
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
        identityWalletAddress: null,
        walletAddress: null,
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
        loginMethodsAndOrder: solanaLoginMethodsAndOrder,
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
            createOnLogin: solanaEmbeddedWalletCreateOnLogin
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
          showWalletLoginFirst: false,
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
