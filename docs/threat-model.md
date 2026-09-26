# Threat model

Test references are in `contracts/test/`. A1–A7 are in `scenarios/AttackScenarios.t.sol` and I1–I7 in `invariant/Invariants.t.sol`.

| Asset | Actor | Threat | Mitigation | Status |
|---|---|---|---|---|
| User collateral | Attacker | Push the AMM price down, then poke to force a cheap sale | Oracle–AMM 2% band, oracle-based `minOut` | Tested (A1). The naive router loses the victim ~201 mUSD; the guarded router loses 0 |
| User collateral | Attacker | Stale or fake price | Pyth signature, 60 s max age, confidence ≤ 1%, exponent checks; `MockOracle.maxAge` for tests | Tested (A2, adapter unit tests) |
| User collateral | User | Withdraw to escape a pending glide | Every action settles the glide first | Tested (A3) |
| Protocol fees | Keeper | Poke spam to farm tips | Flat tip, only when the poke acted; `n == 0` after the first poke in a block | Tested (A4) |
| Pool solvency | Attacker | Reentrancy through a token hook | `nonReentrant` on every external entry point | Tested (A5) |
| Pool solvency | Market | Price gap larger than the glide can absorb | Backstop restores comfort; if impossible, closes out and records `badDebt` | Tested (A6, I1). Known limit |
| Accounting | Attacker | Rounding dust drain | Totals updated with exact amounts; SafeCast | Tested (A7, I2, I3, I6) |
| Fair execution | Searchers | Sandwich a slice | Slices are tiny and `minOut` is set from the oracle, which caps profit | Partially mitigated; documented |
| Fair execution | Market | Several backstops in one block cascade in the AMM | Backstop sells only what restores comfort, not the whole position; the band makes later slices wait for arbitrage | Found by I7; fixed; tested |
| Liveness | Keeper outage | No pokes, so the glide is delayed | Anyone can poke; every user action glides; accrual catches up (capped at 100 blocks) | Documented |
| Liveness | AMM off-band for a long time | Slices skip; health keeps falling | The backstop uses a wider band (10%) | Documented |
| Admin | Owner key | Swap in a malicious oracle or router | `Ownable2Step`; events on change | Known limit (roadmap: timelock) |
| Lenders | — | No lender withdrawals in the MVP | Testnet only; roadmap: ERC-4626 vault | Known limit |
