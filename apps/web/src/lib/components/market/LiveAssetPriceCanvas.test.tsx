import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LiveAssetPriceCanvas, {
  appendPricePoint,
  buildPriceDomain,
  downsamplePricePoints,
  expandDomainForPrice
} from './LiveAssetPriceCanvas';

describe('LiveAssetPriceCanvas helpers', () => {
  it('caps the ring buffer at 1200 points', () => {
    const points = Array.from({ length: 1200 }, (_, index) => ({
      ts: index,
      price: `${100_000_000 + index}`
    }));
    const next = appendPricePoint(points, { ts: 1200, price: '100001200' });

    expect(next).toHaveLength(1200);
    expect(next[0].ts).toBe(1);
    expect(next.at(-1)).toEqual({ ts: 1200, price: '100001200' });
  });

  it('ignores same or older timestamps', () => {
    const points = [{ ts: 100, price: '100000000' }];

    expect(appendPricePoint(points, { ts: 100, price: '101000000' })).toBe(points);
    expect(appendPricePoint(points, { ts: 99.5, price: '101000000' })).toBe(points);
  });

  it('downsamples by rendered width', () => {
    const points = Array.from({ length: 900 }, (_, index) => ({
      ts: index,
      price: `${100_000_000 + index}`
    }));
    const sampled = downsamplePricePoints(points, 240);

    expect(sampled.length).toBeLessThanOrEqual(240);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
  });

  it('expands the price domain only when the live price leaves it', () => {
    const domain = buildPriceDomain([
      { ts: 1, price: '100000000' },
      { ts: 2, price: '110000000' }
    ], '100000000');

    expect(expandDomainForPrice(domain, '105000000')).toBe(domain);
    expect(expandDomainForPrice(domain, '130000000')).not.toBe(domain);
  });

  it('renders a live canvas surface for SSR/unit tests', () => {
    const html = renderToStaticMarkup(
      <LiveAssetPriceCanvas
        symbol="BTCUSDT"
        startAt={1_778_414_400}
        endAt={1_778_414_700}
        openPrice="80900000000"
        points={[{ ts: 1_778_414_400, price: '80900000000' }]}
      />
    );

    expect(html).toContain('data-testid="asset-price-canvas"');
  });
});
