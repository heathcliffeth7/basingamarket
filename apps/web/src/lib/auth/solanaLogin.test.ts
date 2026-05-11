import { describe, expect, it } from 'vitest';
import {
  buildSolanaAuthError,
  chooseSolanaWalletAuthAction,
  getPrivyAppIdFingerprint,
  resolveStickySolanaWallet,
  solanaConnectWalletOptions,
  solanaLoginModalOptions,
  solanaWalletList,
  solanaWalletConnectorOptions
} from './solanaLogin';

describe('solana auth helpers', () => {
  it('disables automatic Solana wallet reconnect attempts', () => {
    expect(solanaWalletConnectorOptions).toEqual({ shouldAutoConnect: false });
  });

  it('opens the Privy login modal in Solana wallet-only mode', () => {
    expect(solanaLoginModalOptions).toEqual({
      loginMethods: ['wallet'],
      walletChainType: 'solana-only'
    });
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

  it('chooses login, link-wallet, or no-op from auth and Solana wallet state', () => {
    expect(chooseSolanaWalletAuthAction({ authenticated: false, solanaWalletCount: 0 })).toBe('login');
    expect(chooseSolanaWalletAuthAction({ authenticated: true, solanaWalletCount: 0 })).toBe('linkWallet');
    expect(chooseSolanaWalletAuthAction({ authenticated: true, solanaWalletCount: 1 })).toBe('none');
  });

  it('selects and sticks to the current Solana wallet address', () => {
    const wallet = { address: 'So11111111111111111111111111111111111111112' };

    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [wallet],
      walletsReady: true,
      previousAddress: null
    });

    expect(state.wallet).toBe(wallet);
    expect(state.address).toBe(wallet.address);
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBe(wallet.address);
  });

  it('keeps the previous Solana wallet address during transient empty wallet state', () => {
    const state = resolveStickySolanaWallet({
      authenticated: true,
      wallets: [],
      walletsReady: true,
      previousAddress: 'So11111111111111111111111111111111111111112'
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBe('So11111111111111111111111111111111111111112');
    expect(state.hasSolanaWallet).toBe(true);
    expect(state.resolving).toBe(true);
    expect(state.nextStickyAddress).toBe('So11111111111111111111111111111111111111112');
  });

  it('clears the sticky Solana wallet address when unauthenticated', () => {
    const state = resolveStickySolanaWallet({
      authenticated: false,
      wallets: [{ address: 'So11111111111111111111111111111111111111112' }],
      walletsReady: true,
      previousAddress: 'So11111111111111111111111111111111111111112'
    });

    expect(state.wallet).toBeNull();
    expect(state.address).toBeNull();
    expect(state.hasSolanaWallet).toBe(false);
    expect(state.resolving).toBe(false);
    expect(state.nextStickyAddress).toBeNull();
  });

  it('maps exited_auth_flow as a retryable Privy wallet modal close', () => {
    const error = buildSolanaAuthError('login', 'exited_auth_flow');

    expect(error.title).toBe('Privy cüzdan modalı kapatıldı');
    expect(error.message).toContain('Solana cüzdanını seçip');
    expect(error.detail).toBe('exited_auth_flow');
  });

  it.each([
    new Error('Login with solana wallet not allowed'),
    { privyErrorCode: 'disallowed_login_method', message: 'Wallet login is disabled' },
    { privyErrorCode: 'feature_not_enabled', message: 'Solana SIWS is disabled' }
  ])('maps Privy Solana readiness errors to the app id/dashboard message', (source) => {
    const error = buildSolanaAuthError('login', source);

    expect(error.title).toBe('Privy Solana girişi kapalı');
    expect(error.message).toContain('Yanlış Privy app id');
    expect(error.message).toContain('Solana wallet login kapalı');
  });

  it('maps invalid SIWS message/nonce to a retryable encoding or nonce message', () => {
    const error = buildSolanaAuthError('login', new Error('Invalid SIWS message and/or nonce'));

    expect(error.title).toBe('SIWS doğrulanamadı');
    expect(error.message).toBe('SIWS imza formatı/nonce doğrulanamadı. Sayfayı yenileyip tekrar deneyin.');
    expect(error.detail).toBe('Invalid SIWS message and/or nonce');
  });

  it('uses Solana-general copy for unexpected wallet modal errors', () => {
    const error = buildSolanaAuthError('login', new Error('Unexpected error'));

    expect(error.title).toBe('Solana cüzdan bağlantısı tamamlanamadı');
    expect(error.message).toContain('OKX');
    expect(error.detail).toBe('Unexpected error');
  });

  it('builds a safe public Privy app id fingerprint', () => {
    expect(getPrivyAppIdFingerprint('')).toBe('not configured');
    expect(getPrivyAppIdFingerprint('short-id')).toBe('short-id');
    expect(getPrivyAppIdFingerprint('  abcdefghijklmnopqrstuvwxyz  ')).toBe('abcd...wxyz');
  });
});
