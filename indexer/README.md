# Soft Landing indexer

Ponder 0.17 indexer for the contracts (`md/manali/06-indexer-and-data.md`). It turns events into positions, glide and liquidation history, pool stats and price ticks, and serves the live **Losses Avoided** number. The database is the embedded PGlite, so it runs offline next to anvil. Set `DATABASE_URL` for Postgres.

## Run

Needs a deployment record at `../contracts/deployments/active.json` (addresses + `startBlock`). Until you deploy, the indexer refuses to start with a clear message.

```bash
npm install
cp .env.example .env.local      # RPC_URL for testnets; anvil (31337) defaults to 127.0.0.1:8545
npm run dev                     # http://localhost:42069
```

Then set `NEXT_PUBLIC_INDEXER_URL=http://localhost:42069` in `web/.env.local`.

## What is indexed

| Contract | Events |
|---|---|
| SoftLandingPool | Deposited, Withdrawn, Borrowed, Repaid, Glided, BackstopLiquidated, GlideSkipped, Refunded |
| CliffPool | Deposited, Withdrawn, Borrowed, Repaid, Liquidated, BadDebtRecorded |
| MockOracle | PriceSet (records a price tick) |
| every `PRICE_TICK_EVERY` blocks | oracle price (whatever the pool reads, mock or Pyth) and AMM spot |

Positions are rebuilt from signed deltas: every state change in the contracts emits one of these events, including the backstop's written-off shortfall and the cliff's bad debt.

## Endpoints

| Route | Returns |
|---|---|
| `GET /stats/losses-avoided` | `totalMeth`, `pairedUsers`, `usersBetter` / `usersWorse` / `usersEqual`, `seededUsers`, `price`, `asOfBlock`, `definition` |
| `GET /stats/pool` | pool rows (totals, glide / backstop / skip / liquidation counts, bad debt), `asOfBlock` |
| `GET /activity/:user?limit=50` | the user's positions and events, newest first (≤ 1,000) |
| `/graphql` | Ponder's GraphQL over every table |
| `/health`, `/ready`, `/status` | Ponder built-ins |

## Losses Avoided, exactly

For every user with both a Soft Landing position and a cliff ghost:

```
equity    = collateral − debt / price (+ refunded mUSD / price for Soft Landing), in mETH
advantage = equity(soft) − equity(cliff ghost), at the latest indexed oracle price
total     = Σ advantage (signed: users the glide did worse for are subtracted, not dropped)
```

Net equity, not collateral lost: a glide sells collateral but repays debt too, so counting collateral alone would exaggerate. |advantage| under 0.000001 mETH counts as equal. Wallets listed in `contracts/deployments/seeded.json` (written by `keeper/scripts/seed-activity.ts`) are counted in `seededUsers` so the site can label them. Tests: `npm test`.

## Not verified yet

The handlers and API typecheck against Ponder's generated types, and the Losses Avoided maths is unit-tested. The indexer has not yet been run against a live deployment, because none exists until you deploy. Start it against anvil after deploying, and check `/stats/pool` against the pool's on-chain `totalCollateral` / `totalDebt`.
