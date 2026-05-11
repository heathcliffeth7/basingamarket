import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendTargetUrl, DELETE, GET, POST } from './[...path]/route';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('backend API proxy route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds backend target URLs with query strings', () => {
    vi.stubEnv('API_INTERNAL_BASE_URL', 'http://api.internal/');

    expect(
      backendTargetUrl(
        'http://localhost:5173/api/backend/profiles/wallet/sol-deposit-quote?cash_amount=1000000',
        ['profiles', 'wallet', 'sol-deposit-quote']
      )
    ).toBe('http://api.internal/profiles/wallet/sol-deposit-quote?cash_amount=1000000');
  });

  it('forwards GET requests to the internal backend', async () => {
    vi.stubEnv('API_INTERNAL_BASE_URL', 'http://api.internal');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);

    const response = await GET(
      new Request('http://localhost:5173/api/backend/deposit/config'),
      { params: Promise.resolve({ path: ['deposit', 'config'] }) }
    );

    await expect(response.json()).resolves.toEqual({ status: 'ready' });
    expect(fetch).toHaveBeenCalledWith(
      'http://api.internal/deposit/config',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        body: undefined
      })
    );
  });

  it('forwards POST request bodies and auth headers', async () => {
    vi.stubEnv('API_INTERNAL_BASE_URL', 'http://api.internal');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'credited' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);

    await POST(
      new Request(`http://localhost:5173/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/sol-deposits`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ quote_id: 'quote-1', signature: 'sig' })
      }),
      { params: { path: ['profiles', SOLANA_DEVNET_PUBKEY, 'sol-deposits'] } }
    );

    const [, init] = fetch.mock.calls[0];
    expect(fetch).toHaveBeenCalledWith(
      `http://api.internal/profiles/${SOLANA_DEVNET_PUBKEY}/sol-deposits`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(init.headers.get('authorization')).toBe('Bearer token');
    expect(init.headers.get('content-type')).toBe('application/json');
    await expect(new Response(init.body).json()).resolves.toEqual({ quote_id: 'quote-1', signature: 'sig' });
  });

  it('forwards DELETE request bodies and auth headers', async () => {
    vi.stubEnv('API_INTERNAL_BASE_URL', 'http://api.internal');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'cancelled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);

    await DELETE(
      new Request('http://localhost:5173/api/backend/rounds/5928370/bids/7bc99ff9-6982-4ed7-8bf3-ac2c2d229182', {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ buyer_wallet: SOLANA_DEVNET_PUBKEY })
      }),
      { params: { path: ['rounds', '5928370', 'bids', '7bc99ff9-6982-4ed7-8bf3-ac2c2d229182'] } }
    );

    const [, init] = fetch.mock.calls[0];
    expect(fetch).toHaveBeenCalledWith(
      'http://api.internal/rounds/5928370/bids/7bc99ff9-6982-4ed7-8bf3-ac2c2d229182',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(init.headers.get('authorization')).toBe('Bearer token');
    expect(init.headers.get('content-type')).toBe('application/json');
    await expect(new Response(init.body).json()).resolves.toEqual({ buyer_wallet: SOLANA_DEVNET_PUBKEY });
  });

  it('returns a 502 JSON error when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await GET(
      new Request('http://localhost:5173/api/backend/deposit/config'),
      { params: { path: ['deposit', 'config'] } }
    );

    await expect(response.json()).resolves.toEqual({ error: 'backend_unavailable' });
    expect(response.status).toBe(502);
  });
});
