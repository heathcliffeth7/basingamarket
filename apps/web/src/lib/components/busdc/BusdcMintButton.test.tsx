import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import { busdcMintButtonState, busdcMintErrorMessage, busdcMintInvalidationKeys } from './BusdcMintButton';

describe('BusdcMintButton helpers', () => {
  it('shows the normal mint action while daily mints remain', () => {
    expect(
      busdcMintButtonState({
        remaining: 4,
        limit: 5,
        mintAmount: '50000000000'
      })
    ).toMatchObject({
      disabled: false,
      label: 'Mint BUSDC'
    });
  });

  it('disables the button when the daily limit is hit', () => {
    expect(
      busdcMintButtonState({
        remaining: 0,
        limit: 5,
        mintAmount: '50000000000'
      })
    ).toMatchObject({
      disabled: true,
      label: 'Limit hit',
      title: 'Daily BUSDC mint limit reached.'
    });
  });

  it('maps backend limit errors to the visible BUSDC limit message', () => {
    const error = new ApiClientError({
      status: 400,
      code: 'busdc_mint_limit_exceeded',
      path: '/profiles/wallet/busdc-mints'
    });

    expect(busdcMintErrorMessage(error)).toBe('Daily BUSDC mint limit reached.');
  });

  it('maps reserve backing errors to a devnet vault message', () => {
    const error = new ApiClientError({
      status: 503,
      code: 'busdc_mint_reserve_unavailable',
      path: '/profiles/wallet/busdc-mints'
    });

    expect(busdcMintErrorMessage(error)).toContain('BUSDC reserve is not ready');
  });

  it('invalidates cash balance and mint status after a successful mint', () => {
    expect(busdcMintInvalidationKeys('wallet')).toEqual([
      ['cash-balance', 'wallet'],
      ['busdc-mint-status', 'wallet']
    ]);
  });
});
