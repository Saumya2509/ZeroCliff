# Soft Landing

**A lending pool that sells at most 0.5% of a risky loan's collateral per block, instead of liquidating half of it at once with a bonus.**

Hack in Hills '26 · Track 3: Onchain Finance & Trading · testnet only

> Soft Landing shrinks a risky loan a little every block instead of seizing it all at once, which is only possible because onchain settlement is instant, atomic and runs 24/7.

## The problem

Onchain lending works on a cliff. A loan is safe, safe, safe, and then in one block it crosses a threshold. A liquidator repays up to half the debt and takes that much collateral plus a bonus. In a crash, many loans hit the cliff together. The forced sales push the price down further, which pushes more loans over, and borrowers lose far more than their actual shortfall.

## The mechanism

| Health (collateral × price × 0.85 ÷ debt) | What happens |
|---|---|
| above 1.25 | Nothing is sold. |
| 1.02 – 1.25 | **Glide:** each block, a small slice of collateral (up to 0.5%, growing as health falls) is sold through an AMM and repays debt, never more than needed to get back to 1.25. |
| below 1.02 | **Backstop:** after a sudden gap, sell what restores 1.25 in one step. Anything unrecoverable is recorded as bad debt. |

A slice is only sold if the AMM agrees with the oracle to within 2%, so a manipulated pool can't be used against the borrower. Anyone can call `poke()` to run the next slice; every user action glides too. The keeper bot is a convenience, not a trust assumption. Full maths: [docs/mechanism.md](docs/mechanism.md).

## Results

Every figure below is produced by a script. The sources are linked; nothing is typed in by hand.

**Real crashes** ([web/public/results/e2.json](web/public/results/e2.json), `sim/cli.ts`). ETH/USDT 1-minute candles from the Binance public data archive, 200 simulated borrowers, the same loans in both pools, β = 0.3. Value kept = collateral at market minus debt, as a share of starting equity:

| Crash | Soft Landing | Cliff pool |
|---|---|---|
| 12–13 March 2020 | 22.5% | 3.5% |
| 19 May 2021 | 36.4%, nobody wiped out | 12.4%, 50 wiped out |
| 10–19 June 2022 | 23.3% | 7.1% |
| 4–5 August 2024 | 61.3% | 58.6% |

Where it looks worse, we say so. In a choppy market, and in the mildest crash, Soft Landing sells *more* ETH than the cliff pool; borrowers still keep more value because no bonus is paid. Deeper liquidity barely narrows the gap. All seven experiments, including those, are on the site's `/simulate` page.

**Contracts** ([contracts/results](contracts/results), [web/lib/results.json](web/lib/results.json)):
- 67 tests pass: unit, fuzz, attack scenarios and crash replay.
- 7 of 7 invariants hold over 400,000 random calls each, including solvency, "never glides above 1.25" and "a glide loses less than the cliff when no backstop fired".
- Selling 20 mETH in 40 slices costs 0.34% against the oracle price, vs 2.24% as one dump into the same pool.
- Pool-manipulation attack A1 costs the victim 0 mUSD with the price guard, vs 201 mUSD without it.
- The TypeScript simulator matches the contracts on 150 of 150 test vectors exported from them.

## Repository

| Path | What it is |
|---|---|
| [contracts/](contracts) | Solidity 0.8.24 + Foundry: `SoftLandingPool`, `CliffPool` (the comparison), `SliceRouter`, `PythOracleAdapter`, mocks, tests, invariants, attack scenarios, gas and slippage experiments |
| [web/](web) | Next.js 16 app: landing page, the dApp (health altimeter, ghost chart, landing forecast), Cascade Lab crash simulator, transparency page |
| [sim/](sim) | Cascade Lab CLI: downloads the historical crashes and runs experiments E1–E7 with the same engine as the site |
| [indexer/](indexer) | Ponder indexer: positions, glides, liquidations, price ticks, and the live Losses Avoided number |
| [keeper/](keeper) | Keeper bot: glider, Pyth oracle pusher, ghost liquidator, arbitrageur, and the test-activity seed script |
| [docs/](docs) | Mechanism, threat model, security review, gas report |
| [scripts/](scripts) | ABI export and results collection |

## Run it

Requirements: Node 20+, [Foundry](https://book.getfoundry.sh/).

```bash
git clone --recurse-submodules <this repo>

# contracts: build and test
cd contracts && forge build && forge test

# website (works before any deployment: the simulator and pages run in the browser)
cd web && npm install && npm run dev          # http://localhost:3000

# crash experiments
cd sim && npm install && npm run sim          # writes web/public/results/*.json
```

The indexer and keeper need a deployment record at `contracts/deployments/active.json`. Each folder's README covers its setup and configuration, and every package has a `.env.example`.

## Status

- Testnet and local only. Test tokens have no value. Not financial advice.
- Known limits are listed on the site's How it works page and in [docs/threat-model.md](docs/threat-model.md).
