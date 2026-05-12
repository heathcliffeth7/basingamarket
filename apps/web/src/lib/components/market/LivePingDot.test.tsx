import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LivePingDot from './LivePingDot';

describe('LivePingDot', () => {
  it('keeps the ping animation and maps tones to market colors', () => {
    const up = renderToStaticMarkup(<LivePingDot tone="up" />);
    const down = renderToStaticMarkup(<LivePingDot tone="down" />);
    const neutral = renderToStaticMarkup(<LivePingDot tone="neutral" />);

    expect(up).toContain('animate-ping');
    expect(up).toContain('data-tone="up"');
    expect(up).toContain('bg-market-success');
    expect(down).toContain('data-tone="down"');
    expect(down).toContain('bg-market-negative');
    expect(neutral).toContain('data-tone="neutral"');
    expect(neutral).toContain('bg-market-warning');
  });
});
