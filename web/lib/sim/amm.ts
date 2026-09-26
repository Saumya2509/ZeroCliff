// Mirrors contracts/src/mocks/MockAMM.sol (constant product, 0.30% fee). Verified by engine.test.ts
// against vectors exported from the real contract.

import { WAD } from "./glide";

export const AMM_FEE_BPS = 30n;

export type Amm = { rA: bigint; rB: bigint }; // rA = mETH, rB = mUSD

export function getAmountOut(amountIn: bigint, rIn: bigint, rOut: bigint): bigint {
  const inWithFee = amountIn * (10_000n - AMM_FEE_BPS);
  return (inWithFee * rOut) / (rIn * 10_000n + inWithFee);
}

/** mUSD per mETH, WAD. */
export function spotPrice(a: Amm): bigint {
  return (a.rB * WAD) / a.rA;
}

/** Sell mETH for mUSD. Returns 0 (and changes nothing) where the contract would revert. */
export function swapAForB(a: Amm, amountIn: bigint, minOut = 0n): bigint {
  if (amountIn === 0n || a.rA === 0n || a.rB === 0n) return 0n;
  const out = getAmountOut(amountIn, a.rA, a.rB);
  if (out < minOut || out === 0n) return 0n;
  a.rA += amountIn;
  a.rB -= out;
  return out;
}

/** Sell mUSD for mETH. Returns 0 (and changes nothing) where the contract would revert. */
export function swapBForA(a: Amm, amountIn: bigint, minOut = 0n): bigint {
  if (amountIn === 0n || a.rA === 0n || a.rB === 0n) return 0n;
  const out = getAmountOut(amountIn, a.rB, a.rA);
  if (out < minOut || out === 0n) return 0n;
  a.rB += amountIn;
  a.rA -= out;
  return out;
}

export function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // Newton from an overestimate converges monotonically down to floor(sqrt(n)).
  let x = BigInt(Math.ceil(Math.sqrt(Number(n)))) + 1n;
  while (x * x < n) x *= 2n;
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
