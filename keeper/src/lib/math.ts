// Pure selection, batching and arbitrage sizing. Unit-tested in test/unit.

export const WAD = 10n ** 18n;
export const H_COMFORT = 1_250_000_000_000_000_000n; // SoftLandingPool.H_COMFORT
export const NO_DEBT = 2n ** 256n - 1n; // healthOf() with zero debt
export const AMM_FEE_BPS = 30n; // MockAMM.FEE_BPS
const BPS = 10_000n;

export type HealthRead = { status: "success"; result: bigint } | { status: "failure"; error: unknown };

/** Soft Landing users worth poking: health below comfort (glide zone and below the floor alike). */
export function selectAtRisk<T>(users: T[], healths: HealthRead[]): T[] {
  return users.filter((_, i) => {
    const r = healths[i];
    return r?.status === "success" && r.result < H_COMFORT;
  });
}

/** Cliff ghosts a liquidation bot would hit: health below 1. */
export function selectLiquidatable<T>(users: T[], healths: HealthRead[]): T[] {
  return users.filter((_, i) => {
    const r = healths[i];
    return r?.status === "success" && r.result < WAD;
  });
}

/** Users whose debt is gone (healthOf returns max uint); the registry drops them. */
export function selectClosed<T>(users: T[], healths: HealthRead[]): T[] {
  return users.filter((_, i) => {
    const r = healths[i];
    return r?.status === "success" && r.result === NO_DEBT;
  });
}

export function chunk<T>(xs: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.ceil(Math.sqrt(Number(n)))) + 1n;
  while (x * x < n) x *= 2n;
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export type ArbTrade = { aToB: boolean; amountIn: bigint; spot: bigint; goal: bigint };

/**
 * Swap that moves an x·y = k pool (A = mETH, B = mUSD) a share `alphaBps` of the way from its spot price
 * to `target`, spending at most `budgetBps` of the mUSD reserve (or its mETH equivalent). Returns null
 * when the pool is already within `thresholdBps` of the target. Same maths as the Cascade Lab arbitrageur.
 */
export function arbSize(rA: bigint, rB: bigint, target: bigint, alphaBps: bigint, budgetBps: bigint, thresholdBps: bigint): ArbTrade | null {
  if (rA === 0n || rB === 0n || target === 0n) return null;
  const spot = (rB * WAD) / rA;
  const gap = spot > target ? spot - target : target - spot;
  if (gap * BPS <= target * thresholdBps) return null;

  const goal = (alphaBps * target + (BPS - alphaBps) * spot) / BPS;
  const k = rA * rB;
  const gross = (x: bigint) => (x * BPS) / (BPS - AMM_FEE_BPS);
  const capB = (rB * budgetBps) / BPS;
  if (goal > spot) {
    // pool too cheap: buy mETH with mUSD
    const rB2 = sqrt((k * goal) / WAD);
    if (rB2 <= rB) return null;
    const need = gross(rB2 - rB);
    return { aToB: false, amountIn: need < capB ? need : capB, spot, goal };
  }
  // pool too expensive: sell mETH for mUSD
  const rA2 = sqrt((k * WAD) / goal);
  if (rA2 <= rA) return null;
  const need = gross(rA2 - rA);
  const capA = (capB * WAD) / spot;
  return { aToB: true, amountIn: need < capA ? need : capA, spot, goal };
}

/** MockAMM.getAmountOut, for sizing and minOut. */
export function getAmountOut(amountIn: bigint, rIn: bigint, rOut: bigint): bigint {
  const withFee = amountIn * (BPS - AMM_FEE_BPS);
  return (withFee * rOut) / (rIn * BPS + withFee);
}
