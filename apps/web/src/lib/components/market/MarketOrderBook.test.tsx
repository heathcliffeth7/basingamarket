import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mockOrderBooks } from '@/lib/api/mock';
import MarketOrderBook, { buildLiveOrderBookRows, type SelectedOrderBookAsk } from './MarketOrderBook';

const selectedAsk: SelectedOrderBookAsk = {
  side: 'UP',
  lot_id: '2',
  price_per_ticket: '145000000',
  ticket_amount: '110000000',
  total_usdc: '15950000000'
};

describe('MarketOrderBook', () => {
  it('builds rows from active bids and listed asks', () => {
    const rows = buildLiveOrderBookRows(mockOrderBooks['1']);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      side: 'UP',
      bid: '$0.72',
      ask: '$145.00'
    });
    expect(rows[0].size).toContain('bid');
    expect(rows[0].size).toContain('ask');
  });

  it('renders live book copy and no fresh mint depth language', () => {
    const html = renderToStaticMarkup(<MarketOrderBook orderBook={mockOrderBooks['1']} />);

    expect(html).toContain('aria-label="Market order book"');
    expect(html).toContain('Order book');
    expect(html).toContain('Live bids and asks');
    expect(html).toContain('Total BUSDC');
    expect(html).toContain('$0.72');
    expect(html).not.toContain('Fresh mint depth');
  });

  it('renders compact density when requested', () => {
    const html = renderToStaticMarkup(<MarketOrderBook orderBook={mockOrderBooks['1']} compact />);

    expect(html).toContain('data-density="compact"');
    expect(html).toContain('Bid');
    expect(html).toContain('Ask');
  });

  it('renders listed asks as selectable controls when a handler is provided', () => {
    const html = renderToStaticMarkup(
      <MarketOrderBook orderBook={mockOrderBooks['1']} onSelectAsk={() => undefined} />
    );

    expect(html).toContain('data-testid="orderbook-ask-2"');
    expect(html).toContain('aria-label="Select UP ask at $145.00"');
    expect(html).not.toContain('orderbook-bid');
  });

  it('marks the selected ask without making bids selectable', () => {
    const html = renderToStaticMarkup(
      <MarketOrderBook
        orderBook={mockOrderBooks['1']}
        selectedAsk={selectedAsk}
        onSelectAsk={() => undefined}
      />
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).not.toContain('data-testid="orderbook-bid');
  });

  it('renders empty state when no live orders exist', () => {
    const html = renderToStaticMarkup(<MarketOrderBook orderBook={null} />);

    expect(html).toContain('No live bids or asks');
    expect(html).toContain('empty');
  });

  it('renders a loading shell before live orderbook data arrives', () => {
    const html = renderToStaticMarkup(<MarketOrderBook orderBook={null} loading />);

    expect(html).toContain('Order book');
    expect(html).toContain('loading');
    expect(html).toContain('Loading live order book');
    expect(html).not.toContain('round closed');
  });
});
