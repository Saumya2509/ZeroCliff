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
# public testnet
MODE=live RPC_URL=$TESTNET_RPC CHAIN_ID=<id> KEEPER_PRIVATE_KEY=0x… npm start
```

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

`test:anvil` runs against your own local anvil deployment and deploys nothing. It snapshots anvil, opens 30 paired positions, drops the price 20%, runs the keeper for 50 blocks and asserts that every position glided and no keeper transaction reverted. Then it reverts the snapshot, so your chain is left unchanged. It skips when there is no chain-31337 mock deployment.
