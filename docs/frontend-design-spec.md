# BasingaMarket Frontend Design Spec

## North Star

BasingaMarket is a canvas-native crypto rounds terminal for Solana devnet.
The first screen should answer one question quickly:

```text
Which live crypto round is moving, and where is the crowd leaning?
```

The product should feel like a focused market terminal, not a generic crypto dashboard.
Avoid casino copy, oversized marketing sections, decorative blobs, and vague "true odds"
language. The UI should separate protocol/projected state from visual interpretation.

## Current Frontend Stack

- Next.js App Router.
- React + TypeScript.
- TanStack Query for API state and polling.
- Privy for wallet authentication.
- Solana devnet configuration from public env vars.
- Binance ticker stream for live price headers where available.
- Mock fallback data for demo continuity when API/devnet state is not ready.

The app lives in `apps/web`. The main runtime pages are:

- `/markets`
- `/markets/:marketId`
- `/tickets/:ticketId`
- `/profiles/:address`
- `/login`
- `/signup`
- `/styleguide`

## Product Scope

Initial market focus:

- BTC 5m.
- ETH 5m.
- SOL 5m.

The UI may show additional demo or future markets through mock fallback data, but production
language should keep the first live scope narrow.

Every market detail should expose:

- Asset and duration.
- Live round id/status.
- Time left or settlement state.
- Open price and now/close price.
- UP/DOWN visual capital.
- Buy intent and market/cash buy state.
- Ticket, listing, bid, instant-sell, claim, or refund state where available.
- Settlement source such as `Binance Spot ETHUSDT 5m`.
- Whether data is live, refetching, offline, or mock fallback.
- BUSDC balance and mint availability when a wallet is authenticated.

## Signal Language

Frontend-derived signals are UI interpretation, not financial truth.

Allowed labels:

- Crowd read.
- Crowd leans UP.
- Crowd leans DOWN.
- Visual capital.
- Time left.
- Settlement source.
- Claimable.
- Projection pending.
- MOCK FALLBACK ACTIVE.

Avoid labels:

- True odds.
- Official likelihood.
- Guaranteed signal.
- Canonical capital score.
- Alpha.
- Sure win.

## Core Screens

### Markets List

Frame: live round radar.

- Desktop: compact filters, search, live/refetching/offline status, and dense market rows/cards.
- Mobile: stacked market cards with quick status, price header, and UP/DOWN read.
- Each item shows asset, duration, current round, time left, open price, now or close price,
  crowd lean, UP/DOWN split, and settlement source.
- Filters should support movers, open, closing, resolved, and demo states.
- Mock fallback must stay visible when enabled.

### Market Detail

Frame: canvas-first live round.

- Header: asset, duration, round id, status, time left, open price, and now/locked close price.
- Main read: crowd lean, visual capital split, settlement source, and live/mock status.
- Canvas: UP/DOWN sentiment map derived from API projection or mock fallback data.
- Trading panel: UP/DOWN buy intent, BUSDC buy state, slippage, fee, and disabled states.
- Secondary controls: ticket listing, BUSDC bid/orderbook, cancel listing, buy listing, or instant sell
  where the current ticket/round state allows it.
- Activity/history should support scanning without overwhelming the canvas.

### Ticket Detail

Frame: position receipt.

- Shows ticket/lot id, market, round, side, owner/current owner, entry amount, ticket amount,
  status, listing status, claim/refund availability, and share-card render state.
- Actions should be explicit and state-aware: manage in market, render share card, list, cancel,
  buy listing, instant sell, claim, or refund.
- Any pending projection state should be visible instead of silently hidden.

### Profile Detail

Frame: wallet activity.

- Shows Solana wallet identity and copy affordance.
- Shows BUSDC balance, active tickets, claimable tickets, listings/bids where available, and
  recent market activity.
- Distinguish loading, API offline, projection pending, zero balance, and ready balance states.

### Auth And BUSDC Controls

- Login/signup use wallet authentication through Privy-backed Solana login helpers.
- Header BUSDC state should distinguish wallet loading, unauthenticated, API offline,
  projection pending, zero, and ready values.
- Authenticated headers should expose a `Mint BUSDC` action with daily-limit state.
- BUSDC mint state comes from `/profiles/:address/busdc-mint-status` and successful mints
  credit `/profiles/:address/cash`.
- Withdraw flows spend available BUSDC balance and must show quote, destination, latest
  withdrawal, and verification states.
- Buttons must disable while the required wallet, quote, signature, or projection data is missing.

### Resolved, Void, Empty, And Share States

- Resolved UP: winning UP marker and clear claim state.
- Resolved DOWN: winning DOWN marker and clear claim state.
- VOID: neutral/refund marker, visually distinct from either side winning.
- Empty live round: faint UP/DOWN territories and clear empty state.
- Mock fallback: `MOCK FALLBACK ACTIVE` remains visible.
- Share states: preparing, rendering, ready, and failed states are explicit.

## Canvas System

The React canvas layer should behave like a deterministic market read, even when the
underlying source is mock data.

Default simple layer model:

```text
MarketCanvas
  MarketBackground
  OutcomeRegion
  TicketClusterLayer
  SignalMarkerLayer
  TicketTooltip
  Accessible fallback content
```

Frontend code must not present UI-only coordinates, cluster radius, z-index, or signal
interpretation as canonical financial truth. The UI can derive a crowd read, but the
source of record remains API/onchain projection data.

Simple mode should show a small number of prominent ticket nodes per side. Remaining
activity can collapse into cluster counts.

## Trading UX

Buy flows should show:

- Side: UP or DOWN.
- BUSDC input.
- Estimated tickets.
- Price impact where available.
- Fee.
- Minimum tickets out or slippage protection.
- Settlement source.
- Whether the transaction is wallet-signed, cashier/devnet-assisted, mock, or unavailable.

Secondary market flows should show:

- Listing price.
- Bid price.
- Seller/buyer BUSDC balance impact.
- Fee.
- Minimum received or max paid where available.
- Disabled reasons for closed rounds, missing wallet, insufficient balance, stale projection,
  or unavailable devnet accounts.

Claim state must separate:

- Winner payout.
- Void refund.
- Already claimed.
- Not claimable.
- Projection pending.

## Accessibility

- Interactive tickets/nodes are keyboard-focusable when they expose actions.
- Focus exposes the same information as hover.
- Select works by pointer and keyboard.
- Canvas includes a screen-reader fallback list or nearby textual summary.
- Color is never the only status indicator.
- Motion respects `prefers-reduced-motion`.
- Mobile sheets/dialogs are keyboard and screen-reader accessible.
- Text maintains strong contrast on dark terminal surfaces.

## Acceptance Criteria

- `/markets` reads as a live crypto round radar, not a generic dashboard table.
- `/markets/:marketId` prioritizes the market read, price header, settlement source, and
  actionable trading state.
- Mock fallback is unmistakable when active.
- BUSDC balance, mint, withdraw, and secondary resale states do not imply real funds unless
  the API/devnet state confirms them.
- Every market detail exposes settlement source and live/offline/mock data status.
- Buy and resale screens show fee and slippage/minimum protections where applicable.
- VOID state is clearly different from resolved UP/DOWN.
