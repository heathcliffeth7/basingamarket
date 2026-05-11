import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthenticatedHeaderControls, authNoticeCopy, headerCashDisplayValue, marketCategories } from './AppShell';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('AppShell header cash and deposit controls', () => {
  it('points the Crypto nav item at the crypto market category', () => {
    expect(marketCategories.find((category) => category.label === 'Crypto')).toMatchObject({
      href: '/markets?category=crypto'
    });
  });

  it('uses Privy and Solana wallet copy for login notices', () => {
    const notice = authNoticeCopy(null, 'opening');

    expect(notice.title).toBe('Solana cüzdanı ile giriş');
    expect(notice.message).toContain('Privy cüzdan modalı');
    expect(notice.message).toContain('OKX');
    expect(notice.message).not.toContain('Phantom');
  });

  it('separates wallet loading, API offline, pending, and ready cash states', () => {
    expect(
      headerCashDisplayValue({
        isAuthenticated: true,
        walletAddress: null,
        cashQuery: { isFetching: false, isLoading: false }
      })
    ).toBe('Wallet bağlanıyor');

    expect(
      headerCashDisplayValue({
        isAuthenticated: true,
        walletAddress: SOLANA_DEVNET_PUBKEY,
        cashQuery: { isFetching: false, isLoading: false, isError: true }
      })
    ).toBe('API offline');

    expect(
      headerCashDisplayValue({
        isAuthenticated: true,
        walletAddress: SOLANA_DEVNET_PUBKEY,
        cashQuery: {
          isFetching: false,
          isLoading: false,
          data: {
            wallet_address: SOLANA_DEVNET_PUBKEY,
            currency: 'BUSDC',
            decimals: 6,
            cash_balance: null,
            status: 'projection_pending'
          }
        }
      })
    ).toBe('projection pending');

    expect(
      headerCashDisplayValue({
        isAuthenticated: true,
        walletAddress: SOLANA_DEVNET_PUBKEY,
        cashQuery: {
          isFetching: false,
          isLoading: false,
          data: {
            wallet_address: SOLANA_DEVNET_PUBKEY,
            currency: 'BUSDC',
            decimals: 6,
            cash_balance: '0',
            status: 'ready'
          }
        }
      })
    ).toBe('0 BUSDC');
  });

  it('renders compact BUSDC balance, mint/deposit/withdraw controls, and profile entry in authenticated header controls', () => {
    const html = renderToStaticMarkup(
      <AuthenticatedHeaderControls
        compact
        cashValue="0 BUSDC"
        walletAddress={SOLANA_DEVNET_PUBKEY}
        profileHref={`/profiles/${SOLANA_DEVNET_PUBKEY}`}
        mintNode={<button type="button" aria-label="Mint BUSDC">Mint BUSDC</button>}
        depositNode={<button type="button" aria-label="Deposit">Deposit</button>}
        withdrawNode={<button type="button" aria-label="Withdraw">Withdraw</button>}
      />
    );

    expect(html).toContain('BUSDC');
    expect(html).toContain('0 BUSDC');
    expect(html).toContain('aria-label="BUSDC balance"');
    expect(html).toContain('aria-label="Mint BUSDC"');
    expect(html).toContain('aria-label="Deposit"');
    expect(html).toContain('aria-label="Withdraw"');
    expect(html).toContain('data-testid="cash-wallet-icon"');
    expect(html).toContain('aria-label="Profile"');
  });
});
