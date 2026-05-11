import type { CashBalance } from '@/lib/api/types';
import { formatTokenAmount } from './amount';

type CashQueryLike = {
  data?: CashBalance;
  isError?: boolean;
  isFetching: boolean;
  isLoading: boolean;
};

export function cashDisplayValue(cashQuery: CashQueryLike) {
  if (cashQuery.isLoading || cashQuery.isFetching) return 'loading';
  if (cashQuery.isError) return 'API offline';
  const data = cashQuery.data;
  if (!data || data.status !== 'ready' || data.cash_balance === null || data.cash_balance === undefined) {
    return 'projection pending';
  }
  return `${formatTokenAmount(data.cash_balance)} BUSDC`;
}
