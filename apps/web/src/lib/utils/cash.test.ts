import { describe, expect, it } from 'vitest';
import { cashDisplayValue } from './cash';

describe('cash display helpers', () => {
  it('formats ready zero cash as BUSDC', () => {
    expect(
      cashDisplayValue({
        isFetching: false,
        isLoading: false,
        data: {
          wallet_address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          currency: 'BUSDC',
          decimals: 6,
          cash_balance: '0',
          status: 'ready'
        }
      })
    ).toBe('0 BUSDC');
  });

  it('keeps projection pending only for pending cash projections', () => {
    expect(
      cashDisplayValue({
        isFetching: false,
        isLoading: false,
        data: {
          wallet_address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          currency: 'BUSDC',
          decimals: 6,
          cash_balance: null,
          status: 'projection_pending'
        }
      })
    ).toBe('projection pending');
  });

  it('shows API offline when the cash projection request fails', () => {
    expect(
      cashDisplayValue({
        isFetching: false,
        isLoading: false,
        isError: true
      })
    ).toBe('API offline');
  });
});
