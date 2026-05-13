'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { useStandardWallets } from '@privy-io/react-auth/solana';
import { solanaRpcUrl, walletConnectProjectId } from '@/lib/api/env';
import { createSolanaRpc } from '@solana/kit';
import { useAuth } from '@/lib/auth/privy';

type SolanaWalletProvider = {
  icon?: string;
  iconUrl?: string;
  logo?: string;
  logoURI?: string;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect: (options?: { onlyIfTrusted?: boolean; silent?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect?: () => Promise<void>;
  signAndSendTransaction?: (transaction: VersionedTransaction) => Promise<{ signature: string }>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array | string }>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type ExternalSolanaWallet = {
  address: string;
  walletName: string;
  provider: SolanaWalletProvider;
  publicKey: { toString(): string };
  connectionGeneration: number;
};

type DetectedWallet = {
  name: string;
  accent: string;
  icon: string | null;
  installed: boolean;
  providerKey: string;
  source: ExternalWalletOption['source'];
  provider?: SolanaWalletProvider;
};

export type ExternalWalletOption = {
  name: string;
  accent: string;
  icon: string | null;
  installed: boolean;
  providerKey: string;
  source: 'privy-standard' | 'injected' | 'fallback';
  kind?: 'standard' | 'walletconnect';
  disabledReason?: string;
};

type WalletDefinition = {
  providerKey: string;
  name: string;
  accent: string;
  aliases: string[];
  detectors: Array<() => SolanaWalletProvider | undefined>;
  preferStandardProvider?: boolean;
};

const WALLET_DEFINITIONS: WalletDefinition[] = [
  {
    providerKey: 'phantom',
    name: 'Phantom',
    accent: '#8a63d2',
    aliases: ['phantom'],
    detectors: [
      () => providerFromGlobal('phantom'),
      () => providerFromFlag('isPhantom')
    ]
  },
  {
    providerKey: 'okx_wallet',
    name: 'OKX Wallet',
    accent: '#ffffff',
    aliases: ['okx', 'okx wallet'],
    detectors: [
      () => providerFromGlobal('okxwallet'),
      () => providerFromGlobal('okxWallet'),
      () => providerFromGlobal('okx'),
      () => providerFromFlag('isOKXWallet'),
      () => providerFromFlag('isOkxWallet'),
      () => providerFromFlag('isOKX')
    ]
  },
  {
    providerKey: 'backpack',
    name: 'Backpack',
    accent: '#e33e3f',
    aliases: ['backpack'],
    detectors: [
      () => providerFromGlobal('backpack'),
      () => providerFromFlag('isBackpack')
    ]
  },
  {
    providerKey: 'solflare',
    name: 'Solflare',
    accent: '#f26b2f',
    aliases: ['solflare'],
    detectors: [
      () => providerFromGlobal('solflare'),
      () => providerFromFlag('isSolflare')
    ]
  },
  {
    providerKey: 'jupiter',
    name: 'Jupiter',
    accent: '#31c48d',
    aliases: ['jupiter', 'jup'],
    preferStandardProvider: true,
    detectors: [
      () => providerFromGlobal('jupiter'),
      () => providerFromGlobal('jup')
    ]
  }
];

const BRAND_WALLET_ICONS: Record<string, string> = {
  backpack: '/wallet-icons/backpack.png',
  jupiter: '/wallet-icons/jupiter.svg',
  solflare: '/wallet-icons/solflare.svg'
};

const WALLETCONNECT_WALLET_NAME = 'WalletConnect QR';
const WALLETCONNECT_PROVIDER_KEY = 'walletconnect_qr';
const WALLETCONNECT_MAINNET_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const WALLETCONNECT_DEVNET_CHAIN = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const WALLETCONNECT_SOLANA_METHODS = [
  'solana_signMessage',
  'solana_signTransaction',
  'solana_signAndSendTransaction',
  'solana:signMessage',
  'solana:signTransaction',
  'solana:signAndSendTransaction'
];

type StandardSolanaWallet = ReturnType<typeof useStandardWallets>['wallets'][number];
type StandardWalletAccount = StandardSolanaWallet['accounts'][number];

type ExternalWalletContextValue = {
  connected: boolean;
  connecting: boolean;
  externalWallet: ExternalSolanaWallet | null;
  walletAddress: string | null;
  walletName: string | null;
  publicKey: { toString(): string } | null;
  availableWallets: ExternalWalletOption[];
  connect: (walletName?: string) => Promise<void>;
  connectFresh: (walletName?: string) => Promise<ExternalSolanaWallet>;
  disconnect: () => Promise<void>;
  reset: () => Promise<void>;
  walletConnectQrUri: string | null;
  walletConnectDeepLink: string | null;
  clearWalletConnectQr: () => void;
  signAndSendTransaction: (serializedTransaction: Uint8Array) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
};

const ExternalWalletContext = createContext<ExternalWalletContextValue | null>(null);

function detectWallets(standardWallets: StandardSolanaWallet[] = []) {
  const externalStandardWallets = standardWallets.filter((wallet) => !isPrivyStandardWallet(wallet) && !isWalletConnectStandardWallet(wallet));
  const seenProviders = new Set<SolanaWalletProvider>();
  const usedStandardWallets = new Set<StandardSolanaWallet>();
  const catalogWallets = WALLET_DEFINITIONS.map((definition): DetectedWallet => {
    const standardWallet = findStandardWallet(externalStandardWallets, definition);
    if (standardWallet) {
      usedStandardWallets.add(standardWallet);
    }
    const provider = detectProvider(definition);
    const duplicateProvider = Boolean(provider && seenProviders.has(provider));
    if (provider && !duplicateProvider) {
      seenProviders.add(provider);
    }
    const standardProvider = standardWallet ? createStandardWalletProvider(standardWallet) : undefined;
    const injectedProvider = provider && !duplicateProvider ? provider : undefined;
    const nextProvider = definition.preferStandardProvider ? standardProvider ?? injectedProvider : injectedProvider ?? standardProvider;
    const providerIcon = provider ? readWalletIcon(provider) : null;
    const icon = standardWallet?.icon ?? providerIcon ?? localWalletIcon(definition.providerKey);
    return {
      name: definition.name,
      accent: definition.accent,
      icon,
      installed: Boolean(nextProvider),
      providerKey: definition.providerKey,
      source: standardWallet?.icon ? 'privy-standard' : providerIcon ? 'injected' : 'fallback',
      provider: nextProvider
    };
  });
  return catalogWallets
    .concat(unlistedStandardWallets(externalStandardWallets, usedStandardWallets))
    .concat(genericInjectedWallet(seenProviders));
}

function getExternalWalletOptions(standardWallets: StandardSolanaWallet[] = []): ExternalWalletOption[] {
  const options = detectWallets(standardWallets).map(({ name, accent, icon, installed, providerKey, source }) => ({
    name,
    accent,
    icon,
    installed,
    providerKey,
    source
  }));
  const insertIndex = Math.min(WALLET_DEFINITIONS.length, options.length);
  return options.slice(0, insertIndex).concat(walletConnectOption(), options.slice(insertIndex));
}

function readWalletIcon(provider: SolanaWalletProvider) {
  const record = provider as Record<string, unknown>;
  for (const key of ['icon', 'iconUrl', 'logo', 'logoURI']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const adapter = record.adapter;
  if (adapter && typeof adapter === 'object') {
    const adapterIcon = (adapter as Record<string, unknown>).icon;
    if (typeof adapterIcon === 'string' && adapterIcon.trim()) return adapterIcon;
  }
  return null;
}

function detectProvider(definition: WalletDefinition) {
  for (const detector of definition.detectors) {
    try {
      const provider = detector();
      if (provider) return provider;
    } catch {
      // Wallet globals can throw while extensions are initializing.
    }
  }
  return undefined;
}

function getWindowRecord() {
  if (typeof window === 'undefined') return null;
  return window as unknown as Record<string, unknown>;
}

function providerFromGlobal(key: string) {
  const globalRecord = getWindowRecord();
  const candidate = globalRecord?.[key];
  const nestedSolana = objectRecord(candidate)?.solana;
  return asSolanaProvider(nestedSolana) ?? asSolanaProvider(candidate);
}

function providerFromFlag(flag: string) {
  const provider = asSolanaProvider(getWindowRecord()?.solana);
  if (!provider) return undefined;
  return Boolean((provider as Record<string, unknown>)[flag]) ? provider : undefined;
}

function asSolanaProvider(value: unknown): SolanaWalletProvider | undefined {
  return value && typeof value === 'object' ? value as SolanaWalletProvider : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function findStandardWallet(standardWallets: StandardSolanaWallet[], definition: WalletDefinition) {
  return standardWallets.find((wallet) => {
    const normalizedName = normalizeWalletName(wallet.name);
    return normalizedName === normalizeWalletName(definition.name)
      || definition.aliases.some((alias) => normalizedName === normalizeWalletName(alias));
  });
}

function unlistedStandardWallets(standardWallets: StandardSolanaWallet[], usedStandardWallets: Set<StandardSolanaWallet>): DetectedWallet[] {
  return standardWallets
    .filter((wallet) => !usedStandardWallets.has(wallet))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((wallet) => {
      const provider = createStandardWalletProvider(wallet);
      return {
        name: wallet.name,
        accent: '#14f195',
        icon: wallet.icon ?? localWalletIcon('detected_solana_wallet'),
        installed: Boolean(provider),
        providerKey: normalizeWalletName(wallet.name).replace(/\s+/g, '_') || 'standard_wallet',
        source: wallet.icon ? 'privy-standard' : 'fallback',
        provider
      };
    });
}

function isPrivyStandardWallet(wallet: StandardSolanaWallet) {
  const walletRecord = wallet as unknown as Record<string, unknown>;
  const features = objectRecord(walletRecord.features);
  return walletRecord.isPrivyWallet === true
    || Boolean(features?.['privy:'])
    || normalizeWalletName(wallet.name).includes('privy');
}

function isWalletConnectStandardWallet(wallet: StandardSolanaWallet) {
  const walletRecord = wallet as unknown as Record<string, unknown>;
  const rawValues = [
    wallet.name,
    walletRecord.id,
    walletRecord.rdns,
    walletRecord.providerKey
  ].filter((value): value is string => typeof value === 'string');
  const rawText = rawValues.join(' ').toLowerCase();
  return walletRecord.isWalletConnectSolana === true
    || rawText.includes('walletconnect')
    || rawText.includes('wallet connect');
}

function walletConnectOption(): ExternalWalletOption {
  const configured = Boolean(configuredWalletConnectProjectId());
  return {
    name: WALLETCONNECT_WALLET_NAME,
    accent: '#3b99fc',
    icon: localWalletIcon(WALLETCONNECT_PROVIDER_KEY),
    installed: configured,
    providerKey: WALLETCONNECT_PROVIDER_KEY,
    source: 'fallback',
    kind: 'walletconnect',
    disabledReason: configured ? undefined : 'WalletConnect QR is not configured'
  };
}

function configuredWalletConnectProjectId() {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || walletConnectProjectId;
}

function genericInjectedWallet(seenProviders: Set<SolanaWalletProvider>): DetectedWallet[] {
  const provider = asSolanaProvider(getWindowRecord()?.solana);
  if (!provider || seenProviders.has(provider)) return [];
  const providerIcon = readWalletIcon(provider);
  return [{
    name: 'Detected Solana Wallet',
    accent: '#14f195',
    icon: providerIcon ?? localWalletIcon('detected_solana_wallet'),
    installed: true,
    providerKey: 'detected_solana_wallet',
    source: providerIcon ? 'injected' : 'fallback',
    provider
  }];
}

function normalizeWalletName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bwallet\b/g, '').trim();
}

function localWalletIcon(providerKey: string) {
  const brandIcon = BRAND_WALLET_ICONS[providerKey];
  if (brandIcon) return brandIcon;

  const label = providerKey === 'okx_wallet' ? 'OKX' : providerKey.slice(0, 1).toUpperCase();
  const colors: Record<string, { bg: string; fg: string }> = {
    phantom: { bg: '#8a63d2', fg: '#ffffff' },
    okx_wallet: { bg: '#ffffff', fg: '#0b0f14' },
    backpack: { bg: '#e33e3f', fg: '#ffffff' },
    solflare: { bg: '#f26b2f', fg: '#111827' },
    jupiter: { bg: '#31c48d', fg: '#051713' },
    walletconnect_qr: { bg: '#3b99fc', fg: '#ffffff' },
    detected_solana_wallet: { bg: '#14f195', fg: '#06110d' }
  };
  const color = colors[providerKey] ?? colors.detected_solana_wallet;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${color.bg}"/><circle cx="46" cy="18" r="7" fill="${color.fg}" opacity=".22"/><path d="M17 42c7-17 23-17 30 0" fill="none" stroke="${color.fg}" stroke-width="5" stroke-linecap="round"/><text x="32" y="34" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${label.length > 1 ? 15 : 22}" font-weight="800" fill="${color.fg}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createStandardWalletProvider(wallet: StandardSolanaWallet): SolanaWalletProvider | undefined {
  const features = wallet.features as Record<string, unknown>;
  const connectFeature = features['standard:connect'] as { connect?: (input?: { silent?: boolean }) => Promise<{ accounts?: readonly StandardWalletAccount[] }> } | undefined;
  if (!connectFeature?.connect) return undefined;

  let activeAccount: StandardWalletAccount | undefined = wallet.accounts[0];
  const publicKey = () => activeAccount ? { toString: () => activeAccount?.address ?? '' } : undefined;
  return {
    get isConnected() {
      return Boolean(activeAccount);
    },
    get publicKey() {
      return publicKey();
    },
    connect: async (options) => {
      const result = await connectFeature.connect?.({ silent: options?.onlyIfTrusted === true || options?.silent === true });
      activeAccount = result?.accounts?.[0] ?? wallet.accounts[0];
      if (!activeAccount) throw new Error(`${wallet.name} did not return a Solana account.`);
      return { publicKey: publicKey()! };
    },
    disconnect: async () => {
      const disconnectFeature = features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined;
      await disconnectFeature?.disconnect?.();
      activeAccount = undefined;
    },
    signAndSendTransaction: async (transaction) => {
      const account = activeAccount ?? wallet.accounts[0];
      const signAndSendFeature = features['solana:signAndSendTransaction'] as { signAndSendTransaction?: (...inputs: Array<{ account: StandardWalletAccount; transaction: Uint8Array; chain: string }>) => Promise<readonly { signature: Uint8Array }[]> } | undefined;
      if (!account || !signAndSendFeature?.signAndSendTransaction) {
        throw new Error(`${wallet.name} does not support transaction signing.`);
      }
      const [result] = await signAndSendFeature.signAndSendTransaction({
        account,
        transaction: transaction.serialize(),
        chain: 'solana:devnet'
      });
      return { signature: base58FromBytes(result.signature) };
    },
    signTransaction: async (transaction) => {
      const account = activeAccount ?? wallet.accounts[0];
      const signTransactionFeature = features['solana:signTransaction'] as { signTransaction?: (...inputs: Array<{ account: StandardWalletAccount; transaction: Uint8Array; chain: string }>) => Promise<readonly { signedTransaction: Uint8Array }[]> } | undefined;
      if (!account || !signTransactionFeature?.signTransaction) {
        throw new Error(`${wallet.name} does not support transaction signing.`);
      }
      const [result] = await signTransactionFeature.signTransaction({
        account,
        transaction: transaction.serialize(),
        chain: 'solana:devnet'
      });
      return VersionedTransaction.deserialize(Buffer.from(result.signedTransaction));
    },
    signMessage: async (message) => {
      const account = activeAccount ?? wallet.accounts[0];
      const signMessageFeature = features['solana:signMessage'] as { signMessage?: (...inputs: Array<{ account: StandardWalletAccount; message: Uint8Array }>) => Promise<readonly { signature: Uint8Array }[]> } | undefined;
      if (!account || !signMessageFeature?.signMessage) {
        throw new Error(`${wallet.name} does not support message signing.`);
      }
      const [result] = await signMessageFeature.signMessage({ account, message });
      return { signature: result.signature };
    }
  };
}

type WalletConnectSession = {
  namespaces?: Record<string, { accounts?: string[] }>;
};

type WalletConnectUniversalProvider = {
  session?: WalletConnectSession;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  connect: (input: {
    optionalNamespaces: Record<string, {
      chains: string[];
      methods: string[];
      events: string[];
    }>;
  }) => Promise<WalletConnectSession>;
  request: (input: { method: string; params?: unknown }) => Promise<unknown>;
  disconnect: () => Promise<void>;
};

async function createWalletConnectSolanaProvider(
  projectId: string,
  onDisplayUri: (uri: string, qrDataUrl: string) => void
): Promise<SolanaWalletProvider> {
  const [{ default: UniversalProvider }, QRCode] = await Promise.all([
    import('@walletconnect/universal-provider'),
    import('qrcode')
  ]);
  const provider = await UniversalProvider.init({
    projectId,
    relayUrl: 'wss://relay.walletconnect.com',
    metadata: {
      name: 'Basinga Market',
      description: 'External Solana wallet connection for deposit and withdraw',
      url: typeof window === 'undefined' ? 'https://basinga.market' : window.location.origin,
      icons: []
    },
    telemetryEnabled: false
  }) as WalletConnectUniversalProvider;

  let activeAddress: string | null = null;
  provider.on('display_uri', (uri) => {
    if (typeof uri !== 'string') return;
    void QRCode.toDataURL(uri, { margin: 1, width: 260 }).then((qrDataUrl) => {
      onDisplayUri(uri, qrDataUrl);
    });
  });

  const getPublicKey = () => activeAddress ? { toString: () => activeAddress ?? '' } : undefined;
  const request = async (method: string, params: Record<string, unknown>) => {
    try {
      return await provider.request({ method, params });
    } catch (error) {
      const alternateMethod = method.includes(':') ? method.replace('solana:', 'solana_') : method.replace('solana_', 'solana:');
      if (alternateMethod === method) throw error;
      return provider.request({ method: alternateMethod, params });
    }
  };

  return {
    get isConnected() {
      return Boolean(activeAddress);
    },
    get publicKey() {
      return getPublicKey();
    },
    connect: async () => {
      const session = await provider.connect({
        optionalNamespaces: {
          solana: {
            chains: [WALLETCONNECT_DEVNET_CHAIN, WALLETCONNECT_MAINNET_CHAIN],
            methods: WALLETCONNECT_SOLANA_METHODS,
            events: ['accountsChanged']
          }
        }
      });
      activeAddress = readWalletConnectSolanaAddress(session) ?? readWalletConnectSolanaAddress(provider.session) ?? null;
      if (!activeAddress) {
        throw new Error('WalletConnect did not return a Solana account.');
      }
      return { publicKey: getPublicKey()! };
    },
    disconnect: async () => {
      activeAddress = null;
      await provider.disconnect();
    },
    signAndSendTransaction: async (transaction) => {
      if (!activeAddress) throw new Error('WalletConnect is not connected.');
      const result = await request('solana_signAndSendTransaction', {
        transaction: Buffer.from(transaction.serialize()).toString('base64'),
        pubkey: activeAddress
      });
      const signature = readWalletConnectStringResult(result, ['signature']);
      if (!signature) throw new Error('WalletConnect did not return a transaction signature.');
      return { signature };
    },
    signTransaction: async (transaction) => {
      if (!activeAddress) throw new Error('WalletConnect is not connected.');
      const result = await request('solana_signTransaction', {
        transaction: Buffer.from(transaction.serialize()).toString('base64'),
        pubkey: activeAddress
      });
      const signedTransaction = readWalletConnectStringResult(result, ['transaction', 'signedTransaction']);
      if (!signedTransaction) throw new Error('WalletConnect did not return a signed transaction.');
      return VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
    },
    signMessage: async (message) => {
      if (!activeAddress) throw new Error('WalletConnect is not connected.');
      const result = await request('solana_signMessage', {
        message: base58FromBytes(message),
        pubkey: activeAddress
      });
      const signature = readWalletConnectStringResult(result, ['signature']);
      if (!signature) throw new Error('WalletConnect did not return a message signature.');
      return { signature };
    }
  };
}

function readWalletConnectSolanaAddress(session?: WalletConnectSession) {
  const accounts = Object.entries(session?.namespaces ?? {})
    .filter(([namespace]) => namespace === 'solana' || namespace.startsWith('solana:'))
    .flatMap(([, value]) => value.accounts ?? []);
  const account = accounts.find((candidate) => candidate.startsWith('solana:'));
  return account?.split(':').at(-1) ?? null;
}

function readWalletConnectStringResult(result: unknown, keys: string[]) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

async function disconnectExternalProviders(activeProvider?: SolanaWalletProvider | null) {
  const providers = new Set<SolanaWalletProvider>();
  if (activeProvider) {
    providers.add(activeProvider);
  }
  for (const wallet of detectWallets()) {
    if (!wallet.provider) continue;
    providers.add(wallet.provider);
  }
  await Promise.all(Array.from(providers).map(async (provider) => {
    try {
      await provider.disconnect?.();
    } catch {
      // Browser wallet disconnect failures should not block app state cleanup.
    }
  }));
}

function safeBase58ToBytes(signature: Uint8Array | string): Uint8Array {
  if (typeof signature === 'string') {
    const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes: number[] = [];
    for (const char of signature) {
      const digit = BASE58.indexOf(char);
      if (digit === -1) continue;
      let carry = digit;
      for (let i = bytes.length - 1; i >= 0; i--) {
        const next = bytes[i] * 58 + carry;
        bytes[i] = next & 0xff;
        carry = next >> 8;
      }
      while (carry > 0) {
        bytes.unshift(carry & 0xff);
        carry >>= 8;
      }
    }
    for (const char of signature) {
      if (char !== '1') break;
      bytes.unshift(0);
    }
    return Uint8Array.from(bytes);
  }
  return signature;
}

function base58FromBytes(bytes: Uint8Array) {
  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits.reverse().map((digit) => BASE58[digit]).join('');
}

export function ExternalWalletProvider({ children }: { children: ReactNode }) {
  const { authenticated } = useAuth();
  const { wallets: standardWallets } = useStandardWallets();
  const previousAuthenticatedRef = useRef(false);
  const connectionGenerationRef = useRef(0);
  const activeProviderRef = useRef<SolanaWalletProvider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [externalWallet, setExternalWallet] = useState<ExternalSolanaWallet | null>(null);
  const [walletConnectQrUri, setWalletConnectQrUri] = useState<string | null>(null);
  const [walletConnectDeepLink, setWalletConnectDeepLink] = useState<string | null>(null);
  const [walletDetectionRevision, setWalletDetectionRevision] = useState(0);
  const availableWallets = useMemo(
    () => getExternalWalletOptions(standardWallets),
    [standardWallets, walletDetectionRevision]
  );
  const clearWalletConnectQr = useCallback(() => {
    setWalletConnectQrUri(null);
    setWalletConnectDeepLink(null);
  }, []);

  useEffect(() => {
    const refreshWallets = () => setWalletDetectionRevision((revision) => revision + 1);
    window.addEventListener('focus', refreshWallets);
    document.addEventListener('visibilitychange', refreshWallets);
    return () => {
      window.removeEventListener('focus', refreshWallets);
      document.removeEventListener('visibilitychange', refreshWallets);
    };
  }, []);

  useEffect(() => {
    if (!externalWallet?.provider) return;
    const provider = externalWallet.provider;
    const connectionGeneration = externalWallet.connectionGeneration;
    if (!provider.on) return;
    const subscribe = provider.on.bind(provider);
    const clearConnectedWallet = () => {
      if (activeProviderRef.current !== provider || connectionGenerationRef.current !== connectionGeneration) return;
      connectionGenerationRef.current += 1;
      activeProviderRef.current = null;
      setConnecting(false);
      setExternalWallet(null);
    };
    const updateConnectedWallet = (nextPublicKey?: unknown) => {
      if (activeProviderRef.current !== provider || connectionGenerationRef.current !== connectionGeneration) return;
      if (!nextPublicKey || typeof nextPublicKey !== 'object' || typeof (nextPublicKey as { toString?: unknown }).toString !== 'function') {
        clearConnectedWallet();
        return;
      }
      const publicKey = nextPublicKey as { toString(): string };
      setExternalWallet((currentWallet) => currentWallet && currentWallet.provider === provider
        ? { ...currentWallet, publicKey, address: publicKey.toString() }
        : currentWallet);
    };

    subscribe('disconnect', clearConnectedWallet);
    subscribe('accountChanged', updateConnectedWallet);

    return () => {
      if (provider.off) {
        provider.off('disconnect', clearConnectedWallet);
        provider.off('accountChanged', updateConnectedWallet);
      } else if (provider.removeListener) {
        provider.removeListener('disconnect', clearConnectedWallet);
        provider.removeListener('accountChanged', updateConnectedWallet);
      }
    };
  }, [externalWallet?.connectionGeneration, externalWallet?.provider]);

  useEffect(() => {
    const wasAuthenticated = previousAuthenticatedRef.current;
    previousAuthenticatedRef.current = authenticated;
    if (wasAuthenticated || !authenticated) return;

    connectionGenerationRef.current += 1;
    const provider = activeProviderRef.current ?? externalWallet?.provider ?? null;
    activeProviderRef.current = null;
    setConnecting(false);
    clearWalletConnectQr();
    void disconnectExternalProviders(provider);
    setExternalWallet(null);
  }, [authenticated, clearWalletConnectQr, externalWallet?.provider]);

  const connectWallet = useCallback(async (preferredWallet?: string, fresh = false): Promise<ExternalSolanaWallet> => {
    const previousProvider = activeProviderRef.current ?? externalWallet?.provider ?? null;
    const connectionGeneration = connectionGenerationRef.current + 1;
    connectionGenerationRef.current = connectionGeneration;
    setConnecting(true);
    try {
      activeProviderRef.current = null;
      setExternalWallet(null);
      clearWalletConnectQr();
      if (fresh) {
        await disconnectExternalProviders(previousProvider);
      }
      if (connectionGenerationRef.current !== connectionGeneration) {
        throw new Error('External wallet connection was reset.');
      }

      let detectorName = preferredWallet;
      let provider: SolanaWalletProvider | undefined;
      if (preferredWallet === WALLETCONNECT_WALLET_NAME) {
        const projectId = configuredWalletConnectProjectId();
        if (!projectId) {
          throw new Error('WalletConnect QR is not configured.');
        }
        detectorName = WALLETCONNECT_WALLET_NAME;
        provider = await createWalletConnectSolanaProvider(projectId, (deepLink, qrDataUrl) => {
          if (connectionGenerationRef.current !== connectionGeneration) return;
          setWalletConnectDeepLink(deepLink);
          setWalletConnectQrUri(qrDataUrl);
        });
      }

      const detectedWallets = provider ? [] : detectWallets(standardWallets).filter((wallet): wallet is DetectedWallet & { provider: SolanaWalletProvider } => Boolean(wallet.provider));
      let detector: (DetectedWallet & { provider: SolanaWalletProvider }) | undefined;
      if (detectorName && !provider) {
        detector = detectedWallets.find((d) => d.name === detectorName);
        if (!detector) {
          throw new Error(`${detectorName} is not detected. Install or unlock the wallet extension and try again.`);
        }
      }
      if (!detector && !provider) {
        detector = detectedWallets[0];
      }
      if (!detector && !provider) {
        throw new Error('No Solana wallet found. Install Phantom, Solflare, or another Solana wallet.');
      }
      provider = provider ?? detector!.provider;

      if (!fresh && provider.isConnected && provider.publicKey) {
        const nextWallet = {
          address: provider.publicKey.toString(),
          walletName: detector?.name ?? WALLETCONNECT_WALLET_NAME,
          provider,
          publicKey: provider.publicKey,
          connectionGeneration
        };
        if (connectionGenerationRef.current !== connectionGeneration) {
          throw new Error('External wallet connection was reset.');
        }
        activeProviderRef.current = provider;
        setExternalWallet(nextWallet);
        return nextWallet;
      }
      const response = await provider.connect({ onlyIfTrusted: false });
      const nextWallet = {
        address: response.publicKey.toString(),
        walletName: detector?.name ?? WALLETCONNECT_WALLET_NAME,
        provider,
        publicKey: response.publicKey,
        connectionGeneration
      };
      if (connectionGenerationRef.current !== connectionGeneration) {
        throw new Error('External wallet connection was reset.');
      }
      activeProviderRef.current = provider;
      setExternalWallet(nextWallet);
      clearWalletConnectQr();
      return nextWallet;
    } finally {
      if (connectionGenerationRef.current === connectionGeneration) {
        setConnecting(false);
      }
    }
  }, [clearWalletConnectQr, externalWallet?.provider, standardWallets]);

  const connect = useCallback(async (preferredWallet?: string) => {
    await connectWallet(preferredWallet);
  }, [connectWallet]);

  const connectFresh = useCallback((preferredWallet?: string) => connectWallet(preferredWallet, true), [connectWallet]);

  const reset = useCallback(async () => {
    connectionGenerationRef.current += 1;
    const provider = activeProviderRef.current ?? externalWallet?.provider ?? null;
    activeProviderRef.current = null;
    setConnecting(false);
    clearWalletConnectQr();
    setExternalWallet(null);
    await disconnectExternalProviders(provider);
  }, [clearWalletConnectQr, externalWallet?.provider]);

  const disconnect = reset;

  const sendTransaction = useCallback(async (serializedTransaction: Uint8Array): Promise<string> => {
    if (!externalWallet?.provider) throw new Error('External wallet not connected.');
    const walletProvider = externalWallet.provider;

    const versionedTx = VersionedTransaction.deserialize(Buffer.from(serializedTransaction));

    if (walletProvider.signAndSendTransaction) {
      const result = await walletProvider.signAndSendTransaction(versionedTx);
      return result.signature;
    }

    if (walletProvider.signTransaction) {
      const signedTx = await walletProvider.signTransaction(versionedTx);
      const serialized = signedTx.serialize();
      const base64 = Buffer.from(serialized).toString('base64');
      const rpc = createSolanaRpc(solanaRpcUrl);
      const result = await rpc.sendTransaction(base64 as unknown as Parameters<typeof rpc.sendTransaction>[0], { skipPreflight: true as unknown as boolean }).send();
      return typeof result === 'string' ? result : String(result);
    }

    throw new Error('Wallet does not support transaction signing.');
  }, [externalWallet?.provider]);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    if (!externalWallet?.provider) throw new Error('External wallet not connected.');
    const result = await externalWallet.provider.signMessage(message);
    return safeBase58ToBytes(result.signature);
  }, [externalWallet?.provider]);

  const value = useMemo<ExternalWalletContextValue>(() => ({
    connected: Boolean(externalWallet),
    connecting,
    externalWallet,
    walletAddress: externalWallet?.address ?? null,
    walletName: externalWallet?.walletName ?? null,
    publicKey: externalWallet?.publicKey ?? null,
    availableWallets,
    connect,
    connectFresh,
    disconnect,
    reset,
    walletConnectQrUri,
    walletConnectDeepLink,
    clearWalletConnectQr,
    signAndSendTransaction: sendTransaction,
    signMessage,
  }), [externalWallet, connecting, availableWallets, connect, connectFresh, disconnect, reset, walletConnectQrUri, walletConnectDeepLink, clearWalletConnectQr, sendTransaction, signMessage]);

  return (
    <ExternalWalletContext.Provider value={value}>
      {children}
    </ExternalWalletContext.Provider>
  );
}

export function useExternalWallet() {
  const value = useContext(ExternalWalletContext);
  if (!value) {
    throw new Error('useExternalWallet must be used inside ExternalWalletProvider');
  }
  return value;
}
