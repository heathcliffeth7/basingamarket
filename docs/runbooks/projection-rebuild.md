# Projection Rebuild Runbook

This runbook covers the current devnet/local projection flow first. The API uses an
in-memory projection store and can persist a snapshot at `.dev/projection-store.json`.
Production database/event-bus steps are listed separately at the end.

## Current Devnet Snapshot Flow

1. Stop the API process so it cannot write a new snapshot while you inspect state.
2. Preserve the current snapshot:

   ```bash
   mkdir -p .dev/backups
   cp .dev/projection-store.json ".dev/backups/projection-store.$(date +%Y%m%d-%H%M%S).json"
   ```

3. If the file is missing, empty, or intentionally reset, start the API and let it create a
   fresh projection snapshot.
4. If fixture replay is the desired baseline, run:

   ```bash
   cargo run -p basingamarket-indexer -- replay-fixture
   ```

5. Restart the API:

   ```bash
   cd apps/web
   npm run dev:api
   ```

6. Verify health and chain status:

   ```bash
   curl http://127.0.0.1:8080/health/ready
   curl http://127.0.0.1:8080/chain/status
   ```

7. Verify public read endpoints:

   ```bash
   curl http://127.0.0.1:8080/markets
   curl http://127.0.0.1:8080/markets/<id>
   curl http://127.0.0.1:8080/markets/<id>/curve
   curl http://127.0.0.1:8080/markets/<id>/rounds
   curl http://127.0.0.1:8080/markets/<id>/canvas
   ```

8. Start the web app and confirm the UI no longer shows stale projection state:

   ```bash
   cd apps/web
   npm run dev:web
   ```

## When To Reset Instead Of Repair

Reset local projection state only when:

- The snapshot is test/demo data.
- No real devnet signatures need to be preserved.
- You have copied the old snapshot into `.dev/backups/`.
- The UI can clearly show mock fallback while projection state is rebuilt.

Do not edit BUSDC balances, BUSDC mint history, withdrawals, ticket ownership, listings,
bids, or resale records by hand to hide a failed transaction. Preserve the request/signature
context and repair through API/admin flows.

## Production Target Flow

When PostgreSQL/NATS/Redis are enabled for production, the rebuild flow should be:

1. Pause indexer writes for the affected program and cluster.
2. Confirm canonical raw events cover the intended slot range.
3. Snapshot current projection tables.
4. Truncate only derived projection tables, not raw event history.
5. Replay canonical raw events ordered by slot, signature, instruction index, and event index.
6. Recompute market signals, BUSDC balances, mint history, secondary resale state, and
   canvas projections from rebuilt round/ticket state.
7. Recompute the indexer cursor from the highest replayed canonical slot and last signature.
8. Flush Redis cache keys for the affected version/prefix.
9. Publish reconciliation deltas through the durable event bus.
10. Resume indexer writes.
11. Watch indexer lag, round open/resolve delay, API 5xx, settlement errors, and render failures.
