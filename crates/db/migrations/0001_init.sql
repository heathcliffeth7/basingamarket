CREATE TABLE IF NOT EXISTS raw_events (
    id BIGSERIAL PRIMARY KEY,
    cluster TEXT NOT NULL,
    program_id TEXT NOT NULL,
    slot BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    instruction_index INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    canonical BOOLEAN NOT NULL DEFAULT TRUE,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cluster, slot, signature, instruction_index)
);

CREATE INDEX IF NOT EXISTS raw_events_program_slot_idx
    ON raw_events (cluster, program_id, slot);

CREATE TABLE IF NOT EXISTS indexer_cursors (
    cluster TEXT NOT NULL,
    program_id TEXT NOT NULL,
    latest_seen_slot BIGINT NOT NULL DEFAULT 0,
    safe_indexed_slot BIGINT NOT NULL DEFAULT 0,
    finalized_indexed_slot BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cluster, program_id)
);

CREATE TABLE IF NOT EXISTS markets (
    market_id BIGINT PRIMARY KEY,
    question_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'open', 'closed', 'resolved', 'cancelled')),
    outcome_count SMALLINT NOT NULL CHECK (outcome_count > 0),
    open_at BIGINT NOT NULL,
    trade_until BIGINT NOT NULL,
    winning_outcome SMALLINT,
    created_slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outcomes (
    market_id BIGINT NOT NULL REFERENCES markets (market_id) ON DELETE CASCADE,
    outcome_id SMALLINT NOT NULL,
    label TEXT NOT NULL,
    total_stake NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_reward_shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
    current_odds NUMERIC(78, 0) NOT NULL DEFAULT 0,
    PRIMARY KEY (market_id, outcome_id)
);

CREATE TABLE IF NOT EXISTS tickets (
    ticket_id BIGINT PRIMARY KEY,
    market_id BIGINT NOT NULL REFERENCES markets (market_id) ON DELETE CASCADE,
    outcome_id SMALLINT NOT NULL,
    original_caller TEXT NOT NULL,
    current_owner TEXT NOT NULL,
    stake_amount NUMERIC(78, 0) NOT NULL,
    reward_shares NUMERIC(78, 0) NOT NULL,
    entry_odds NUMERIC(78, 0) NOT NULL,
    cost_basis_usdc NUMERIC(78, 0) NOT NULL DEFAULT 0,
    settlement_value_usdc NUMERIC(78, 0),
    listed_price NUMERIC(78, 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'listed', 'claimable', 'claimed', 'lost', 'cancelled')),
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    confidence SMALLINT NOT NULL DEFAULT 0,
    mood SMALLINT NOT NULL DEFAULT 0,
    created_slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_market_owner_idx
    ON tickets (market_id, current_owner);

CREATE INDEX IF NOT EXISTS tickets_market_outcome_idx
    ON tickets (market_id, outcome_id);

CREATE TABLE IF NOT EXISTS ticket_listings (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    seller TEXT NOT NULL,
    price NUMERIC(78, 0) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('listed', 'sold', 'cancelled')),
    listed_slot BIGINT NOT NULL,
    sold_slot BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_listings_ticket_status_idx
    ON ticket_listings (ticket_id, status);

CREATE TABLE IF NOT EXISTS ticket_transfers (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    price NUMERIC(78, 0) NOT NULL,
    slot BIGINT NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS positions_history (
    id BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    market_id BIGINT NOT NULL REFERENCES markets (market_id) ON DELETE CASCADE,
    ticket_id BIGINT NOT NULL REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    outcome_id SMALLINT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS positions_history_wallet_created_idx
    ON positions_history (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS profiles (
    wallet_address TEXT PRIMARY KEY,
    display_name TEXT,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_balances (
    wallet_address TEXT PRIMARY KEY,
    cash_balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_trade_reservations (
    trade_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    released BOOLEAN NOT NULL DEFAULT FALSE,
    completed_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_trade_reservations_wallet_created_idx
    ON cash_trade_reservations (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_trades (
    signature TEXT PRIMARY KEY,
    trade_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    vault_token_account TEXT NOT NULL,
    market_id BIGINT NOT NULL DEFAULT 0,
    round_id BIGINT NOT NULL,
    position_lot TEXT NOT NULL,
    lot_id BIGINT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('UP', 'DOWN')),
    usdc_in NUMERIC(78, 0) NOT NULL,
    fee_usdc NUMERIC(78, 0) NOT NULL,
    net_usdc NUMERIC(78, 0) NOT NULL,
    tickets_out NUMERIC(78, 0) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_trades_wallet_created_idx
    ON cash_trades (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_deposits (
    signature TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    vault_token_account TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    slot BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('credited')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_deposits_wallet_created_idx
    ON cash_deposits (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_sol_deposit_quotes (
    quote_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    cash_amount NUMERIC(78, 0) NOT NULL,
    lamports BIGINT NOT NULL,
    price NUMERIC(78, 0) NOT NULL,
    treasury TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_sol_deposit_quotes_wallet_created_idx
    ON cash_sol_deposit_quotes (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_sol_deposits (
    signature TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    treasury TEXT NOT NULL,
    lamports BIGINT NOT NULL,
    cash_amount NUMERIC(78, 0) NOT NULL,
    price NUMERIC(78, 0) NOT NULL,
    slot BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('credited')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_sol_deposits_wallet_created_idx
    ON cash_sol_deposits (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_transfer_deposit_quotes (
    quote_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    asset TEXT NOT NULL CHECK (asset IN ('USDC', 'SOL')),
    cash_amount NUMERIC(78, 0) NOT NULL,
    transfer_amount NUMERIC(78, 0) NOT NULL,
    price NUMERIC(78, 0),
    destination TEXT NOT NULL,
    mint TEXT,
    reference TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_transfer_deposit_quotes_wallet_created_idx
    ON cash_transfer_deposit_quotes (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_transfer_deposits (
    signature TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    asset TEXT NOT NULL CHECK (asset IN ('USDC', 'SOL')),
    destination TEXT NOT NULL,
    transfer_amount NUMERIC(78, 0) NOT NULL,
    cash_amount NUMERIC(78, 0) NOT NULL,
    price NUMERIC(78, 0),
    slot BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('credited')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_transfer_deposits_wallet_created_idx
    ON cash_transfer_deposits (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_withdrawal_quotes (
    quote_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    destination_wallet TEXT NOT NULL,
    destination_token_account TEXT NOT NULL,
    cash_amount NUMERIC(78, 0) NOT NULL,
    message TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_user_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_withdrawal_quotes_wallet_created_idx
    ON cash_withdrawal_quotes (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS cash_withdrawals (
    vault_signature TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    destination_wallet TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    user_signature TEXT NOT NULL,
    mint TEXT NOT NULL,
    vault_token_account TEXT NOT NULL,
    destination_token_account TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_withdrawals_wallet_created_idx
    ON cash_withdrawals (wallet_address, created_at);

CREATE TABLE IF NOT EXISTS canvas_objects (
    market_id BIGINT NOT NULL REFERENCES markets (market_id) ON DELETE CASCADE,
    ticket_id BIGINT NOT NULL REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    radius INTEGER NOT NULL,
    avatar_url TEXT,
    mood SMALLINT NOT NULL DEFAULT 0,
    confidence SMALLINT NOT NULL DEFAULT 0,
    listed BOOLEAN NOT NULL DEFAULT FALSE,
    current_owner TEXT NOT NULL,
    original_caller TEXT NOT NULL,
    z_index INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (market_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS canvas_objects_market_z_idx
    ON canvas_objects (market_id, z_index);

CREATE TABLE IF NOT EXISTS payout_claims (
    ticket_id BIGINT PRIMARY KEY REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    claimer TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    slot BIGINT NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_snapshots (
    id UUID PRIMARY KEY,
    market_id BIGINT NOT NULL REFERENCES markets (market_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    svg_hash TEXT,
    png_url TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_cards (
    id UUID PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets (ticket_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    svg_hash TEXT,
    png_url TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,
    topic TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
