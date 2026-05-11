import { describe, expect, it } from 'vitest';
import { apiBaseUrl, assertMockFallbackAllowed, assertSolanaDevnetAllowed, resolveApiBaseUrl } from './env';

describe('env guard', () => {
  it('fails production builds when mock fallback is enabled', () => {
    expect(() => assertMockFallbackAllowed(true, true)).toThrow(
      'NEXT_PUBLIC_USE_MOCK_FALLBACK must be false in production'
    );
  });

  it('allows dev mock fallback', () => {
    expect(() => assertMockFallbackAllowed(false, true)).not.toThrow();
  });

  it('allows only Solana devnet as the public cluster', () => {
    expect(() => assertSolanaDevnetAllowed('devnet')).not.toThrow();
    expect(() => assertSolanaDevnetAllowed('mainnet-beta')).toThrow(
      'NEXT_PUBLIC_SOLANA_CLUSTER must be devnet'
    );
  });

  it('defaults browser API requests to the same-origin backend proxy', () => {
    expect(apiBaseUrl).toBe('/api/backend');
  });

  it('keeps dev browser requests on the same-origin backend proxy when localhost API env leaks in', () => {
    expect(resolveApiBaseUrl('http://127.0.0.1:8080', 'development')).toBe('/api/backend');
    expect(resolveApiBaseUrl('http://localhost:8080/', 'test')).toBe('/api/backend');
  });

  it('allows explicit non-localhost API bases and production builds', () => {
    expect(resolveApiBaseUrl('http://api.test', 'development')).toBe('http://api.test');
    expect(resolveApiBaseUrl('http://127.0.0.1:8080', 'production')).toBe('http://127.0.0.1:8080');
  });
});
