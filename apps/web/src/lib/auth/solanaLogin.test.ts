import { describe, expect, it } from 'vitest';
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
  solanaWalletList,
  solanaWalletConnectorOptions
} from './solanaLogin';

const PHANTOM_WALLET = 'So11111111111111111111111111111111111111112';
const OKX_WALLET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('solana auth helpers', () => {
  it('disables automatic Solana wallet reconnect attempts', () => {
    expect(solanaWalletConnectorOptions).toEqual({ shouldAutoConnect: false });
  });

  it('opens the Privy login modal in Solana wallet-only mode', () => {
    expect(solanaLoginModalOptions).toEqual({
      walletChainType: 'solana-only'
    });
  });

  it('orders email first, Google second, then explicit Solana wallets', () => {
    expect(solanaLoginMethodsAndOrder.primary).toEqual([
      'email',
      'google',
      'phantom',
      'okx_wallet'
    ]);
    expect(solanaLoginMethodsAndOrder.overflow).toEqual([
      'solflare',
      'backpack',
      'jupiter',
      'wallet_connect_qr_solana'
    ]);
    expect([
      ...solanaLoginMethodsAndOrder.primary,
      ...(solanaLoginMethodsAndOrder.overflow ?? [])
    ]).not.toContain('detected_solana_wallets');
  });

  it('keeps Google login available without auto-creating embedded Solana wallets', () => {
    expect(solanaLoginMethodsAndOrder.primary).toContain('google');
    expect(solanaEmbeddedWalletCreateOnLogin).toBe('off');
  });

  it('includes OKX in the Solana wallet modal list', () => {
    expect(solanaWalletList).toEqual([
      'detected_solana_wallets',
      'phantom',
      'okx_wallet',
      'solflare',
      'backpack',
      'jupiter',
      'wallet_connect_qr_solana'
    ]);
  });

  it('opens the Solana link wallet modal with the same OKX-enabled wallet list', () => {
    expect(solanaConnectWalletOptions).toMatchObject({
      walletChainType: 'solana-only',
      walletList: solanaWalletList
    });
    expect(solanaConnectWalletOptions.description).toContain('OKX');
  });

  it('chooses login or link-wallet from auth state', () => {
    expect(chooseSolanaWalletAuthAction({ authenticated: false, solanaWalletCount: 0 })).toBe('login');
    expect(chooseSolanaWalletAuthAction({ authenticated: true, solanaWalletCount: 0 })).toBe('linkWallet');
    expect(chooseSolanaWalletAuthAction({ authenticated: true, solanaWalletCount: 1 })).toBe('linkWallet');
  });

  it('reads Solana wallet addresses from Privy wallet accounts only', () => {
    expect(solanaWalletAddressFromPrivyAccount({
      type: 'wallet',
      chainType: 'solana',
      address: OKX_WALLET
    })).toBe(OKX_WALLET);
    expect(solanaWalletAddressFromPrivyAccount({
      type: 'wallet',
      chainType: 'ethereum',
      address: OKX_WALLET
    })).toBeNull();
    expect(solanaWalletAddressFromPrivyAccount({
      type: 'email',
      address: OKX_WALLET
    })).toBeNull();
    expect(solanaWalletAddressFromPrivyAccount({
      type: 'wallet',
      chainType: 'solana',
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })).toBeNull();
  });

  it('selects and sticks to an explicit identity Solana wallet address', () => {
    const wallet = { address: PHANTOM_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [wallet],
      walletsReady: true,
      identityAddress: PHANTOM_WALLET,
      previousAddress: null
    });

    expect(state.wallet).toBe(wallet);
    expect(state.address).toBe(wallet.address);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBe(wallet.address);
  });

  it('does not promote a newly detected external wallet without an identity address', () => {
    const wallet = { address: PHANTOM_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [wallet],
      walletsReady: true,
      previousAddress: null
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBeNull();
    expect(state.hasSolanaWallet).toBe(false);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBeNull();
  });

  it('keeps the identity wallet when a different external wallet connects', () => {
    const externalWallet = { address: PHANTOM_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [externalWallet],
      walletsReady: true,
      identityAddress: OKX_WALLET,
      previousAddress: null
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBe(OKX_WALLET);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(true);
    expect(state.nextStickyAddress).toBe(OKX_WALLET);
  });

  it('keeps the previous Solana wallet address during transient empty wallet state', () => {
    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [],
      walletsReady: true,
      previousAddress: PHANTOM_WALLET
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBe(PHANTOM_WALLET);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(true);
    expect(state.nextStickyAddress).toBe(PHANTOM_WALLET);
  });

  it('prefers the current user identity address over an older sticky address', () => {
    const identityWallet = { address: OKX_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [identityWallet],
      walletsReady: true,
      identityAddress: OKX_WALLET,
      previousAddress: PHANTOM_WALLET
    });

    expect(state.wallet).toBe(identityWallet);
    expect(state.address).toBe(OKX_WALLET);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBe(OKX_WALLET);
  });

  it('prefers the latest confirmed Solana wallet over an older sticky address', () => {
    const phantomWallet = { address: PHANTOM_WALLET };
    const okxWallet = { address: OKX_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [phantomWallet, okxWallet],
      walletsReady: true,
      preferredAddress: OKX_WALLET,
      identityAddress: PHANTOM_WALLET,
      previousAddress: PHANTOM_WALLET
    });

    expect(state.wallet).toBe(okxWallet);
    expect(state.address).toBe(OKX_WALLET);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBe(OKX_WALLET);
  });

  it('keeps a preferred Solana address while its provider wallet is still resolving', () => {
    const phantomWallet = { address: PHANTOM_WALLET };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [phantomWallet],
      walletsReady: true,
      preferredAddress: OKX_WALLET,
      identityAddress: PHANTOM_WALLET,
      previousAddress: PHANTOM_WALLET
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBe(OKX_WALLET);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(true);
    expect(state.nextStickyAddress).toBe(OKX_WALLET);
  });

  it('clears the sticky Solana wallet address when unauthenticated', () => {
    const state = resolveStickySolanaWallet({
      authenticated: false,
      wallets: [{ address: PHANTOM_WALLET }],
      walletsReady: true,
      preferredAddress: OKX_WALLET,
      previousAddress: PHANTOM_WALLET
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBeNull();
    expect(state.hasSolanaWallet).toBe(false);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBeNull();
  });

  it('returns null for exited_auth_flow so the UI stays silent', () => {
    const error = buildSolanaAuthError('login', 'exited_auth_flow');
    expect(error).toBeNull();
  });

  it.each([
    new Error('Login with solana wallet not allowed'),
    { privyErrorCode: 'disallowed_login_method', message: 'Wallet login is disabled' },
    { privyErrorCode: 'feature_not_enabled', message: 'Solana SIWS is disabled' }
  ])('maps Privy Solana readiness errors to the app id/dashboard message', (source) => {
    const error = buildSolanaAuthError('login', source);

    expect(error).not.toBeNull();
    expect(error!.title).toBe('Privy Solana girişi kapalı');
    expect(error!.message).toContain('Yanlış Privy app id');
    expect(error!.message).toContain('Solana wallet login kapalı');
  });

  it('maps invalid SIWS message/nonce to a retryable encoding or nonce message', () => {
    const error = buildSolanaAuthError('login', new Error('Invalid SIWS message and/or nonce'));

    expect(error).not.toBeNull();
    expect(error!.title).toBe('SIWS doğrulanamadı');
    expect(error!.message).toBe('SIWS imza formatı/nonce doğrulanamadı. Sayfayı yenileyip tekrar deneyin.');
    expect(error!.detail).toBe('Invalid SIWS message and/or nonce');
  });

  it('uses Solana-general copy for unexpected wallet modal errors', () => {
    const error = buildSolanaAuthError('login', new Error('Unexpected error'));

    expect(error).not.toBeNull();
    expect(error!.title).toBe('Solana cüzdan bağlantısı tamamlanamadı');
    expect(error!.message).toContain('OKX');
    expect(error!.detail).toBe('Unexpected error');
  });

  it('builds a safe public Privy app id fingerprint', () => {
    expect(getPrivyAppIdFingerprint('')).toBe('not configured');
    expect(getPrivyAppIdFingerprint('short-id')).toBe('short-id');
    expect(getPrivyAppIdFingerprint('  abcdefghijklmnopqrstuvwxyz  ')).toBe('abcd...wxyz');
  });
});
