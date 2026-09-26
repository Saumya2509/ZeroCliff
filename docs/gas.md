# Gas

Measured by `contracts/test/experiments/GasReport.t.sol` with every call run as its own transaction (cold storage):

```
cd contracts && WRITE_GAS=1 forge test --mc GasReportTest --isolate -vv
```

Output: `contracts/results/gas.json`.

| Action | Gas |
|---|---|
| `poke`, glide with 1 block accrued | 199,997 |
| `poke`, glide with 100 blocks accrued | 209,945 |
| `poke`, healthy user (nothing to do) | 44,798 |
| `pokeMany`, 20 users all gliding | 2,032,352 (~101,600 per user) |
| `borrow` | 84,322 |
| `CliffPool.liquidate` | 108,415 |

Notes:

- The 100-block accrual loop adds only ~10k gas over a 1-block poke. Most of a glide's cost is the AMM sale (two token transfers and the reserve updates).
- Batching roughly halves the per-user cost of a glide.
- To convert to cost on the chosen L2, multiply by the chain's gas price at the time and **label the result as an estimate**. Chain choice and deployment are left for later.
