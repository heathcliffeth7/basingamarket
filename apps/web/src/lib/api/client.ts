import { apiBaseUrl, isMockFallbackEnabled } from './env';
import {
  CashBalanceSchema,
  CanvasResponseSchema,
  DepositConfigSchema,
  DepositLiquiditySchema,
  DepositVerificationSchema,
  BidBookSchema,
  BusdcMintSchema,
  BusdcMintStatusSchema,
  BuyIntentSchema,
  CashBuySchema,
  CashBidSchema,
  CashResaleSchema,
  CancelListingResponseSchema,
  ClaimTicketSchema,
  ListingResponseSchema,
  MarketBuySchema,
  MarketCurveSchema,
  OrderBookSchema,
  MarketPriceSeriesSchema,
  MarketSchema,
  ProfileActivitySchema,
  ProfileSchema,
  RoundHistorySchema,
  ShareCardResponseSchema,
  ShareRenderResponseSchema,
  SolDepositQuoteSchema,
  SolDepositVerificationSchema,
  TransferDepositQuoteSchema,
  TransferDepositVerificationSchema,
  WithdrawConfigSchema,
  WithdrawalQuoteSchema,
  WithdrawalVerificationSchema,
  TicketSchema,
  type CashBalance,
  type CanvasResponse,
  type DepositConfig,
  type DepositLiquidity,
  type DepositVerification,
  type BidBook,
  type BusdcMint,
  type BusdcMintStatus,
  type BuyIntent,
  type CashBuy,
  type CashBid,
  type CashResale,
  type CancelListingResponse,
  type ClaimTicket,
  type ListingResponse,
  type MarketBuy,
  type Market,
  type MarketCurve,
  type OrderBook,
  type MarketPriceSeries,
  type ProfileActivity,
  type Profile,
  type RoundHistory,
  type ShareCardResponse,
  type ShareRenderResponse,
  type SolDepositQuote,
  type SolDepositVerification,
  type TransferDepositAsset,
  type TransferDepositQuote,
  type TransferDepositVerification,
  type WithdrawConfig,
  type WithdrawalQuote,
  type WithdrawalVerification,
  type Ticket
} from './types';
import {
  mockCanvas,
  mockCurves,
  mockMarketPriceSeries,
  mockMarkets,
  mockOrderBooks,
  mockProfile,
  mockProfileActivity,
  mockRoundHistories,
  mockShareCard,
  mockShareRender,
  mockTickets
} from './mock';
import { hydrateLiveMarketPrices } from './livePrices';
import { z } from 'zod';

const MarketsSchema = z.array(MarketSchema);
const TicketsSchema = z.array(TicketSchema);
export const DEVNET_ROUND_RETRY_ATTEMPTS = 30;
export const DEVNET_ROUND_RETRY_DELAY_MS = 500;

type ApiClientErrorInput = {
  status: number;
  code?: string;
  message?: string;
  requestId?: string | null;
  path: string;
};

type RoundRetryOptions = {
  attempts?: number;
  delayMs?: number;
  onRoundRetry?: (attempt: number) => void;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly path: string;

  constructor({ status, code, message, requestId, path }: ApiClientErrorInput) {
    super(message ?? `API ${status} for ${path}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code ?? 'api_error';
    this.requestId = requestId ?? null;
    this.path = path;
  }
}

function authHeaders(accessToken?: string | null): Record<string, string> {
  return accessToken ? { authorization: `Bearer ${accessToken}` } : {};
}

async function requestJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const errorPayload = await readApiErrorPayload(response);
    throw new ApiClientError({
      status: response.status,
      code: typeof errorPayload?.code === 'string' ? errorPayload.code : undefined,
      message: typeof errorPayload?.message === 'string' ? errorPayload.message : undefined,
      requestId: typeof errorPayload?.request_id === 'string' ? errorPayload.request_id : null,
      path
    });
  }

  return schema.parse(await response.json());
}

async function readApiErrorPayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload = await response.json();
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function withMockFallback<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isMockFallbackEnabled) {
      return fallback();
    }

    throw error;
  }
}

async function withDevnetRoundRetry<T>(
  operation: () => Promise<T>,
  path: string,
  {
    attempts = DEVNET_ROUND_RETRY_ATTEMPTS,
    delayMs = DEVNET_ROUND_RETRY_DELAY_MS,
    onRoundRetry
  }: RoundRetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalized = normalizeBuyIntentError(error, path);
      if (!isTransientDevnetRoundError(normalized) || attempt >= attempts) {
        throw normalized;
      }
      lastError = normalized;
      onRoundRetry?.(attempt);
      await delay(delayMs);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const api = {
  async getMarkets(): Promise<Market[]> {
    const markets = await withMockFallback(
      () => requestJson('/markets', MarketsSchema),
      () => mockMarkets
    );
    return hydrateLiveMarketPrices(markets);
  },

  async getMarket(marketId: string): Promise<Market> {
    const market = await withMockFallback(
      () => requestJson(`/markets/${marketId}`, MarketSchema),
      () => mockMarkets.find((market) => market.market_id === marketId) ?? mockMarkets[0]
    );
    return (await hydrateLiveMarketPrices([market]))[0] ?? market;
  },

  getMarketCanvas(marketId: string): Promise<CanvasResponse> {
    return withMockFallback(
      () => requestJson(`/markets/${marketId}/canvas`, CanvasResponseSchema),
      () => mockCanvas[marketId] ?? mockCanvas['1']
    );
  },

  getMarketCurve(marketId: string, startAt?: number | null): Promise<MarketCurve> {
    const search = startAt === null || startAt === undefined
      ? ''
      : `?${new URLSearchParams({ start_at: String(startAt) }).toString()}`;
    return withMockFallback(
      () => requestJson(`/markets/${marketId}/curve${search}`, MarketCurveSchema),
      () => mockCurves[marketId] ?? mockCurves['1']
    );
  },

  getMarketRounds(marketId: string, limit = 6): Promise<RoundHistory> {
    return withMockFallback(
      () => requestJson(`/markets/${marketId}/rounds?limit=${limit}`, RoundHistorySchema),
      () => mockRoundHistories[marketId] ?? mockRoundHistories['1']
    );
  },

  getMarketPriceSeries({
    symbol,
    startTs,
    durationSeconds
  }: {
    symbol: string;
    startTs: number;
    durationSeconds: number;
  }): Promise<MarketPriceSeries> {
    const search = new URLSearchParams({
      symbol,
      startTs: String(startTs),
      duration: String(durationSeconds)
    });

    return withMockFallback(
      () => requestLocalJson(`/api/binance/price-series?${search.toString()}`, MarketPriceSeriesSchema),
      () => mockMarketPriceSeries(symbol, startTs, durationSeconds)
    );
  },

  getMarketTickets(marketId: string, roundId?: string | number | null): Promise<Ticket[]> {
    const search = roundId === null || roundId === undefined || roundId === ''
      ? ''
      : `?${new URLSearchParams({ round_id: String(roundId) }).toString()}`;
    return withMockFallback(
      () => requestJson(`/markets/${marketId}/tickets${search}`, TicketsSchema),
      () => mockTickets.filter((ticket) => ticket.market_id === marketId && (!roundId || ticket.round_id === String(roundId)))
    );
  },

  getTicket(ticketId: string): Promise<Ticket> {
    return withMockFallback(
      () => requestJson(`/tickets/${ticketId}`, TicketSchema),
      () => mockTickets.find((ticket) => ticket.ticket_id === ticketId) ?? mockTickets[0]
    );
  },

  claimTicket({
    ticketId,
    claimerWallet,
    accessToken
  }: {
    ticketId: string;
    claimerWallet: string;
    accessToken?: string | null;
  }): Promise<ClaimTicket> {
    return requestJson(`/tickets/${ticketId}/claim`, ClaimTicketSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ claimer_wallet: claimerWallet })
    });
  },

  listTicket({
    ticketId,
    sellerWallet,
    pricePerTicket,
    marketId,
    roundId,
    accessToken
  }: {
    ticketId: string;
    sellerWallet: string;
    pricePerTicket: string;
    marketId?: string | number | null;
    roundId?: string | number | null;
    accessToken?: string | null;
  }): Promise<ListingResponse> {
    return requestJson(`/tickets/${ticketId}/list`, ListingResponseSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        seller_wallet: sellerWallet,
        price_per_ticket: pricePerTicket,
        ...(marketId ? { market_id: Number(marketId) } : {}),
        ...(roundId ? { round_id: Number(roundId) } : {})
      })
    });
  },

  cancelListing({
    ticketId,
    sellerWallet,
    marketId,
    roundId,
    accessToken
  }: {
    ticketId: string;
    sellerWallet: string;
    marketId?: string | number | null;
    roundId?: string | number | null;
    accessToken?: string | null;
  }): Promise<CancelListingResponse> {
    return requestJson(`/tickets/${ticketId}/cancel-listing`, CancelListingResponseSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        seller_wallet: sellerWallet,
        ...(marketId ? { market_id: Number(marketId) } : {}),
        ...(roundId ? { round_id: Number(roundId) } : {})
      })
    });
  },

  buyListing({
    ticketId,
    buyerWallet,
    maxPricePerTicket,
    marketId,
    roundId,
    accessToken
  }: {
    ticketId: string;
    buyerWallet: string;
    maxPricePerTicket: string;
    marketId?: string | number | null;
    roundId?: string | number | null;
    accessToken?: string | null;
  }): Promise<CashResale> {
    return requestJson(`/tickets/${ticketId}/buy-listing`, CashResaleSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        buyer_wallet: buyerWallet,
        max_price_per_ticket: maxPricePerTicket,
        ...(marketId ? { market_id: Number(marketId) } : {}),
        ...(roundId ? { round_id: Number(roundId) } : {})
      })
    });
  },

  getBids(roundId: string, marketId: string): Promise<BidBook> {
    const search = new URLSearchParams({ market_id: marketId });
    return requestJson(`/rounds/${roundId}/bids?${search.toString()}`, BidBookSchema);
  },

  getOrderBook(roundId: string, marketId: string): Promise<OrderBook> {
    const search = new URLSearchParams({ market_id: marketId });
    return withMockFallback(
      () => requestJson(`/rounds/${roundId}/orderbook?${search.toString()}`, OrderBookSchema),
      () => mockOrderBooks[marketId] ?? {
        market_id: marketId,
        round_id: roundId,
        updated_at: new Date(0).toISOString(),
        state: 'live',
        sides: [
          { side: 'UP', bids: [], asks: [], best_bid_price: null, best_ask_price: null },
          { side: 'DOWN', bids: [], asks: [], best_bid_price: null, best_ask_price: null }
        ]
      }
    );
  },

  createBid({
    roundId,
    marketId,
    buyerWallet,
    side,
    pricePerTicket,
    maxUsdc,
    accessToken
  }: {
    roundId: string;
    marketId: string;
    buyerWallet: string;
    side: 'UP' | 'DOWN';
    pricePerTicket: string;
    maxUsdc: string;
    accessToken?: string | null;
  }): Promise<CashBid> {
    return requestJson(`/rounds/${roundId}/bids`, CashBidSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        market_id: Number(marketId),
        buyer_wallet: buyerWallet,
        side,
        price_per_ticket: pricePerTicket,
        max_usdc: maxUsdc
      })
    });
  },

  cancelBid({
    roundId,
    bidId,
    buyerWallet,
    accessToken
  }: {
    roundId: string;
    bidId: string;
    buyerWallet: string;
    accessToken?: string | null;
  }): Promise<CashBid> {
    return requestJson(`/rounds/${roundId}/bids/${bidId}`, CashBidSchema, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ buyer_wallet: buyerWallet })
    });
  },

  instantSell({
    ticketId,
    sellerWallet,
    marketId,
    roundId,
    minPricePerTicket,
    accessToken
  }: {
    ticketId: string;
    sellerWallet: string;
    marketId?: string | number | null;
    roundId?: string | number | null;
    minPricePerTicket?: string | null;
    accessToken?: string | null;
  }): Promise<CashResale> {
    return requestJson(`/tickets/${ticketId}/instant-sell`, CashResaleSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        seller_wallet: sellerWallet,
        ...(marketId ? { market_id: Number(marketId) } : {}),
        ...(roundId ? { round_id: Number(roundId) } : {}),
        ...(minPricePerTicket ? { min_price_per_ticket: minPricePerTicket } : {})
      })
    });
  },

  createBuyIntent({
    roundId,
    marketId,
    buyerWallet,
    side,
    usdcIn,
    slippageBps = 100,
    roundRetryAttempts,
    roundRetryDelayMs,
    onRoundRetry
  }: {
    roundId: string;
    marketId: string;
    buyerWallet: string;
    side: 'UP' | 'DOWN';
    usdcIn: string;
    slippageBps?: number;
    roundRetryAttempts?: number;
    roundRetryDelayMs?: number;
    onRoundRetry?: (attempt: number) => void;
  }): Promise<BuyIntent> {
    const path = `/rounds/${roundId}/buy-intent`;
    return withDevnetRoundRetry(() => requestJson(path, BuyIntentSchema, {
      method: 'POST',
      body: JSON.stringify({
        market_id: Number(marketId),
        buyer_wallet: buyerWallet,
        side,
        usdc_in: usdcIn,
        slippage_bps: slippageBps
      })
    }), path, {
      attempts: roundRetryAttempts,
      delayMs: roundRetryDelayMs,
      onRoundRetry
    });
  },

  executeCashBuy({
    roundId,
    marketId,
    buyerWallet,
    side,
    usdcIn,
    accessToken,
    slippageBps = 100,
    roundRetryAttempts,
    roundRetryDelayMs,
    onRoundRetry
  }: {
    roundId: string;
    marketId: string;
    buyerWallet: string;
    side: 'UP' | 'DOWN';
    usdcIn: string;
    accessToken?: string | null;
    slippageBps?: number;
    roundRetryAttempts?: number;
    roundRetryDelayMs?: number;
    onRoundRetry?: (attempt: number) => void;
  }): Promise<CashBuy> {
    const path = `/rounds/${roundId}/cash-buy`;
    return withDevnetRoundRetry(() => requestJson(path, CashBuySchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        market_id: Number(marketId),
        buyer_wallet: buyerWallet,
        side,
        usdc_in: usdcIn,
        slippage_bps: slippageBps
      })
    }), path, {
      attempts: roundRetryAttempts,
      delayMs: roundRetryDelayMs,
      onRoundRetry
    });
  },

  executeMarketBuy({
    roundId,
    marketId,
    buyerWallet,
    side,
    usdcIn,
    accessToken,
    slippageBps = 100,
    roundRetryAttempts,
    roundRetryDelayMs,
    onRoundRetry
  }: {
    roundId: string;
    marketId: string;
    buyerWallet: string;
    side: 'UP' | 'DOWN';
    usdcIn: string;
    accessToken?: string | null;
    slippageBps?: number;
    roundRetryAttempts?: number;
    roundRetryDelayMs?: number;
    onRoundRetry?: (attempt: number) => void;
  }): Promise<MarketBuy> {
    const path = `/rounds/${roundId}/market-buy`;
    return withDevnetRoundRetry(() => requestJson(path, MarketBuySchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        market_id: Number(marketId),
        buyer_wallet: buyerWallet,
        side,
        usdc_in: usdcIn,
        slippage_bps: slippageBps
      })
    }), path, {
      attempts: roundRetryAttempts,
      delayMs: roundRetryDelayMs,
      onRoundRetry
    });
  },

  requestShareRender(ticketId: string, accessToken?: string | null): Promise<ShareRenderResponse> {
    return withMockFallback(
      () => requestJson(`/share/${ticketId}/render`, ShareRenderResponseSchema, { method: 'POST', headers: authHeaders(accessToken) }),
      () => mockShareRender(ticketId)
    );
  },

  getShareCard(shareCardId: string): Promise<ShareCardResponse> {
    return withMockFallback(
      () => requestJson(`/share/${shareCardId}`, ShareCardResponseSchema),
      () => mockShareCard(shareCardId)
    );
  },

  getProfile(address: string): Promise<Profile> {
    return withMockFallback(
      () => requestJson(`/profiles/${address}`, ProfileSchema),
      () => mockProfile(address)
    );
  },

  getProfileTickets(address: string): Promise<Ticket[]> {
    return withMockFallback(
      () => requestJson(`/profiles/${address}/tickets`, TicketsSchema),
      () => mockTickets.filter((ticket) => ticket.current_owner === address || ticket.original_caller === address)
    );
  },

  getProfileActivity(address: string): Promise<ProfileActivity> {
    return withMockFallback(
      () => requestJson(`/profiles/${address}/activity`, ProfileActivitySchema),
      () => mockProfileActivity(address)
    );
  },

  getCashBalance(address: string): Promise<CashBalance> {
    return requestJson(`/profiles/${address}/cash`, CashBalanceSchema);
  },

  getBusdcMintStatus(address: string): Promise<BusdcMintStatus> {
    return requestJson(`/profiles/${address}/busdc-mint-status`, BusdcMintStatusSchema);
  },

  mintBusdc(address: string, accessToken?: string | null): Promise<BusdcMint> {
    return requestJson(`/profiles/${address}/busdc-mints`, BusdcMintSchema, {
      method: 'POST',
      headers: authHeaders(accessToken)
    });
  },

  getDepositConfig(): Promise<DepositConfig> {
    return requestJson('/deposit/config', DepositConfigSchema);
  },

  getDepositLiquidity(): Promise<DepositLiquidity> {
    return requestJson('/deposit/liquidity', DepositLiquiditySchema);
  },

  verifyDeposit(address: string, signature: string, accessToken?: string | null): Promise<DepositVerification> {
    return requestJson(`/profiles/${address}/deposits`, DepositVerificationSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ signature })
    });
  },

  getSolDepositQuote(address: string, cashAmount: string): Promise<SolDepositQuote> {
    const search = new URLSearchParams({ cash_amount: cashAmount });
    return requestJson(`/profiles/${address}/sol-deposit-quote?${search.toString()}`, SolDepositQuoteSchema);
  },

  verifySolDeposit(
    address: string,
    quoteId: string,
    signature: string,
    accessToken?: string | null
  ): Promise<SolDepositVerification> {
    return requestJson(`/profiles/${address}/sol-deposits`, SolDepositVerificationSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ quote_id: quoteId, signature })
    });
  },

  createTransferDepositQuote(
    address: string,
    asset: TransferDepositAsset,
    cashAmount: string,
    accessToken?: string | null
  ): Promise<TransferDepositQuote> {
    return requestJson(`/profiles/${address}/transfer-deposit-quotes`, TransferDepositQuoteSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ asset, cash_amount: cashAmount })
    });
  },

  verifyTransferDeposit(
    address: string,
    quoteId: string,
    signature: string,
    accessToken?: string | null
  ): Promise<TransferDepositVerification> {
    return requestJson(`/profiles/${address}/transfer-deposits`, TransferDepositVerificationSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ quote_id: quoteId, signature })
    });
  },

  getWithdrawConfig(): Promise<WithdrawConfig> {
    return requestJson('/withdraw/config', WithdrawConfigSchema);
  },

  createWithdrawalQuote(
    address: string,
    cashAmount: string,
    accessToken?: string | null,
    destination?: string | null
  ): Promise<WithdrawalQuote> {
    return requestJson(`/profiles/${address}/withdrawal-quotes`, WithdrawalQuoteSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        cash_amount: cashAmount,
        ...(destination ? { destination } : {})
      })
    });
  },

  verifyWithdrawal(
    address: string,
    quoteId: string,
    userSignature: string,
    accessToken?: string | null
  ): Promise<WithdrawalVerification> {
    return requestJson(`/profiles/${address}/withdrawals`, WithdrawalVerificationSchema, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ quote_id: quoteId, user_signature: userSignature })
    });
  },

  async getLatestWithdrawal(address: string): Promise<WithdrawalVerification | null> {
    try {
      return await requestJson(`/profiles/${address}/withdrawals/latest`, WithdrawalVerificationSchema);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null;
      throw error;
    }
  }
};

export function normalizeBuyIntentError(error: unknown, path: string) {
  if (error instanceof ApiClientError && error.code === 'opening_batch_active') {
    return new ApiClientError({
      status: error.status,
      code: 'opening_batch_active',
      message: 'Devnet round is opening. Retry in a moment.',
      requestId: error.requestId,
      path
    });
  }

  if (!(error instanceof ApiClientError) || error.status !== 404) return error;

  const buyIntentMessages: Record<string, { code: string; message: string }> = {
    account_not_found: {
      code: 'round_not_initialized',
      message: 'Devnet round is being prepared. Start the devnet live keeper or retry in a moment.'
    },
    program_not_deployed: {
      code: 'program_not_deployed',
      message: 'Devnet program is not deployed.'
    },
    global_config_not_initialized: {
      code: 'global_config_not_initialized',
      message: 'Devnet global config is not initialized.'
    },
    market_not_initialized: {
      code: 'market_not_initialized',
      message: 'Devnet market is not initialized.'
    },
    round_not_initialized: {
      code: 'round_not_initialized',
      message: 'Devnet round is being prepared. Start the devnet live keeper or retry in a moment.'
    }
  };
  const mapped = buyIntentMessages[error.code];
  if (mapped) {
    return new ApiClientError({
      status: 404,
      code: mapped.code,
      message: mapped.message,
      requestId: error.requestId,
      path
    });
  }

  return new ApiClientError({
    status: 404,
    code: 'buy_intent_route_missing',
    message: 'Buy intent API is not available. Restart the dev API.',
    requestId: error.requestId,
    path
  });
}

export function isTransientDevnetRoundError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
    && (error.code === 'round_not_initialized' || error.code === 'opening_batch_active');
}

export function marketWebSocketUrl(marketId: string) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/ws/markets/${marketId}`;
  return url.toString();
}

async function requestLocalJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Local API ${response.status} for ${path}`);
  }

  return schema.parse(await response.json());
}
