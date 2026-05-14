import type { ConnectWalletModalOptions, LoginModalOptions, PrivyClientConfig, WalletListEntry } from '@privy-io/react-auth';
import { isSolanaPubkey } from '@/lib/utils/solana';

export type SolanaAuthErrorStep = 'login' | 'link';

export type SolanaAuthError = {
  step: SolanaAuthErrorStep;
  title: string;
  message: string;
  detail?: string;
};

export type DirectSolanaLoginStatus = 'idle' | 'opening' | 'error';
export type SolanaWalletAuthAction = 'login' | 'linkWallet';

export const solanaWalletConnectorOptions = {
  shouldAutoConnect: false
};

export const solanaWalletList: WalletListEntry[] = [
  'detected_solana_wallets',
  'phantom',
  'okx_wallet',
  'solflare',
  'backpack',
  'jupiter',
  'wallet_connect_qr_solana'
];

export const solanaLoginMethodsAndOrder = {
  primary: ['email', 'google', 'phantom', 'okx_wallet'],
  overflow: ['solflare', 'backpack', 'jupiter', 'wallet_connect_qr_solana']
} satisfies NonNullable<PrivyClientConfig['loginMethodsAndOrder']>;

export const solanaEmbeddedWalletCreateOnLogin = 'users-without-wallets' satisfies NonNullable<NonNullable<PrivyClientConfig['embeddedWallets']>['solana']>['createOnLogin'];

export const solanaLoginModalOptions: LoginModalOptions = {
  walletChainType: 'solana-only'
};

export const solanaConnectWalletOptions: ConnectWalletModalOptions = {
  walletChainType: 'solana-only',
  walletList: solanaWalletList,
  description: 'OKX kullanıyorsan OKX içinde Solana hesabını seçerek bağlan.'
};

export function chooseSolanaWalletAuthAction({
  authenticated
}: {
  authenticated: boolean;
  solanaWalletCount?: number;
}): SolanaWalletAuthAction {
  if (!authenticated) return 'login';
  return 'linkWallet';
}

export function solanaWalletAddressFromPrivyAccount(account: unknown) {
  if (typeof account !== 'object' || account === null) return null;
  const record = account as Record<string, unknown>;
  if (typeof record.type === 'string' && record.type !== 'wallet') return null;
  if (typeof record.chainType === 'string' && record.chainType !== 'solana') return null;
  const address = typeof record.address === 'string' ? record.address : null;
  if (!address || !isSolanaPubkey(address)) return null;
  return address;
}

export type StickySolanaWalletInput<TWallet extends { address: string }> = {
  authenticated: boolean;
  wallets: TWallet[];
  walletsReady: boolean;
  identityAddress?: string | null;
  preferredAddress?: string | null;
  previousAddress: string | null;
};

export type StickySolanaWalletState<TWallet extends { address: string }> = {
  wallet: TWallet | null;
  address: string | null;
  hasSolanaWallet: boolean;
  resolving: boolean;
  nextStickyAddress: string | null;
};

export function resolveStickySolanaWallet<TWallet extends { address: string }>({
  authenticated,
  wallets,
  walletsReady,
  identityAddress,
  preferredAddress,
  previousAddress
}: StickySolanaWalletInput<TWallet>): StickySolanaWalletState<TWallet> {
  if (!authenticated) {
    return {
      wallet: null,
      address: null,
      hasSolanaWallet: false,
      resolving: false,
      nextStickyAddress: null
    };
  }

  const activeIdentityAddress = [
    preferredAddress,
    identityAddress,
    previousAddress
  ].find((address): address is string => Boolean(address && isSolanaPubkey(address)));

  if (activeIdentityAddress) {
    const preferredWallet = wallets.find((wallet) => wallet.address === activeIdentityAddress) ?? null;
    return {
      wallet: preferredWallet,
      address: activeIdentityAddress,
      hasSolanaWallet: true,
      resolving: !preferredWallet,
      nextStickyAddress: activeIdentityAddress
    };
  }

  return {
    wallet: null,
    address: null,
    hasSolanaWallet: false,
    resolving: !walletsReady,
    nextStickyAddress: null
  };
}

export function getPrivyAppIdFingerprint(appId: string) {
  const trimmed = appId.trim();
  if (!trimmed) return 'not configured';
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function buildSolanaAuthError(step: SolanaAuthErrorStep, error: unknown): SolanaAuthError | null {
  const detail = readErrorDetail(error);

  if (isPrivySolanaLoginDisabledError(detail)) {
    return {
      step,
      title: 'Privy Solana girişi kapalı',
      message: 'Yanlış Privy app id kullanılıyor olabilir veya bu app için Solana wallet login kapalı. Privy Dashboard’da Wallet + Solana login’i açıp localhost origin izinlerini ekle.',
      detail
    };
  }

  if (isPrivySiwsMessageOrNonceError(detail)) {
    return {
      step,
      title: 'SIWS doğrulanamadı',
      message: 'SIWS imza formatı/nonce doğrulanamadı. Sayfayı yenileyip tekrar deneyin.',
      detail
    };
  }

  if (isUserRejectedError(detail) || detail === 'exited_auth_flow') {
    return null;
  }

  return {
    step,
    title: 'Solana cüzdan bağlantısı tamamlanamadı',
    message: 'Privy bu oturumda Solana hesabı göremiyor. OKX bağlı olabilir; OKX içinde Solana hesabını seçerek tekrar bağla.',
    detail
  };
}

function readErrorDetail(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : undefined;
    const privyErrorCode = typeof record.privyErrorCode === 'string' ? record.privyErrorCode : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    return [privyErrorCode, code, message].filter(Boolean).join(': ') || undefined;
  }
  return undefined;
}

function isUserRejectedError(detail: string | undefined) {
  if (!detail) return false;
  return detail.includes('4001') || detail.toLowerCase().includes('reject') || detail.toLowerCase().includes('cancel');
}

function isPrivySolanaLoginDisabledError(detail: string | undefined) {
  if (!detail) return false;
  const normalized = detail.toLowerCase();
  return normalized.includes('login with solana wallet not allowed') ||
    normalized.includes('disallowed_login_method') ||
    normalized.includes('feature_not_enabled');
}

function isPrivySiwsMessageOrNonceError(detail: string | undefined) {
  if (!detail) return false;
  return detail.toLowerCase().includes('invalid siws message and/or nonce');
}
