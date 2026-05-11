import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import {
  withdrawButtonLabel,
  withdrawErrorMessage,
  withdrawSetupMessage
} from './WithdrawButton';

describe('WithdrawButton helpers', () => {
  it('maps withdraw config state to button labels', () => {
    expect(withdrawButtonLabel(undefined, true)).toBe('Withdraw');
    expect(withdrawButtonLabel('ready', false)).toBe('Withdraw');
    expect(withdrawButtonLabel('setup_pending', false)).toBe('Setup pending');
    expect(withdrawButtonLabel(undefined, false, true)).toBe('API offline');
  });

  it('explains setup pending reasons', () => {
    expect(withdrawSetupMessage('withdraw_disabled')).toContain('SOLANA_WITHDRAW_ENABLED');
    expect(withdrawSetupMessage('vault_owner_mismatch')).toContain('keypair');
    expect(withdrawSetupMessage('vault_keypair_missing')).toContain('okunamadi');
  });

  it('maps backend withdraw errors to Turkish messages', () => {
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_insufficient_cash',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('yetersiz');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_quote_expired',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('suresi doldu');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_wrong_signer',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('Solana wallet');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_invalid_destination',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('gecersiz');
    expect(withdrawErrorMessage(new ApiClientError({
      status: 400,
      code: 'withdraw_destination_token_account',
      path: '/profiles/wallet/withdrawals'
    }))).toContain('token account');
  });

});
