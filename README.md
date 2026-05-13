# BasingaMarket

BasingaMarket is a Solana devnet market prototype for protocol-owned crypto micro-rounds.
The first product is a fast UP / DOWN market terminal for short crypto rounds, starting
with BTC, ETH, and SOL.

The app is built for the Colosseum hackathon flow: judges should be able to read the
project shape quickly, run the local stack, and see which parts are live devnet work
versus mock/demo fallback.

## What It Does

- Creates protocol-owned crypto round markets on Solana.
- Tracks short BTC / ETH / SOL rounds with Binance Spot price context.
- Lets users browse market sentiment, inspect a live round, and manage tickets.
- Supports wallet-aware BUSDC balance, BUSDC minting, BUSDC trading, withdrawals, and
  secondary resale flows.
- Exposes mock fallback data when a devnet/API dependency is not available.

## Current Implementation

- `programs/basingamarket`: Anchor program for global config, market config, rounds,
  opening orders, position lots, listing/bid flows, settlement, claim, and fee withdrawal.
- `apps/api`: Axum HTTP/WebSocket API with in-memory projection storage and optional
  projection snapshot persistence at `.dev/projection-store.json`. The public app cash
  unit is BUSDC.
- `apps/web`: Next.js App Router frontend with React, TanStack Query, Privy auth, Solana
  devnet config, Binance live ticker updates, BUSDC mint/balance controls, and mock
  fallback states.
- `apps/admin`: Rust CLI for devnet config checks, crypto stream planning, Binance
  kline checks, round open/resolve planning, and PDA inspection.
- `apps/indexer`: fixture replay and custom indexer skeleton for projection work.
- `apps/worker`: background worker skeleton for render/reconciliation jobs.
- `crates/*`: shared Rust crates for auth, chain config, domain math, market data,
  projection storage, protocol events, realtime memory bus/cache, rendering, and tracing.

Production-grade PostgreSQL, NATS, Redis, and a dedicated automation service remain target
architecture pieces. The hackathon repo keeps the current devnet runtime clear instead of
claiming those pieces are required for local use.

## Tech Stack

- Solana devnet + Anchor Rust.
- Rust workspace with Axum API, admin CLI, indexer/worker skeletons, and domain crates.
- Next.js App Router + React + TypeScript.
- TanStack Query for API state.
- Privy for wallet authentication.
- Binance Spot market data for price headers and devnet settlement tooling.
- BUSDC for in-app cash, fresh buys, bids, listings, and resale settlement.

## BUSDC Flow

BasingaMarket uses BUSDC as the user-facing in-app cash unit. Authenticated users can
mint demo BUSDC into their app balance, then use that balance for round buys and
secondary resale actions.

Key API endpoints:

```text
GET  /profiles/{address}/cash
GET  /profiles/{address}/busdc-mint-status
POST /profiles/{address}/busdc-mints
```

The implementation still uses `SOLANA_CASH_*` env names for low-level devnet config,
but public product copy and UI state should refer to BUSDC.

## Local Development

Install the web dependencies first:

```bash
cd apps/web
npm --version # must be 11.14.1 or newer
npm run setup
```

The web package pins npm 11 and blocks install-time lifecycle scripts by default.
`npm run setup` installs from the lockfile with those protections, then runs the
repo-owned Privy patch explicitly.

Start the local full stack from the web package:

```bash
cd apps/web
npm run dev
```

Useful split commands:

```bash
cd apps/web
npm run dev:web
npm run dev:api
```

The web app defaults to Solana devnet and can use mock fallback data when the API or
devnet state is not ready. See `.env.example` and `apps/web/.env.example` for local
configuration names.

## Checks

Rust workspace:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Web package:

```bash
cd apps/web
npm run check
npm run test
```

## Public Repo Safety

Do not commit secrets or local runtime files. These must stay local:

- `.env`
- `.env.*` except `.env.example`
- `apps/web/.env.local`
- wallet keypairs
- RPC provider keys
- Privy secrets
- database URLs

Build outputs and local caches such as `target/`, `apps/web/.next/`, `apps/web/build/`,
and `apps/web/node_modules/` are also ignored.

## Public Docs

- `docs/frontend-design-spec.md`: current frontend and UX spec.
- `docs/runbooks/incident-playbook.md`: devnet-first incident checks.
- `docs/runbooks/projection-rebuild.md`: current snapshot rebuild flow and future
  production projection notes.
