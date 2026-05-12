import { z } from 'zod';

export const OutcomeSchema = z.object({
  outcome_id: z.number(),
  label: z.string(),
  total_stake: z.string(),
  total_reward_shares: z.string(),
  current_odds: z.string()
});

export const MarketPriceHeaderSchema = z.object({
  asset: z.string(),
  asset_image_url: z.string(),
  duration_seconds: z.number(),
  settlement_source: z.string(),
  symbol: z.string(),
  round_id: z.string(),
  start_at: z.number(),
  end_at: z.number(),
  open_price: z.string().nullable(),
  current_price: z.string().nullable(),
  close_price: z.string().nullable(),
  price_display_state: z.enum(['live', 'closed', 'unavailable']),
  fetched_at: z.string()
});

export const MarketSchema = z.object({
  market_id: z.string(),
  market_sequence: z.number(),
  question_hash: z.string(),
  price_header: MarketPriceHeaderSchema.nullable().optional().default(null),
  status: z.string(),
  outcome_count: z.number(),
  open_at: z.number(),
  trade_until: z.number(),
  winning_outcome: z.number().nullable(),
  outcomes: z.array(OutcomeSchema)
});

export const CurveSideSchema = z.object({
  side: z.enum(['UP', 'DOWN']),
  price: z.string(),
  best_entry_price: z.string(),
  best_entry_source: z.enum(['listed_token', 'fresh_curve']),
  fresh_mint_price: z.string(),
  listed_best_ask_price: z.string().nullable(),
  last_trade_price: z.string().nullable(),
  token_supply: z.string(),
  market_cap: z.string(),
  liquidity: z.string(),
  volume: z.string(),
  virtual_usdc: z.string(),
  virtual_ticket: z.string()
});

export const CurvePointSchema = z.object({
  ts: z.number(),
  side: z.enum(['UP', 'DOWN']),
  price: z.string(),
  market_cap: z.string(),
  liquidity: z.string(),
  volume: z.string()
});

export const MarketCurveSchema = z.object({
  market_id: z.string(),
  round_id: z.string(),
  duration_seconds: z.number(),
  updated_at: z.string(),
  sides: z.array(CurveSideSchema),
  points: z.array(CurvePointSchema)
});

export const RoundHistoryItemSchema = z.object({
  round_id: z.string(),
  start_at: z.number(),
  end_at: z.number(),
  status: z.string(),
  asset: z.string(),
  asset_image_url: z.string()
});

export const RoundHistorySchema = z.object({
  market_id: z.string(),
  duration_seconds: z.number(),
  rounds: z.array(RoundHistoryItemSchema)
});

export const MarketPricePointSchema = z.object({
  ts: z.number(),
  price: z.string()
});

export const MarketPriceSeriesSchema = z.object({
  symbol: z.string(),
  start_at: z.number(),
  end_at: z.number(),
  duration_seconds: z.number(),
  status: z.enum(['live', 'closed', 'unavailable']),
  open_price: z.string().nullable(),
  current_price: z.string().nullable(),
  close_price: z.string().nullable(),
  points: z.array(MarketPricePointSchema)
});

export const CanvasRegionSchema = z.object({
  outcome_id: z.string(),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  total_stake: z.string(),
  current_odds: z.string(),
  state: z.string()
});

export const CanvasNodeSchema = z.object({
  ticket_id: z.string(),
  outcome_id: z.string(),
  x: z.number(),
  y: z.number(),
  radius: z.number(),
  z_index: z.number(),
  owner: z.string(),
  owner_display: z.string(),
  current_owner: z.string().optional(),
  original_caller: z.string(),
  original_caller_display: z.string(),
  avatar_url: z.string().optional().nullable(),
  mood: z.enum(['neutral', 'optimistic', 'anxious', 'euphoric']),
  confidence: z.number(),
  listed: z.boolean(),
  listed_price: z.string().optional().nullable(),
  last_transfer_at: z.string().optional().nullable(),
  status: z.enum(['active', 'listed', 'won', 'lost', 'refundable', 'claimed'])
});

export const CanvasResponseSchema = z.object({
  market_id: z.string(),
  market_sequence: z.number(),
  canvas_version: z.number(),
  width: z.literal(1200),
  height: z.literal(630),
  regions: z.array(CanvasRegionSchema),
  nodes: z.array(CanvasNodeSchema)
});

export const TicketSchema = z.object({
  ticket_id: z.string(),
  market_id: z.string(),
  round_id: z.string().optional().default(''),
  outcome_id: z.number(),
  token_name: z.string().optional(),
  original_caller: z.string(),
  current_owner: z.string(),
  stake_amount: z.string(),
  token_amount: z.string().optional(),
  reward_shares: z.string(),
  entry_odds: z.string(),
  cost_basis_usdc: z.string().optional(),
  avg_entry_price: z.string().optional(),
  settlement_value_usdc: z.string().optional().nullable(),
  realized_pnl_usdc: z.string().optional().nullable(),
  listed_price: z.string().optional().nullable(),
  status: z.enum(['active', 'listed', 'won', 'lost', 'refundable', 'claimed']),
  claimed: z.boolean(),
  confidence: z.number(),
  mood: z.number()
});

export const ClaimTicketSchema = z.object({
  status: z.enum(['claimed', 'already_claimed']),
  ticket_id: z.string(),
  amount: z.string(),
  cash_balance: z.string(),
  ticket: TicketSchema
});

export const BuyIntentInstructionAccountSchema = z.object({
  pubkey: z.string(),
  is_signer: z.boolean(),
  is_writable: z.boolean()
});

export const BuyIntentSchema = z.object({
  cluster: z.literal('devnet'),
  program_id: z.string(),
  round: z.string(),
  position_lot: z.string(),
  lot_id: z.string(),
  quote: z.object({
    side: z.enum(['UP', 'DOWN']),
    usdc_in: z.string(),
    fee_usdc: z.string(),
    net_usdc: z.string(),
    tickets_out: z.string(),
    min_tickets_out: z.string(),
    fresh_price_before: z.string(),
    fresh_price_after: z.string()
  }),
  instruction: z.object({
    program_id: z.string(),
    accounts: z.array(BuyIntentInstructionAccountSchema),
    data_base64: z.string()
  })
});

export const CashBuySchema = z.object({
  status: z.enum(['confirmed', 'already_confirmed']),
  cluster: z.literal('devnet'),
  program_id: z.string(),
  round: z.string(),
  position_lot: z.string(),
  lot_id: z.string(),
  signature: z.string(),
  explorer_url: z.string(),
  cash_balance: z.string(),
  quote: z.object({
    side: z.enum(['UP', 'DOWN']),
    usdc_in: z.string(),
    fee_usdc: z.string(),
    net_usdc: z.string(),
    tickets_out: z.string(),
    min_tickets_out: z.string(),
    fresh_price_before: z.string(),
    fresh_price_after: z.string()
  })
});

export const MarketBuySchema = z.object({
  status: z.enum(['confirmed', 'already_confirmed']),
  execution_type: z.enum(['listed_ask', 'fresh_curve']),
  signature: z.string(),
  explorer_url: z.string(),
  spent_usdc: z.string(),
  received_tickets: z.string(),
  lot_id: z.string(),
  cash_balance: z.string()
});

export const ListingResponseSchema = z.object({
  status: z.literal('listed'),
  ticket_id: z.string(),
  signature: z.string(),
  explorer_url: z.string(),
  price_per_ticket: z.string()
});

export const CancelListingResponseSchema = z.object({
  status: z.literal('cancelled'),
  ticket_id: z.string(),
  signature: z.string(),
  explorer_url: z.string()
});

export const CashBidSchema = z.object({
  bid_id: z.string(),
  market_id: z.string(),
  round_id: z.string(),
  side: z.string(),
  buyer_wallet: z.string(),
  price_per_ticket: z.string(),
  max_usdc: z.string(),
  remaining_usdc: z.string(),
  status: z.string(),
  cash_balance: z.string().optional().nullable()
});

export const BidBookSchema = z.object({
  round_id: z.string(),
  bids: z.array(CashBidSchema)
});

export const OrderBookBidSchema = z.object({
  bid_id: z.string(),
  price_per_ticket: z.string(),
  remaining_usdc: z.string(),
  available_tickets: z.string(),
  total_usdc: z.string()
});

export const OrderBookAskSchema = z.object({
  lot_id: z.string(),
  price_per_ticket: z.string(),
  ticket_amount: z.string(),
  total_usdc: z.string()
});

export const OrderBookSideSchema = z.object({
  side: z.enum(['UP', 'DOWN']),
  bids: z.array(OrderBookBidSchema),
  asks: z.array(OrderBookAskSchema),
  best_bid_price: z.string().optional().nullable(),
  best_ask_price: z.string().optional().nullable()
});

export const OrderBookSchema = z.object({
  market_id: z.string(),
  round_id: z.string(),
  updated_at: z.string(),
  state: z.enum(['live', 'round_closed']),
  sides: z.array(OrderBookSideSchema)
});

export const CashResaleSchema = z.object({
  status: z.enum(['bought_listing', 'sold', 'partially_sold']),
  ticket_id: z.string(),
  buyer_lot_id: z.string().optional().nullable(),
  signature: z.string(),
  explorer_url: z.string(),
  gross_usdc: z.string(),
  seller_receives: z.string(),
  resale_fee: z.string(),
  early_flip_fee: z.string(),
  seller_cash_balance: z.string(),
  buyer_cash_balance: z.string()
});

export const ProfileSchema = z.object({
  wallet_address: z.string(),
  display_name: z.string().optional().nullable(),
  avatar_url: z.string().optional().nullable()
});

export const CashBalanceSchema = z.object({
  wallet_address: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_balance: z.string().optional().nullable().default(null),
  status: z.enum(['ready', 'projection_pending'])
});

export const BusdcMintStatusSchema = z.object({
  wallet_address: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  mint_amount: z.string(),
  daily_mints_used: z.number(),
  daily_mints_remaining: z.number(),
  daily_mints_limit: z.number(),
  reset_at: z.string(),
  status: z.literal('ready')
});

export const BusdcMintSchema = z.object({
  wallet_address: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  minted_amount: z.string(),
  cash_balance: z.string(),
  daily_mints_used: z.number(),
  daily_mints_remaining: z.number(),
  daily_mints_limit: z.number(),
  reset_at: z.string(),
  status: z.literal('credited')
});

export const DepositConfigSchema = z.object({
  cluster: z.literal('devnet'),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  mint: z.string().optional().nullable().default(null),
  vault_owner: z.string().optional().nullable().default(null),
  vault_token_account: z.string().optional().nullable().default(null),
  commitment: z.enum(['confirmed', 'finalized']),
  status: z.enum(['ready', 'projection_pending'])
});

export const DepositLiquiditySchema = z.object({
  cluster: z.literal('devnet'),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  mint: z.string().optional().nullable().default(null),
  vault_owner: z.string().optional().nullable().default(null),
  vault_token_account: z.string().optional().nullable().default(null),
  vault_cash_balance: z.string(),
  total_cash_liabilities: z.string(),
  available_cash_reserve: z.string(),
  status: z.enum(['ready', 'liquidity_pending', 'projection_pending'])
});

export const DepositVerificationSchema = z.object({
  wallet_address: z.string(),
  signature: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_balance: z.string(),
  deposited_amount: z.string(),
  status: z.enum(['credited', 'already_credited'])
});

export const SolDepositQuoteSchema = z.object({
  wallet_address: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_amount: z.string(),
  quote_id: z.string().optional().nullable().default(null),
  lamports: z.string().optional().nullable().default(null),
  price: z.string().optional().nullable().default(null),
  expires_at: z.string().optional().nullable().default(null),
  treasury: z.string().optional().nullable().default(null),
  status: z.enum(['ready', 'liquidity_pending', 'projection_pending'])
});

export const SolDepositVerificationSchema = z.object({
  wallet_address: z.string(),
  signature: z.string(),
  quote_id: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_balance: z.string(),
  deposited_amount: z.string(),
  lamports: z.string(),
  price: z.string(),
  status: z.enum(['credited', 'already_credited'])
});

export const TransferDepositAssetSchema = z.enum(['BUSDC', 'SOL']);

export const TransferDepositQuoteSchema = z.object({
  wallet_address: z.string(),
  asset: TransferDepositAssetSchema,
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_amount: z.string(),
  quote_id: z.string().optional().nullable().default(null),
  reference: z.string().optional().nullable().default(null),
  transfer_amount: z.string().optional().nullable().default(null),
  price: z.string().optional().nullable().default(null),
  expires_at: z.string().optional().nullable().default(null),
  destination: z.string().optional().nullable().default(null),
  mint: z.string().optional().nullable().default(null),
  status: z.enum(['ready', 'liquidity_pending', 'projection_pending'])
});

export const TransferDepositVerificationSchema = z.object({
  wallet_address: z.string(),
  signature: z.string(),
  quote_id: z.string(),
  asset: TransferDepositAssetSchema,
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_balance: z.string(),
  deposited_amount: z.string(),
  transfer_amount: z.string(),
  price: z.string().optional().nullable().default(null),
  status: z.enum(['credited', 'already_credited'])
});

export const WithdrawConfigSchema = z.object({
  cluster: z.literal('devnet'),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  mint: z.string().optional().nullable().default(null),
  vault_owner: z.string().optional().nullable().default(null),
  vault_token_account: z.string().optional().nullable().default(null),
  quote_ttl_seconds: z.number(),
  status: z.enum(['ready', 'setup_pending']),
  reason: z.string().optional().nullable().default(null)
});

export const WithdrawalQuoteSchema = z.object({
  wallet_address: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  cash_amount: z.string(),
  quote_id: z.string().optional().nullable().default(null),
  message: z.string().optional().nullable().default(null),
  destination: z.string().optional().nullable().default(null),
  destination_token_account: z.string().optional().nullable().default(null),
  mint: z.string().optional().nullable().default(null),
  expires_at: z.string().optional().nullable().default(null),
  status: z.enum(['ready', 'setup_pending'])
});

export const WithdrawalVerificationSchema = z.object({
  wallet_address: z.string(),
  quote_id: z.string(),
  user_signature: z.string(),
  vault_signature: z.string(),
  currency: z.literal('BUSDC'),
  decimals: z.literal(6),
  mint: z.string(),
  cash_balance: z.string(),
  withdrawn_amount: z.string(),
  destination: z.string(),
  destination_token_account: z.string(),
  explorer_url: z.string(),
  status: z.enum(['sent', 'already_sent'])
});

export const ShareCardKindSchema = z.enum(['ticket', 'entry', 'sale', 'winner', 'caller', 'profile']);

export const ShareCardResponseSchema = z.object({
  id: z.string(),
  kind: ShareCardKindSchema,
  ticket_id: z.string().optional().nullable(),
  status: z.enum(['pending', 'rendering', 'ready', 'failed']),
  svg_hash: z.string().optional().nullable(),
  png_url: z.string().optional().nullable(),
  error_message: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export const ShareRenderResponseSchema = z.object({
  share_card_id: z.string(),
  status: z.enum(['pending', 'rendering', 'ready'])
});

export const MarketWsDeltaSchema = z.object({
  market_id: z.string(),
  sequence: z.number(),
  canvas_version: z.number(),
  type: z.enum([
    'ticket_minted',
    'ticket_listed',
    'ticket_sold',
    'ticket_unlisted',
    'market_closed',
    'market_resolved',
    'canvas_updated'
  ]),
  payload: z.unknown()
});

export type Outcome = z.infer<typeof OutcomeSchema>;
export type MarketPriceHeader = z.infer<typeof MarketPriceHeaderSchema>;
export type Market = z.infer<typeof MarketSchema>;
export type CurveSide = z.infer<typeof CurveSideSchema>;
export type CurvePoint = z.infer<typeof CurvePointSchema>;
export type MarketCurve = z.infer<typeof MarketCurveSchema>;
export type RoundHistoryItem = z.infer<typeof RoundHistoryItemSchema>;
export type RoundHistory = z.infer<typeof RoundHistorySchema>;
export type MarketPricePoint = z.infer<typeof MarketPricePointSchema>;
export type MarketPriceSeries = z.infer<typeof MarketPriceSeriesSchema>;
export type CanvasRegion = z.infer<typeof CanvasRegionSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasResponse = z.infer<typeof CanvasResponseSchema>;
export type Ticket = z.infer<typeof TicketSchema>;
export type ClaimTicket = z.infer<typeof ClaimTicketSchema>;
export type BuyIntent = z.infer<typeof BuyIntentSchema>;
export type BuyIntentInstructionAccount = z.infer<typeof BuyIntentInstructionAccountSchema>;
export type CashBuy = z.infer<typeof CashBuySchema>;
export type MarketBuy = z.infer<typeof MarketBuySchema>;
export type ListingResponse = z.infer<typeof ListingResponseSchema>;
export type CancelListingResponse = z.infer<typeof CancelListingResponseSchema>;
export type CashBid = z.infer<typeof CashBidSchema>;
export type BidBook = z.infer<typeof BidBookSchema>;
export type OrderBookBid = z.infer<typeof OrderBookBidSchema>;
export type OrderBookAsk = z.infer<typeof OrderBookAskSchema>;
export type OrderBookSide = z.infer<typeof OrderBookSideSchema>;
export type OrderBook = z.infer<typeof OrderBookSchema>;
export type CashResale = z.infer<typeof CashResaleSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type CashBalance = z.infer<typeof CashBalanceSchema>;
export type BusdcMintStatus = z.infer<typeof BusdcMintStatusSchema>;
export type BusdcMint = z.infer<typeof BusdcMintSchema>;
export type DepositConfig = z.infer<typeof DepositConfigSchema>;
export type DepositLiquidity = z.infer<typeof DepositLiquiditySchema>;
export type DepositVerification = z.infer<typeof DepositVerificationSchema>;
export type SolDepositQuote = z.infer<typeof SolDepositQuoteSchema>;
export type SolDepositVerification = z.infer<typeof SolDepositVerificationSchema>;
export type TransferDepositAsset = z.infer<typeof TransferDepositAssetSchema>;
export type TransferDepositQuote = z.infer<typeof TransferDepositQuoteSchema>;
export type TransferDepositVerification = z.infer<typeof TransferDepositVerificationSchema>;
export type WithdrawConfig = z.infer<typeof WithdrawConfigSchema>;
export type WithdrawalQuote = z.infer<typeof WithdrawalQuoteSchema>;
export type WithdrawalVerification = z.infer<typeof WithdrawalVerificationSchema>;
export type ShareCardKind = z.infer<typeof ShareCardKindSchema>;
export type ShareCardResponse = z.infer<typeof ShareCardResponseSchema>;
export type ShareRenderResponse = z.infer<typeof ShareRenderResponseSchema>;
export type MarketWsDelta = z.infer<typeof MarketWsDeltaSchema>;
