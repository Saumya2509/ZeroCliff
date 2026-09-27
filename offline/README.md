# Offline finale kit

Everything the Manali finale needs to run with **no internet**: a frozen local chain and the files that describe it.

| File | What it is |
|---|---|
| `state.json` | Frozen anvil chain: all contracts deployed with a mock oracle at 3,500, AMM liquidity, both pools funded, 40 paired test positions, keeper inventory |
| `deployments.json` | Addresses on that chain (the indexer, keeper and offline site read this, not `contracts/deployments/active.json`) |
| `seeded.json` | The 40 test wallets, so the site labels them "opened by the team for testing" |
| `*.log` | Output of the last `demo-offline` run (not committed) |

## Commands

```bash
node scripts/ops.mjs demo-offline    # chain (2 s blocks) + indexer + keeper + site, ~35 s
node scripts/ops.mjs demo-status     # what is up
node scripts/ops.mjs demo-stop       # stop all four (by port: 8545, 42069, 8081, 3000)

node scripts/ops.mjs offline-state   # rebuild state.json from scratch (deploy + seed on a fresh anvil)
node scripts/ops.mjs offline-build   # rebuild the offline site (demo-offline does this when needed)
```

With `make`, the same targets exist: `make demo-offline`, `make demo-stop`, and so on.

Each run starts from the same frozen state, so the demo is identical every time. The indexer rebuilds its database on start (a few seconds). The keeper runs with the Pyth pusher off and arbitrage every block, as a real market would.

## MetaMask

- Add a network: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH`.
- Import anvil's account #0 as **Demo Admin** (owns the mock oracle, can crash the price from `/admin`) and account #2 as **Demo Borrower**. These are anvil's public test keys, printed by every anvil; never use them anywhere real.
- After every restart, open MetaMask settings, then Advanced, then **Clear activity tab data**. Otherwise MetaMask keeps an old nonce and transactions hang.

## The demo crash

Step the price down from `/admin` rather than in one jump: for example 3,300, 3,100, 2,900, 2,700, 2,500, 2,275, about 25 seconds apart. Slices are only sold while the AMM is within 2% of the oracle (the manipulation guard), so a single huge jump makes the router wait for arbitrage before gliding.

In our rehearsal on this state, that crash gave 28 glide slices and 0 backstops, against 8 liquidations in the cliff pool, and Losses Avoided of +3.46 mETH (18 better, 0 worse, 22 unaffected). The indexer's pool totals matched `totalDebt` / `totalCollateral` on-chain to the wei.

## Rehearsal checklist (twice before 20 Nov, by two different people)

- [ ] Wi-Fi off completely
- [ ] `demo-offline` reports all four services up in under 60 s (33–44 s in rehearsal; up to ~75 s when the machine is busy, e.g. right after an offline build)
- [ ] Browser Network tab shows zero external requests
- [ ] Open a position as Demo Borrower, crash the price from `/admin` as Demo Admin, watch the glide on the altimeter and the ghost get liquidated
- [ ] `/simulate` replays all five crashes
- [ ] The Losses Avoided counter on the home page updates
- [ ] Deck PDF opens without internet
- [ ] Backup demo video plays from local disk
- [ ] Charger, power bank, HDMI and USB-C display adapters in the bag
- [ ] A second laptop (teammate) with the same setup, tested

## Pre-download before travelling

- `node scripts/ops.mjs install` at home: `node_modules` for web, indexer, keeper and sim, plus the Foundry submodules
- Foundry binaries (`foundryup`)
- Fonts are already self-hosted in `web/app/fonts`; crash data is in `web/public/crashes`
- Local copies of any docs you may need while building (Solidity, viem, Ponder)
