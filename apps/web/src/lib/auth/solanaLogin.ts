import type { ConnectWalletModalOptions, LoginModalOptions, WalletListEntry } from '@privy-io/react-auth';

export type SolanaAuthErrorStep = 'login' | 'link';

export type SolanaAuthError = {
  step: SolanaAuthErrorStep;
  title: string;
  message: string;
  detail?: string;
};

export type DirectSolanaLoginStatus = 'idle' | 'opening' | 'error';
export type SolanaWalletAuthAction = 'login' | 'linkWallet' | 'none';

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

export const solanaLoginModalOptions: LoginModalOptions = {
  loginMethods: ['wallet'],
  walletChainType: 'solana-only'
};

export const solanaConnectWalletOptions: ConnectWalletModalOptions = {
  walletChainType: 'solana-only',
  walletList: solanaWalletList,
  description: 'OKX kullanıyorsan OKX içinde Solana hesabını seçerek bağlan.'
};

export function chooseSolanaWalletAuthAction({
  authenticated,
  solanaWalletCount
}: {
  authenticated: boolean;
  solanaWalletCount: number;
}): SolanaWalletAuthAction {
  if (!authenticated) return 'login';
  return solanaWalletCount > 0 ? 'none' : 'linkWallet';
}

export type StickySolanaWalletInput<TWallet extends { address: string }> = {
  authenticated: boolean;
  wallets: TWallet[];
  walletsReady: boolean;
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

  const liveWallet = previousAddress
    ? (wallets.find((wallet) => wallet.address === previousAddress) ?? wallets[0] ?? null)
    : (wallets[0] ?? null);

  if (liveWallet) {
    return {
      wallet: liveWallet,
      address: liveWallet.address,
      hasSolanaWallet: true,
      resolving: false,
      nextStickyAddress: liveWallet.address
    };
  }

  if (previousAddress) {
    return {
      wallet: null,
      address: previousAddress,
      hasSolanaWallet: true,
      resolving: true,
      nextStickyAddress: previousAddress
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

export function buildSolanaAuthError(step: SolanaAuthErrorStep, error: unknown): SolanaAuthError {
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
    return {
      step,
      title: 'Privy cüzdan modalı kapatıldı',
      message: 'Cüzdan seçimi tamamlanmadı. Tekrar denediğinde Solana cüzdanını seçip bağlantı isteğini onayla.',
      detail
    };
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
