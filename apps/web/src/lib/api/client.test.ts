import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api, isTransientDevnetRoundError, normalizeBuyIntentError } from './client';

const SOLANA_DEVNET_PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses mock fallback when the dev API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline'))
    );

    await expect(api.getMarkets()).resolves.toHaveLength(6);
  });

  it('does not mock cash or deposit setup when the live API is unavailable', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getCashBalance(SOLANA_DEVNET_PUBKEY)).rejects.toThrow('offline');
    await expect(liveApi.getDepositConfig()).rejects.toThrow('offline');
    await expect(liveApi.verifyDeposit(SOLANA_DEVNET_PUBKEY, 'devnet-signature')).rejects.toThrow('offline');
    await expect(liveApi.getSolDepositQuote(SOLANA_DEVNET_PUBKEY, '1000000')).rejects.toThrow('offline');
    await expect(liveApi.verifySolDeposit(SOLANA_DEVNET_PUBKEY, 'quote-1', 'devnet-signature')).rejects.toThrow('offline');
  });

  it('sends bearer tokens for protected mutations', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticket_id: '7',
        status: 'listed',
        signature: 'devnet-signature',
        explorer_url: 'https://explorer.solana.com/tx/devnet-signature?cluster=devnet',
        price_per_ticket: '500000'
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await liveApi.listTicket({
      ticketId: '7',
      sellerWallet: SOLANA_DEVNET_PUBKEY,
      pricePerTicket: '500000',
      marketId: '1',
      roundId: '5928355',
      accessToken: 'privy-access-token'
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/tickets/7/list',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer privy-access-token'
        })
      })
    );
  });

  it('fetches the live orderbook endpoint', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        market_id: '1',
        round_id: '5928355',
        updated_at: '2026-05-11T00:00:00Z',
        state: 'live',
        sides: [
          {
            side: 'UP',
            best_bid_price: '700000',
            best_ask_price: '800000',
            bids: [{ bid_id: 'bid-1', price_per_ticket: '700000', remaining_usdc: '1400000', available_tickets: '2000000', total_usdc: '1400000' }],
            asks: [{ lot_id: '7', price_per_ticket: '800000', ticket_amount: '1000000', total_usdc: '800000' }]
          },
          { side: 'DOWN', best_bid_price: null, best_ask_price: null, bids: [], asks: [] }
        ]
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getOrderBook('5928355', '1')).resolves.toMatchObject({
      state: 'live',
      sides: expect.arrayContaining([expect.objectContaining({ side: 'UP' })])
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/rounds/5928355/orderbook?market_id=1',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/json' })
      })
    );
  });

  it('posts market buy requests to the best-entry endpoint', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'confirmed',
        execution_type: 'listed_ask',
        signature: 'devnet-signature',
        explorer_url: 'https://explorer.solana.com/tx/devnet-signature?cluster=devnet',
        spent_usdc: '800000',
        received_tickets: '1000000',
        lot_id: '7',
        cash_balance: '4200000'
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.executeMarketBuy({
      roundId: '5928355',
      marketId: '1',
      buyerWallet: SOLANA_DEVNET_PUBKEY,
      side: 'UP',
      usdcIn: '1000000',
      accessToken: 'privy-access-token'
    })).resolves.toMatchObject({
      execution_type: 'listed_ask',
      spent_usdc: '800000'
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/rounds/5928355/market-buy',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer privy-access-token'
        }),
        body: JSON.stringify({
          market_id: 1,
          buyer_wallet: SOLANA_DEVNET_PUBKEY,
          side: 'UP',
          usdc_in: '1000000',
          slippage_bps: 100
        })
      })
    );
  });

  it('retries transient devnet round preparation errors before market buy succeeds', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const onRoundRetry = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ code: 'account_not_found' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'confirmed',
          execution_type: 'fresh_curve',
          signature: 'devnet-signature',
          explorer_url: 'https://explorer.solana.com/tx/devnet-signature?cluster=devnet',
          spent_usdc: '1000000',
          received_tickets: '1989961',
          lot_id: '42',
          cash_balance: '4000000'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.executeMarketBuy({
      roundId: '5928355',
      marketId: '1',
      buyerWallet: SOLANA_DEVNET_PUBKEY,
      side: 'UP',
      usdcIn: '1000000',
      accessToken: 'privy-access-token',
      roundRetryDelayMs: 0,
      onRoundRetry
    })).resolves.toMatchObject({
      execution_type: 'fresh_curve',
      spent_usdc: '1000000'
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRoundRetry).toHaveBeenCalledWith(1);
  });

  it('retries transient opening batch errors before market buy succeeds', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const onRoundRetry = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: 'opening_batch_active' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'confirmed',
          execution_type: 'fresh_curve',
          signature: 'devnet-signature',
          explorer_url: 'https://explorer.solana.com/tx/devnet-signature?cluster=devnet',
          spent_usdc: '1000000',
          received_tickets: '1989961',
          lot_id: '42',
          cash_balance: '4000000'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.executeMarketBuy({
      roundId: '5928355',
      marketId: '1',
      buyerWallet: SOLANA_DEVNET_PUBKEY,
      side: 'UP',
      usdcIn: '1000000',
      accessToken: 'privy-access-token',
      roundRetryDelayMs: 0,
      onRoundRetry
    })).resolves.toMatchObject({
      execution_type: 'fresh_curve',
      spent_usdc: '1000000'
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRoundRetry).toHaveBeenCalledWith(1);
  });

  it('stops retrying devnet round preparation errors after the configured attempts', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'round_not_initialized' })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.executeMarketBuy({
      roundId: '5928355',
      marketId: '1',
      buyerWallet: SOLANA_DEVNET_PUBKEY,
      side: 'UP',
      usdcIn: '1000000',
      accessToken: 'privy-access-token',
      roundRetryAttempts: 2,
      roundRetryDelayMs: 0
    })).rejects.toMatchObject({
      code: 'round_not_initialized'
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('maps buy intent route and devnet bootstrap 404s to actionable messages', () => {
    const routeMissing = normalizeBuyIntentError(
      new ApiClientError({ status: 404, path: '/rounds/1/buy-intent' }),
      '/rounds/1/buy-intent'
    );
    const accountMissing = normalizeBuyIntentError(
      new ApiClientError({ status: 404, code: 'account_not_found', path: '/rounds/1/buy-intent' }),
      '/rounds/1/buy-intent'
    );
    const programMissing = normalizeBuyIntentError(
      new ApiClientError({ status: 404, code: 'program_not_deployed', path: '/rounds/1/buy-intent' }),
      '/rounds/1/buy-intent'
    );
    const globalMissing = normalizeBuyIntentError(
      new ApiClientError({ status: 404, code: 'global_config_not_initialized', path: '/rounds/1/buy-intent' }),
      '/rounds/1/buy-intent'
    );
    const marketMissing = normalizeBuyIntentError(
      new ApiClientError({ status: 404, code: 'market_not_initialized', path: '/rounds/1/buy-intent' }),
      '/rounds/1/buy-intent'
    );
    const openingBatchActive = normalizeBuyIntentError(
      new ApiClientError({ status: 400, code: 'opening_batch_active', path: '/rounds/1/market-buy' }),
      '/rounds/1/market-buy'
    );

    expect(routeMissing).toBeInstanceOf(ApiClientError);
    expect((routeMissing as ApiClientError).message).toBe('Buy intent API is not available. Restart the dev API.');
    expect((routeMissing as ApiClientError).code).toBe('buy_intent_route_missing');
    expect(accountMissing).toBeInstanceOf(ApiClientError);
    expect((accountMissing as ApiClientError).message).toBe('Devnet round is being prepared. Start the devnet live keeper or retry in a moment.');
    expect((accountMissing as ApiClientError).code).toBe('round_not_initialized');
    expect(isTransientDevnetRoundError(accountMissing)).toBe(true);
    expect((programMissing as ApiClientError).message).toBe('Devnet program is not deployed.');
    expect((globalMissing as ApiClientError).message).toBe('Devnet global config is not initialized.');
    expect((marketMissing as ApiClientError).message).toBe('Devnet market is not initialized.');
    expect(openingBatchActive).toBeInstanceOf(ApiClientError);
    expect((openingBatchActive as ApiClientError).message).toBe('Devnet round is opening. Retry in a moment.');
    expect(isTransientDevnetRoundError(openingBatchActive)).toBe(true);
  });

  it('reads profile cash balances from the cash projection endpoint', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        wallet_address: SOLANA_DEVNET_PUBKEY,
        currency: 'BUSDC',
        decimals: 6,
        cash_balance: '8490000',
        status: 'ready'
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getCashBalance(SOLANA_DEVNET_PUBKEY)).resolves.toMatchObject({
      currency: 'BUSDC',
      cash_balance: '8490000',
      status: 'ready'
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/cash`,
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json'
        })
      })
    );
  });

  it('passes selected round start time to the market curve endpoint', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        market_id: '1',
        round_id: '5928349',
        duration_seconds: 300,
        updated_at: '2026-05-11T13:05:00Z',
        sides: [
          { side: 'UP', price: '500000', best_entry_price: '500000', best_entry_source: 'fresh_curve', fresh_mint_price: '500000', listed_best_ask_price: null, last_trade_price: null, token_supply: '0', market_cap: '50000000000', liquidity: '0', volume: '0', virtual_usdc: '50000000000', virtual_ticket: '100000000000' },
          { side: 'DOWN', price: '500000', best_entry_price: '500000', best_entry_source: 'fresh_curve', fresh_mint_price: '500000', listed_best_ask_price: null, last_trade_price: null, token_supply: '0', market_cap: '50000000000', liquidity: '0', volume: '0', virtual_usdc: '50000000000', virtual_ticket: '100000000000' }
        ],
        points: []
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getMarketCurve('1', 1_778_504_700)).resolves.toMatchObject({
      round_id: '5928349'
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/markets/1/curve?start_at=1778504700',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json'
        })
      })
    );
  });

  it('reads deposit config and posts signed deposit signatures', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cluster: 'devnet',
          currency: 'BUSDC',
          decimals: 6,
          mint: SOLANA_DEVNET_PUBKEY,
          vault_owner: SOLANA_DEVNET_PUBKEY,
          vault_token_account: 'So11111111111111111111111111111111111111112',
          commitment: 'confirmed',
          status: 'ready'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          signature: 'devnet-signature',
          currency: 'BUSDC',
          decimals: 6,
          cash_balance: '2500000',
          deposited_amount: '2500000',
          status: 'credited'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getDepositConfig()).resolves.toMatchObject({ status: 'ready' });
    await expect(liveApi.verifyDeposit(SOLANA_DEVNET_PUBKEY, 'devnet-signature', 'token')).resolves.toMatchObject({
      currency: 'BUSDC',
      cash_balance: '2500000',
      status: 'credited'
    });

    expect(fetch).toHaveBeenLastCalledWith(
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/deposits`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signature: 'devnet-signature' }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
  });

  it('reads deposit liquidity status from the live API', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cluster: 'devnet',
        currency: 'BUSDC',
        decimals: 6,
        mint: SOLANA_DEVNET_PUBKEY,
        vault_owner: SOLANA_DEVNET_PUBKEY,
        vault_token_account: 'So11111111111111111111111111111111111111112',
        vault_cash_balance: '2500000',
        total_cash_liabilities: '1000000',
        available_cash_reserve: '1500000',
        status: 'ready'
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getDepositLiquidity()).resolves.toMatchObject({
      currency: 'BUSDC',
      available_cash_reserve: '1500000',
      status: 'ready'
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/deposit/liquidity',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json'
        })
      })
    );
  });

  it('reads SOL deposit quotes and posts signed SOL deposit signatures', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          currency: 'BUSDC',
          decimals: 6,
          cash_amount: '1000000',
          quote_id: 'quote-1',
          lamports: '6666667',
          price: '150000000',
          expires_at: '2026-05-10T00:00:00Z',
          treasury: SOLANA_DEVNET_PUBKEY,
          status: 'ready'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          signature: 'devnet-signature',
          quote_id: 'quote-1',
          currency: 'BUSDC',
          decimals: 6,
          cash_balance: '1000000',
          deposited_amount: '1000000',
          lamports: '6666667',
          price: '150000000',
          status: 'credited'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getSolDepositQuote(SOLANA_DEVNET_PUBKEY, '1000000')).resolves.toMatchObject({
      status: 'ready',
      lamports: '6666667'
    });
    await expect(liveApi.verifySolDeposit(SOLANA_DEVNET_PUBKEY, 'quote-1', 'devnet-signature', 'token')).resolves.toMatchObject({
      cash_balance: '1000000',
      status: 'credited'
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/sol-deposit-quote?cash_amount=1000000`,
      expect.anything()
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/sol-deposits`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ quote_id: 'quote-1', signature: 'devnet-signature' }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
  });

  it('surfaces backend SOL deposit errors instead of mock fallback messages', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'true');
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'sol_deposit_quote_expired',
        message: 'Quote has expired.',
        request_id: 'req-123'
      })
    });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi, ApiClientError } = await import('./client');

    let caught: unknown;
    try {
      await liveApi.verifySolDeposit(SOLANA_DEVNET_PUBKEY, 'quote-1', 'devnet-signature', 'token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'sol_deposit_quote_expired',
      requestId: 'req-123',
      path: `/profiles/${SOLANA_DEVNET_PUBKEY}/sol-deposits`
    });
    expect(caught).toHaveProperty('message', 'Quote has expired.');
  });

  it('creates and verifies manual transfer deposit quotes', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          asset: 'BUSDC',
          currency: 'BUSDC',
          decimals: 6,
          cash_amount: '1000000',
          quote_id: 'quote-1',
          reference: 'bm:quote-1',
          transfer_amount: '1000000',
          price: null,
          expires_at: '2026-05-10T00:00:00Z',
          destination: 'So11111111111111111111111111111111111111112',
          mint: SOLANA_DEVNET_PUBKEY,
          status: 'ready'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          signature: 'devnet-signature',
          quote_id: 'quote-1',
          asset: 'BUSDC',
          currency: 'BUSDC',
          decimals: 6,
          cash_balance: '1000000',
          deposited_amount: '1000000',
          transfer_amount: '1000000',
          price: null,
          status: 'credited'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.createTransferDepositQuote(SOLANA_DEVNET_PUBKEY, 'BUSDC', '1000000', 'token')).resolves.toMatchObject({
      asset: 'BUSDC',
      reference: 'bm:quote-1',
      status: 'ready'
    });
    await expect(liveApi.verifyTransferDeposit(SOLANA_DEVNET_PUBKEY, 'quote-1', 'devnet-signature', 'token')).resolves.toMatchObject({
      cash_balance: '1000000',
      status: 'credited'
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/transfer-deposit-quotes`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ asset: 'BUSDC', cash_amount: '1000000' }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/transfer-deposits`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ quote_id: 'quote-1', signature: 'devnet-signature' }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
  });

  it('reads withdraw config and posts withdrawal quote/verify requests', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '/api/backend');
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK_FALLBACK', 'false');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cluster: 'devnet',
          currency: 'BUSDC',
          decimals: 6,
          mint: SOLANA_DEVNET_PUBKEY,
          vault_owner: SOLANA_DEVNET_PUBKEY,
          vault_token_account: 'So11111111111111111111111111111111111111112',
          quote_ttl_seconds: 60,
          status: 'ready',
          reason: null
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          currency: 'BUSDC',
          decimals: 6,
          cash_amount: '1000000',
          quote_id: 'withdraw-quote-1',
          message: 'withdraw message',
          destination: SOLANA_DEVNET_PUBKEY,
          destination_token_account: 'So11111111111111111111111111111111111111112',
          mint: SOLANA_DEVNET_PUBKEY,
          expires_at: '2026-05-10T00:00:00Z',
          status: 'ready'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          wallet_address: SOLANA_DEVNET_PUBKEY,
          quote_id: 'withdraw-quote-1',
          user_signature: 'user-signature',
          vault_signature: 'vault-signature',
          currency: 'BUSDC',
          decimals: 6,
          mint: SOLANA_DEVNET_PUBKEY,
          cash_balance: '0',
          withdrawn_amount: '1000000',
          destination: SOLANA_DEVNET_PUBKEY,
          destination_token_account: 'So11111111111111111111111111111111111111112',
          explorer_url: 'https://explorer.solana.com/tx/vault-signature?cluster=devnet',
          status: 'sent'
        })
      });
    vi.stubGlobal('fetch', fetch);
    const { api: liveApi } = await import('./client');

    await expect(liveApi.getWithdrawConfig()).resolves.toMatchObject({ status: 'ready' });
    await expect(liveApi.createWithdrawalQuote(SOLANA_DEVNET_PUBKEY, '1000000', 'token', SOLANA_DEVNET_PUBKEY)).resolves.toMatchObject({
      quote_id: 'withdraw-quote-1',
      message: 'withdraw message'
    });
    await expect(liveApi.verifyWithdrawal(SOLANA_DEVNET_PUBKEY, 'withdraw-quote-1', 'user-signature', 'token')).resolves.toMatchObject({
      vault_signature: 'vault-signature',
      status: 'sent'
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/withdrawal-quotes`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cash_amount: '1000000', destination: SOLANA_DEVNET_PUBKEY }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/backend/profiles/${SOLANA_DEVNET_PUBKEY}/withdrawals`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ quote_id: 'withdraw-quote-1', user_signature: 'user-signature' }),
        headers: expect.objectContaining({
          authorization: 'Bearer token'
        })
      })
    );
  });
});
