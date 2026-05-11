import { BookOpenText } from 'lucide-react';
import type { OrderBook, OrderBookAsk, OrderBookBid } from '@/lib/api/types';
import Badge from '@/lib/components/ui/Badge';
import { cn } from '@/lib/utils/cn';
import { formatTokenAmount, formatUsdPrice } from '@/lib/utils/amount';

type BookRow = {
  key: string;
  side: 'UP' | 'DOWN';
  bid: string;
  ask: string;
  askSelection: SelectedOrderBookAsk | null;
  size: string;
  totalUsd: string;
  sideClass: string;
};

export type SelectedOrderBookAsk = {
  side: 'UP' | 'DOWN';
  lot_id: string;
  price_per_ticket: string;
  ticket_amount: string;
  total_usdc: string;
};

export default function MarketOrderBook({
  orderBook,
  loading = false,
  compact = false,
  selectedAsk = null,
  onSelectAsk
}: {
  orderBook: OrderBook | null | undefined;
  loading?: boolean;
  compact?: boolean;
  selectedAsk?: SelectedOrderBookAsk | null;
  onSelectAsk?: (ask: SelectedOrderBookAsk) => void;
}) {
  const rows = buildLiveOrderBookRows(orderBook);
  const orderCount = orderBook?.sides.reduce((total, side) => total + side.bids.length + side.asks.length, 0) ?? 0;
  const badgeLabel = loading && !orderBook
    ? 'loading'
    : orderBook?.state === 'round_closed'
      ? 'round closed'
      : orderCount > 0
        ? `${orderCount} orders`
        : 'empty';

  return (
    <section className="overflow-hidden rounded-2xl border border-terminal-line bg-terminal-panel shadow-market" aria-label="Market order book" data-density={compact ? 'compact' : 'default'}>
      <div className={cn('flex flex-wrap items-center justify-between border-b border-terminal-line bg-terminal-panel-strong/70', compact ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3')}>
        <div className="inline-flex items-center gap-2">
          <span className={cn('inline-flex items-center justify-center rounded-full border border-market-positive/25 bg-market-positive/10 text-market-positive', compact ? 'h-7 w-7' : 'h-9 w-9')}>
            <BookOpenText size={compact ? 14 : 17} />
          </span>
          <div>
            <h2 className={cn('font-black text-terminal-text', compact ? 'text-sm' : 'text-base')}>Order book</h2>
            <p className={cn('font-semibold text-terminal-muted', compact ? 'text-[11px]' : 'text-xs')}>Live bids and asks</p>
          </div>
        </div>
        <Badge className={compact ? 'px-2 py-0.5 text-[10px]' : undefined} tone={orderCount > 0 ? 'positive' : loading && !orderBook ? 'warning' : 'neutral'}>
          {badgeLabel}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse text-left', compact ? 'min-w-[420px] text-xs' : 'min-w-[720px] text-sm')}>
          <thead>
            <tr className="border-b border-terminal-line text-xs font-black uppercase text-terminal-muted">
              <th className={compact ? 'px-2 py-2 text-[10px]' : 'px-4 py-3'}>Side</th>
              <th className={compact ? 'px-2 py-2 text-[10px]' : 'px-4 py-3'}>Bid</th>
              <th className={compact ? 'px-2 py-2 text-[10px]' : 'px-4 py-3'}>Ask</th>
              <th className={compact ? 'px-2 py-2 text-[10px]' : 'px-4 py-3'}>Size</th>
              <th className={compact ? 'px-2 py-2 text-right text-[10px]' : 'px-4 py-3 text-right'}>Total BUSDC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const askSelected = Boolean(selectedAsk && row.askSelection?.lot_id === selectedAsk.lot_id);
              return (
                <tr
                  key={row.key}
                  className={cn(
                    'border-b border-terminal-line/70 bg-terminal-panel transition hover:bg-terminal-panel-strong/70',
                    askSelected && 'bg-market-warning/10'
                  )}
                  data-selected={askSelected ? 'true' : undefined}
                >
                  <td className={compact ? 'px-2 py-1.5' : 'px-4 py-3'}>
                    <span className={cn('inline-flex rounded-full border font-black', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs', row.sideClass)}>
                      {row.side}
                    </span>
                  </td>
                  <td className={cn('whitespace-nowrap font-mono font-black text-market-positive', compact ? 'px-2 py-1.5' : 'px-4 py-3')}>{row.bid}</td>
                  <td className={cn('whitespace-nowrap', compact ? 'px-2 py-1.5' : 'px-4 py-3')}>
                    {row.askSelection && onSelectAsk ? (
                      <button
                        aria-label={`Select ${row.side} ask at ${row.ask}`}
                        aria-pressed={askSelected}
                        className={cn(
                          'inline-flex rounded-md border px-1.5 py-0.5 font-mono font-black text-market-warning transition hover:border-market-warning hover:bg-market-warning/10',
                          askSelected ? 'border-market-warning bg-market-warning/15' : 'border-transparent'
                        )}
                        data-testid={`orderbook-ask-${row.askSelection.lot_id}`}
                        type="button"
                        onClick={() => onSelectAsk(row.askSelection!)}
                      >
                        {row.ask}
                      </button>
                    ) : (
                      <span className="font-mono font-black text-market-warning">{row.ask}</span>
                    )}
                  </td>
                  <td className={cn('whitespace-nowrap font-mono text-terminal-text', compact ? 'px-2 py-1.5' : 'px-4 py-3')}>{row.size}</td>
                  <td className={cn('whitespace-nowrap text-right font-mono font-black text-terminal-text', compact ? 'px-2 py-1.5' : 'px-4 py-3')}>{row.totalUsd}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <div className={cn('border-t border-terminal-line bg-terminal-bg font-semibold text-terminal-muted', compact ? 'px-3 py-4 text-xs' : 'px-4 py-6 text-sm')}>
          {loading && !orderBook ? 'Loading live order book...' : 'No live bids or asks.'}
        </div>
      ) : null}
    </section>
  );
}

export function buildLiveOrderBookRows(orderBook: OrderBook | null | undefined): BookRow[] {
  if (!orderBook || orderBook.state !== 'live') return [];

  return orderBook.sides.flatMap((side) => {
    const depth = Math.max(side.bids.length, side.asks.length);
    return Array.from({ length: depth }, (_, index) => {
      const bid = side.bids[index] ?? null;
      const ask = side.asks[index] ?? null;
      return {
        key: `${side.side}-${index}-${bid?.bid_id ?? 'no-bid'}-${ask?.lot_id ?? 'no-ask'}`,
        side: side.side,
        bid: bid ? formatUsdPrice(bid.price_per_ticket) : '-',
        ask: ask ? formatUsdPrice(ask.price_per_ticket) : '-',
        askSelection: ask ? { side: side.side, ...ask } : null,
        size: sizeLabel(bid, ask, side.side),
        totalUsd: totalLabel(bid, ask),
        sideClass: side.side === 'UP'
          ? 'border-market-positive/35 bg-market-positive/10 text-market-positive'
          : 'border-market-negative/35 bg-market-negative/10 text-market-negative'
      };
    });
  });
}

function sizeLabel(bid: OrderBookBid | null, ask: OrderBookAsk | null, side: 'UP' | 'DOWN') {
  const parts = [];
  if (bid) parts.push(`${formatTokenAmount(bid.available_tickets)} bid`);
  if (ask) parts.push(`${formatTokenAmount(ask.ticket_amount)} ask`);
  return parts.length ? `${parts.join(' / ')} ${side}` : '-';
}

function totalLabel(bid: OrderBookBid | null, ask: OrderBookAsk | null) {
  const parts = [];
  if (bid) parts.push(formatUsdPrice(bid.total_usdc));
  if (ask) parts.push(formatUsdPrice(ask.total_usdc));
  return parts.length ? parts.join(' / ') : '-';
}
