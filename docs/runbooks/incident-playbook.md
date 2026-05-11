# Incident Playbook

This playbook is written for the current hackathon/devnet runtime. Production-only pieces
such as PostgreSQL, NATS, Redis, and a dedicated always-on automation service are called out
separately when relevant.

## Quick Triage

1. Check the API:

   ```bash
   curl http://127.0.0.1:8080/health/live
   curl http://127.0.0.1:8080/health/ready
   curl http://127.0.0.1:8080/chain/status
   ```

2. Check the web app environment:

   ```bash
   cd apps/web
   npm run check
   ```

3. Check local projection state:

   ```bash
   ls -lh .dev/projection-store.json
   ```

4. Confirm public env values are devnet-only and secrets are not committed.

## API Offline

- Start the Rust API directly:

  ```bash
  cd apps/web
  npm run dev:api
  ```

- Confirm `API_BIND_ADDR` is not pointing at an unexpected host/port.
- Check whether `.dev/projection-store.json` is malformed or stale; move it aside only after
  saving a copy.
- If the frontend is still usable through mock fallback, keep the `MOCK` badge visible.

## Web App Offline

- Start the web app directly:

  ```bash
  cd apps/web
  npm run dev:web
  ```

- Confirm `NEXT_PUBLIC_API_BASE_URL` points to `/api/backend` for local proxy use.
- Confirm `API_INTERNAL_BASE_URL` points to the local Axum API.
- Run `npm run check` before changing UI code.

## Devnet Chain Config Issue

- Run:

  ```bash
  cargo run -p basingamarket-admin -- config-check
  ```

- Confirm the cluster is `devnet`.
- Confirm program id, BUSDC mint config, vault, fee vault, and cashier/admin values are set
  only through local env files. Low-level env names still use the `SOLANA_CASH_*` prefix.
- Use `cargo run -p basingamarket-admin -- devnet-pdas --market-id <id> --round-id <id>`
  to inspect expected PDA addresses.

## Round Or Settlement Issue

- Check the stream plan:

  ```bash
  cargo run -p basingamarket-admin -- crypto-streams --phase 1
  cargo run -p basingamarket-admin -- crypto-round-plan --phase 1 --now-ts <unix_ts>
  ```

- Check Binance source data:

  ```bash
  cargo run -p basingamarket-admin -- binance-kline --symbol SOLUSDT --interval 5m --start-ts <round_start_ts>
  ```

- Do not force a resolve with an unverified price. Binance Spot kline data is the current
  settlement reference for devnet tooling.
- If a market looks wrong in the UI, compare API market, curve, rounds, and canvas endpoints
  before changing projection data.

## Projection Mismatch

- Preserve `.dev/projection-store.json` before modifying it.
- Compare:

  ```bash
  curl http://127.0.0.1:8080/markets
  curl http://127.0.0.1:8080/markets/<id>
  curl http://127.0.0.1:8080/markets/<id>/curve
  curl http://127.0.0.1:8080/markets/<id>/rounds
  curl http://127.0.0.1:8080/markets/<id>/canvas
  ```

- Rebuild using the projection rebuild runbook if the snapshot is inconsistent.
- If fixture behavior is the target, run:

  ```bash
  cargo run -p basingamarket-indexer -- replay-fixture
  ```

## BUSDC Mint Or Balance Issue

- Check BUSDC profile balance and mint status:

  ```bash
  curl http://127.0.0.1:8080/profiles/<wallet>/cash
  curl http://127.0.0.1:8080/profiles/<wallet>/busdc-mint-status
  ```

- Test the authenticated mint path from the UI with the `Mint BUSDC` button, or call the
  API with a valid Privy session token:

  ```bash
  POST http://127.0.0.1:8080/profiles/<wallet>/busdc-mints
  ```

- If vault-backed devnet rails are involved, check internal config and liquidity separately:

  ```bash
  curl http://127.0.0.1:8080/deposit/config
  curl http://127.0.0.1:8080/deposit/liquidity
  ```

- Keep wallet loading, API offline, projection pending, zero BUSDC, limit hit, and ready
  BUSDC states visually distinct in the frontend.
- Never patch local snapshots to hide a failed BUSDC mint, trade, or transfer; preserve the
  request/signature context and repair through the API/admin flow.

## BUSDC Withdraw Issue

- Check withdraw config:

  ```bash
  curl http://127.0.0.1:8080/withdraw/config
  ```

- Check latest withdrawal:

  ```bash
  curl http://127.0.0.1:8080/profiles/<wallet>/withdrawals/latest
  ```

- Confirm the destination wallet is a normalized Solana pubkey.
- Confirm the BUSDC projection has sufficient available balance before retrying.

## Secondary Market Issue

- Check ticket, orderbook, and bids:

  ```bash
  curl http://127.0.0.1:8080/tickets/<ticket_id>
  curl http://127.0.0.1:8080/rounds/<round_id>/orderbook
  curl http://127.0.0.1:8080/rounds/<round_id>/bids
  ```

- Confirm the ticket is still transferable/listable for the round state.
- Confirm seller and buyer BUSDC balances are current before retrying buy-listing or instant-sell.

## Render Or Share Card Issue

- Inspect worker/API logs for the `share_card_id` or `ticket_id`.
- Confirm ticket and market data exist before retrying render.
- Keep failed render state visible in the UI.
- Production target: retryable render jobs should move through a durable queue.

## RPC Outage

- Confirm the configured devnet RPC and WebSocket URLs.
- Use public Solana devnet only for local hackathon demos unless a provider key is configured
  in local env.
- If provider responses are inconsistent, pause devnet automation scripts and keep the UI in
  mock fallback or read-only mode.

## Production Target Notes

- PostgreSQL should become the canonical projection store for production.
- NATS should carry durable deltas and worker jobs.
- Redis should be treated only as hot cache/rate-limit state.
- A dedicated automation service should expose round-open, round-resolve, and settlement-source
  health metrics.
- Production incident response should track indexer lag, settlement fetch errors, vault mismatch,
  API 5xx, render failure rate, and RPC provider health.
