import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ExternalWalletSelector from './ExternalWalletSelector';
import type { ExternalWalletOption } from '@/lib/wallet/ExternalWalletContext';

describe('ExternalWalletSelector', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps not-detected wallets visible, disabled, and icon-backed', async () => {
    const onConnect = vi.fn();
    await renderSelector([
      walletOption('Backpack', false, '/wallet-icons/backpack.png'),
      walletOption('Solflare', true, '/wallet-icons/solflare.svg')
    ], onConnect);

    const backpackButton = buttonByText('Backpack');
    expect(backpackButton.disabled).toBe(true);
    expect(backpackButton.textContent).toContain('Not detected');
    expect(backpackButton.querySelector('img')?.getAttribute('src')).toBe('/wallet-icons/backpack.png');

    backpackButton.click();
    expect(onConnect).not.toHaveBeenCalled();
    expect(buttonByText('Solflare').disabled).toBe(false);
  });

  it('renders WalletConnect QR state with an open wallet link', async () => {
    const onConnect = vi.fn();
    const onClearWalletConnectQr = vi.fn();
    await renderSelector(
      [walletOption('WalletConnect QR', true, 'data:image/svg+xml,wc', { kind: 'walletconnect' })],
      onConnect,
      {
        connecting: true,
        connectingWalletName: 'WalletConnect QR',
        walletConnectQrUri: 'data:image/png;base64,wc',
        walletConnectDeepLink: 'wc:test-uri',
        onClearWalletConnectQr
      }
    );

    expect(container.querySelector('img[alt="WalletConnect QR"]')?.getAttribute('src')).toBe('data:image/png;base64,wc');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('wc:test-uri');
    buttonByText('Cancel QR').click();
    expect(onClearWalletConnectQr).toHaveBeenCalledTimes(1);
  });

  it('uses disabledReason for disabled WalletConnect options', async () => {
    const onConnect = vi.fn();
    await renderSelector([
      walletOption('WalletConnect QR', false, 'data:image/svg+xml,wc', {
        kind: 'walletconnect',
        disabledReason: 'WalletConnect QR is not configured'
      })
    ], onConnect);

    const button = buttonByText('WalletConnect QR');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('WalletConnect QR is not configured');
    button.click();
    expect(onConnect).not.toHaveBeenCalled();
  });

  async function renderSelector(
    wallets: ExternalWalletOption[],
    onConnect: (walletName: string) => void,
    options: {
      connecting?: boolean;
      connectingWalletName?: string | null;
      walletConnectQrUri?: string | null;
      walletConnectDeepLink?: string | null;
      onClearWalletConnectQr?: () => void;
    } = {}
  ) {
    await act(async () => {
      root.render(
        <ExternalWalletSelector
          mode="deposit"
          wallets={wallets}
          connecting={options.connecting ?? false}
          connectingWalletName={options.connectingWalletName ?? null}
          walletConnectQrUri={options.walletConnectQrUri}
          walletConnectDeepLink={options.walletConnectDeepLink}
          onClearWalletConnectQr={options.onClearWalletConnectQr}
          onConnect={onConnect}
        />
      );
    });
  }

  function buttonByText(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(label)
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    return button as HTMLButtonElement;
  }
});

function walletOption(
  name: string,
  installed: boolean,
  icon: string,
  options: Pick<ExternalWalletOption, 'kind' | 'disabledReason'> = {}
): ExternalWalletOption {
  return {
    name,
    accent: '#14f195',
    icon,
    installed,
    providerKey: name.toLowerCase(),
    source: 'fallback',
    ...options
  };
}
