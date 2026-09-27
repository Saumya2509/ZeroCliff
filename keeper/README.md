# Soft Landing keeper

Keeper bot for `md/manali/07-keeper-bot.md`. The keeper is a convenience, not a trust assumption: anyone can call `poke`, every user action glides on its own, and accrual catches up after a gap of up to 100 blocks. If the keeper dies, the protocol still works, just less smoothly.

## Jobs (each toggleable)

| Job | Does | When |
|---|---|---|
| Glider | reads `healthOf` for every known Soft Landing borrower in one round trip; pokes those below 1.25 with `pokeMany` (≤ 20 per tx) | every block |
| Oracle pusher | fetches a signed Pyth update from Hermes and submits it through the adapter | live mode on a Pyth deployment: before pokes, and every 30 s |
| Ghost liquidator | liquidates cliff positions below health 1 (50% of debt) and dumps the seized mETH into the AMM, like a real bot | every block |
| Arbitrageur | moves the AMM 30% of the way back to the oracle, spending ≤ 2% of the mUSD reserve (the Cascade Lab's settings) | every 3 blocks |

Rules from the brief:
- It simulates every transaction before sending, and never sends one that would revert.
- It uses one key and a serialised nonce manager that resyncs after a failure.
- Receipts are tracked in the background. A block is skipped while earlier transactions are still pending.

Borrowers come from `Borrowed` events (backfilled from `startBlock`, then watched), and debt-free users are dropped.

## Run

Needs a deployment record (`../contracts/deployments/active.json`). The keeper wallet needs gas, plus mETH and mUSD if the arbitrageur and ghost liquidator are on.

```bash
npm install
# local / offline (anvil; Pyth pusher off). Anvil must produce blocks, e.g. `anvil --block-time 2`.
MODE=offline RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 KEEPER_PRIVATE_KEY=0x… npm start
# public testnet (the oracle pusher needs a Pyth API key, see below)
MODE=live RPC_URL=$TESTNET_RPC CHAIN_ID=<id> KEEPER_PRIVATE_KEY=0x… PYTH_API_KEY=… npm start
```

**Pyth API key.** Since the Pyth Core upgrade (26 August 2026), Hermes serves signed price updates only with an API key, from Pyth Terminal (free trial, then paid). The keeper sends it as `Authorization: Bearer` to `https://pyth.dourolabs.app/hermes`. On Base Sepolia, Pyth's own pushes of ETH/USD were about 4 minutes apart when we checked, while the adapter accepts prices at most 60 s old. So the pusher, and therefore the key, is required there. Without a key the keeper warns at start-up.

All settings are in `.env.example`. Logs are JSON (pino) with `job`, `block`, `count` and `hash`. Every 60 s a summary prints blocks seen and skipped, pokes, router skips, liquidations, arb swaps and the gas balance, with a warning below `LOW_GAS_ETH`. `GET :8081/health` returns the last processed block (503 until the first one). A `Dockerfile` is included for Railway, Render or a VPS.

## Seeding test activity (06 §8)

```bash
SEED_PRIVATE_KEY=0x…(owner of the mocks) RPC_URL=… CHAIN_ID=… npm run seed             # 40 paired positions
SEED_PRIVATE_KEY=0x… RPC_URL=… CHAIN_ID=… npm run seed -- --crash                      # then walk the mock oracle down 2% × 10
```

This opens a Soft Landing position and a cliff ghost with the same amounts from generated burner wallets, with opening health from 1.40 to 1.90. It deploys nothing. The burner addresses go to `contracts/deployments/seeded.json`, which the indexer counts and the home page labels ("Includes N positions opened by the team for testing"). The keys stay in the gitignored `.seed-keys.json`.

## Tests

```bash
npm test            # selectAtRisk (1.30 / 1.25 / 1.24 / 1.01), chunk ≤ 20, arbSize (α and budget), config parsing
npm run typecheck
ANVIL_TEST=1 OWNER_PRIVATE_KEY=0x… npm run test:anvil
```

`test:anvil` runs against a local deployment and deploys nothing. It needs a chain with no other keeper running, because two keepers would compete for the same positions. The frozen demo chain works:

```bash
anvil --load-state ../offline/state.json --block-time 2          # in another terminal
ANVIL_TEST=1 OWNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   DEPLOYMENTS_PATH=../offline/deployments.json npm run test:anvil
```

(That key is anvil's public account #0, the owner of the demo mocks.) The test snapshots anvil and opens 30 paired positions with instant mining. It then crashes the price 20% and runs the keeper for 50 real 1-second blocks, asserting that every position glided and no keeper transaction reverted. Finally it reverts the snapshot and restores the chain's mining mode, leaving the chain as it was. It skips when there is no chain-31337 mock deployment. Last run: 30 of 30 glided, 0 reverted.

In the offline demo (`node scripts/ops.mjs demo-offline`) the keeper arbitrages every block (`ARB_EVERY_BLOCKS=1`). Every 3 blocks lets a stepped crash outrun the pool, so the router refuses every slice and the demo shows no glide.
