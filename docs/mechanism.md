# Soft Landing: mechanism

> Soft Landing shrinks a risky loan a little every block instead of seizing it all at once, which is only possible because onchain settlement is instant, atomic and runs 24/7.

All numbers are WAD fixed point (1e18 = 1.0). Both mock tokens use 18 decimals. Real USDC has 6: a production version would scale debt amounts by `10**(18 - decimals)` at the token boundary and keep all internal maths in WAD.

Code: [`contracts/src/SoftLandingPool.sol`](../contracts/src/SoftLandingPool.sol).

## Parameters

| Symbol | Meaning | Value |
|---|---|---|
| `LT` | Liquidation threshold | 0.85 |
| `H` | Health = `C·P·LT / D` | — |
| `H_open` | Minimum health to borrow or withdraw | 1.40 |
| `H_comfort` | Glide starts below this | 1.25 |
| `H_floor` | Backstop below this | 1.02 |
| `r_max` | Max share of collateral sold per block | 0.005 |
| `N_max` | Max blocks accrued in one poke | 100 |
| `fee` | Protocol fee on each slice | 0.001 |
| `tip` | Flat reward to the poke caller, paid from fees | 0.5 mUSD |

## Glide rate

```
r(H) = 0                                                  if H ≥ H_comfort
r(H) = r_max · (H_comfort − H) / (H_comfort − H_floor)     if H_floor ≤ H < H_comfort
```

## Slice per poke (`glideSlice`)

`n` blocks since the last glide, capped at `N_max`:

```
share     = 1 − (1 − r)^n              (loop of ≤ 100 multiplications, rounding down each step)
s_needed  = (H_comfort·D − C·P·LT) / (P·(H_comfort·(1−fee) − LT))
slice     = min(C·share, s_needed)
```

`s_needed` is the exact sale that brings health back to comfort if the slice executes at the oracle price. The constructor asserts `H_comfort·(1−fee) > LT`, so the denominator is positive.

**Known approximation:** the rate uses health at the start of a multi-block poke. Health improves as you sell, so this slightly over-sells. The `s_needed` cap removes that effect.

## Execution

Slices are sold through `SliceRouter` into the AMM:

- **Band:** the AMM spot price must be within 2% of the oracle, or the sale is skipped (not reverted). `lastGlideBlock` is left unchanged so the accrual carries into the next block.
- **Minimum output:** at least 98.5% of the oracle value (`MAX_SLIP_BPS = 150`).

Proceeds, less the 0.1% fee, repay debt. Anything left after the debt is fully repaid is refunded to the user.

## Backstop (health below floor)

A price gap can jump health straight below `H_floor`. The backstop sells only enough to **restore comfort**, sized for worst-case execution (5% below oracle, less the fee):

```
P_exec        = P · (1 − 0.05) · (1 − fee)
s_backstop    = (H_comfort·D − C·P·LT) / (H_comfort·P_exec − P·LT)      (rounded up)
```

If `s_backstop ≥ C`, the position can't be restored: all collateral is sold and the remaining debt is written off as `badDebt` (public, never hidden). There is no liquidation bonus at any point.

**Why not close the whole position?** Closing it all would re-create the cliff. The invariant suite showed this directly: with several positions backstopping in the same block, full closes dumped into the AMM one after another. The last one lost more to slippage than the cliff's 8% bonus would have taken (invariant I7, see [security.md](security.md)).

## Settlement rules

- `deposit`, `borrow`, `repay` and `withdraw` all settle the pending glide first, so no action can dodge it.
- `deposit` and `repay` catch a failing oracle and skip the glide. Actions that make a position safer always work.
- `borrow`, `withdraw` and `poke` revert if the oracle fails.
- `poke(user)` is permissionless. It pays the flat tip only when it acted, and only if accrued fees cover it. A second poke in the same block does nothing (`n == 0`).
- `pokeMany` handles at most 20 users and pays one tip per batch.

## Landing Forecast

`previewGlide(user, shockBps, blocks)` and `previewPath(c, d, price, blocks)` return the per-block health and collateral path, assuming a poke every block at a fixed price. They use the same `glideRate` and `sNeeded` as execution and ignore AMM slippage. A test checks that the forecast matches the real per-block path: collateral within 0.01%, health within 0.5%.

## CliffPool (baseline)

Same `LT`, same `H_open`, same accounting. When `H < 1.0`, anyone can repay up to 50% of the debt and receive collateral worth `repay × 1.08`. If the collateral runs out, the remaining debt becomes `badDebt`.
