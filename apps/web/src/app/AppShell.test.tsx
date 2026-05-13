import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedHeaderControls, authNoticeCopy, headerCashDisplayValue, marketCategories, shortWalletAddress } from './AppShell';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

vi.mock('@/lib/components/deposit/DepositButton', async () => {
  const { useEffect, useState } = await import('react');

  return {
    default: function MockDepositButton({
      openRequest,
      renderTrigger
    }: {
      openRequest?: number;
      renderTrigger?: (open: () => void, label: string) => ReactNode;
    }) {
      const [open, setOpen] = useState(false);

      useEffect(() => {
        if (openRequest) setOpen(true);
      }, [openRequest]);

      return (
        <>
          {renderTrigger ? renderTrigger(() => setOpen(true), 'Deposit') : null}
          {open ? <div role="dialog" aria-label="Deposit">Deposit modal</div> : null}
        </>
      );
    }
  };
});

vi.mock('@/lib/components/withdraw/WithdrawButton', async () => {
  const { useEffect, useState } = await import('react');

  return {
    default: function MockWithdrawButton({
      openRequest,
      renderTrigger
    }: {
      openRequest?: number;
      renderTrigger?: (open: () => void, label: string) => ReactNode;
    }) {
      const [open, setOpen] = useState(false);

      useEffect(() => {
        if (openRequest) setOpen(true);
      }, [openRequest]);

      return (
        <>
          {renderTrigger ? renderTrigger(() => setOpen(true), 'Withdraw') : null}
          {open ? <div role="dialog" aria-label="Withdraw">Withdraw modal</div> : null}
        </>
      );
    }
  };
});

describe('AppShell header cash and deposit controls', () => {
  it('points the Crypto nav item at the crypto market category', () => {
    expect(marketCategories.find((category) => category.label === 'Crypto')).toMatchObject({
      href: '/markets?category=crypto'
    });
  });

  it('uses Privy and Solana wallet copy for login notices', () => {
    const notice = authNoticeCopy(null, 'opening');

    expect(notice.title).toBe('Giriş ve cüzdan bağlantısı');
    expect(notice.message).toContain('Privy modalı');
    expect(notice.message).toContain('Google');
    expect(notice.message).toContain('Solana cüzdanını ayrıca bağlayabilirsin');
    expect(notice.message).not.toContain('Phantom');
  });

  it('separates missing wallet, API offline, pending, and ready cash states', () => {
    expect(
      headerCashDisplayValue({
        isAuthenticated: true,
        walletAddress: null,
        cashQuery: { isFetching: false, isLoading: false }
      })
    ).toBe('Connect wallet');

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

  it('renders compact BUSDC balance, mint control, and the wallet menu in authenticated header controls', () => {
    const html = renderToStaticMarkup(
      <AuthenticatedHeaderControls
        compact
        cashValue="0 BUSDC"
        walletAddress={SOLANA_DEVNET_PUBKEY}
        onSwitchWallet={() => undefined}
        mintNode={<button type="button" aria-label="Mint BUSDC">Mint BUSDC</button>}
      />
    );

    expect(html).toContain('BUSDC');
    expect(html).toContain('0 BUSDC');
    expect(html).toContain('aria-label="BUSDC balance"');
    expect(html).toContain('aria-label="Mint BUSDC"');
    expect(html).toContain('data-testid="cash-wallet-icon"');
    expect(html).toContain('aria-label="Active wallet"');
    expect(html).not.toContain('aria-label="Switch wallet"');
    expect(html).not.toContain('aria-label="Profile"');
  });

  it('renders the full active wallet dropdown on the right for desktop headers', () => {
    const html = renderToStaticMarkup(
      <AuthenticatedHeaderControls
        cashValue="0 BUSDC"
        walletAddress={SOLANA_DEVNET_PUBKEY}
        onSwitchWallet={() => undefined}
        onLogout={() => undefined}
        mintNode={<button type="button" aria-label="Mint BUSDC">Mint BUSDC</button>}
      />
    );

    expect(html).toContain('aria-label="Active wallet"');
    expect(html).toContain(shortWalletAddress(SOLANA_DEVNET_PUBKEY));
    expect(html).not.toContain('aria-label="Switch wallet"');
  });

  it('opens the requested wallet action modal from the wallet menu', async () => {
    const depositRender = await renderInteractiveHeaderControls();

    await openWalletMenuAction(depositRender.container, 'Deposit');

    expect(depositRender.container.querySelector('[role="menu"]')).toBeNull();
    expect(depositRender.container.querySelector('[role="dialog"][aria-label="Deposit"]')).not.toBeNull();
    expect(depositRender.container.querySelector('[role="dialog"][aria-label="Withdraw"]')).toBeNull();
    await depositRender.cleanup();

    const withdrawRender = await renderInteractiveHeaderControls();

    await openWalletMenuAction(withdrawRender.container, 'Withdraw');

    expect(withdrawRender.container.querySelector('[role="menu"]')).toBeNull();
    expect(withdrawRender.container.querySelector('[role="dialog"][aria-label="Withdraw"]')).not.toBeNull();
    expect(withdrawRender.container.querySelector('[role="dialog"][aria-label="Deposit"]')).toBeNull();
    await withdrawRender.cleanup();
  });

  it('uses a single connect-wallet control when an authenticated user has no wallet address', () => {
    const html = renderToStaticMarkup(
      <AuthenticatedHeaderControls
        cashValue="Connect wallet"
        walletAddress={null}
        onLogin={() => undefined}
        mintNode={<button type="button" aria-label="Mint BUSDC">Mint BUSDC</button>}
      />
    );

    expect(html).toContain('aria-label="Connect wallet"');
    expect(html).toContain('Connect wallet');
    expect(html).not.toContain('Wallet bağlanıyor');
    expect(html).not.toContain('aria-label="Login"');
    expect(html).not.toContain('Sign up');
    expect(html).not.toContain('aria-label="Switch wallet"');
  });
});

async function renderInteractiveHeaderControls() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <AuthenticatedHeaderControls
        cashValue="0 BUSDC"
        walletAddress={SOLANA_DEVNET_PUBKEY}
        onSwitchWallet={() => undefined}
        onLogout={() => undefined}
        mintNode={<button type="button" aria-label="Mint BUSDC">Mint BUSDC</button>}
      />
    );
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  };
}

async function openWalletMenuAction(container: HTMLElement, label: 'Deposit' | 'Withdraw') {
  const walletButton = container.querySelector('button[aria-label="Active wallet"]');
  expect(walletButton).not.toBeNull();

  await act(async () => {
    walletButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const actionButton = Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === label);
  expect(actionButton).not.toBeUndefined();

  await act(async () => {
    actionButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
