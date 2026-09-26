// Soft Landing maths, ported line for line from contracts/src/SoftLandingPool.sol.
// Integer (bigint) WAD maths with the same operation order, so results match the contract exactly.
// Verified against contracts/vectors/glide_*.json (see glide.test.ts). Shared with the simulator (05).

export const WAD = 10n ** 18n;
export const MAX_UINT = 2n ** 256n - 1n;

export const LT = 850_000_000_000_000_000n; // 0.85
export const H_OPEN = 1_400_000_000_000_000_000n; // 1.40
export const H_COMFORT = 1_250_000_000_000_000_000n; // 1.25
export const H_FLOOR = 1_020_000_000_000_000_000n; // 1.02
export const R_MAX = 5_000_000_000_000_000n; // 0.005 per block
export const N_MAX = 100n;
export const FEE = 1_000_000_000_000_000n; // 0.1%
export const BACKSTOP_SLIP_BPS = 500n;
export const CLIFF_CLOSE_FACTOR = 500_000_000_000_000_000n; // 50%
export const CLIFF_BONUS = 1_080_000_000_000_000_000n; // 8%

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Health = C·P·LT / D (WAD). MAX_UINT when there is no debt. */
export function health(c: bigint, d: bigint, price: bigint): bigint {
  if (d === 0n) return MAX_UINT;
  return ((c * price) / WAD) * LT / d;
}

/** Share of collateral sold per block at health h. `rMax` is overridable only for experiments (E5). */
export function glideRate(h: bigint, rMax: bigint = R_MAX): bigint {
  if (h >= H_COMFORT) return 0n;
  if (h <= H_FLOOR) return rMax;
  return (rMax * (H_COMFORT - h)) / (H_COMFORT - H_FLOOR);
}

/** Collateral to sell to bring health exactly back to comfort at the oracle price. */
export function sNeeded(c: bigint, d: bigint, price: bigint): bigint {
  const lhs = (H_COMFORT * d) / WAD;
  const rhs = ((c * price) / WAD) * LT / WAD;
  if (lhs <= rhs) return 0n;
  const denom = (price * ((H_COMFORT * (WAD - FEE)) / WAD - LT)) / WAD;
  return ((lhs - rhs) * WAD) / denom;
}

/** Collateral a poke sells after n blocks between floor and comfort. */
export function glideSlice(c: bigint, d: bigint, price: bigint, n: bigint, rMax: bigint = R_MAX): bigint {
  const h = health(c, d, price);
  if (h >= H_COMFORT || h < H_FLOOR) return 0n;
  if (n > N_MAX) n = N_MAX;
  const r = glideRate(h, rMax);
  let remaining = WAD;
  for (let i = 0n; i < n; i++) remaining = (remaining * (WAD - r)) / WAD;
  return min((c * (WAD - remaining)) / WAD, sNeeded(c, d, price));
}

/** Collateral the backstop sells (restores comfort at worst-case execution). ≥ c means close out. */
export function backstopSlice(c: bigint, d: bigint, price: bigint, slipBps = BACKSTOP_SLIP_BPS): bigint {
  const lhs = (H_COMFORT * d) / WAD;
  const rhs = ((c * price) / WAD) * LT / WAD;
  if (lhs <= rhs) return 0n;
  const execPrice = (((price * (10_000n - slipBps)) / 10_000n) * (WAD - FEE)) / WAD;
  const gain = (H_COMFORT * execPrice) / WAD;
  const loss = (price * LT) / WAD;
  if (gain <= loss) return MAX_UINT;
  const num = (lhs - rhs) * WAD;
  const den = gain - loss;
  return (num + den - 1n) / den; // Math.mulDiv(..., Ceil)
}

/** Landing Forecast: per-block health and collateral if a poke lands every block at a fixed price. */
export function previewPath(c: bigint, d: bigint, price: bigint, blocks: number) {
  const healthPath: bigint[] = [];
  const collateralPath: bigint[] = [];
  for (let i = 0; i < blocks; i++) {
    let h = health(c, d, price);
    if (h < H_COMFORT && h >= H_FLOOR) {
      const s = min((c * glideRate(h)) / WAD, sNeeded(c, d, price));
      const repayAmt = (((s * price) / WAD) * (WAD - FEE)) / WAD;
      c -= s;
      d = repayAmt >= d ? 0n : d - repayAmt;
      h = health(c, d, price);
    }
    healthPath.push(h);
    collateralPath.push(c);
  }
  return { healthPath, collateralPath };
}

/** What the cliff pool does to the same position at `price`: one liquidation, if H < 1. */
export function cliffOutcome(c: bigint, d: bigint, price: bigint) {
  const h = health(c, d, price);
  if (h >= WAD) return { liquidated: false, seized: 0n, repaid: 0n, collateralAfter: c, debtAfter: d };
  const repaid = (d * CLIFF_CLOSE_FACTOR) / WAD;
  const seized = min((repaid * CLIFF_BONUS) / price, c);
  return { liquidated: true, seized, repaid, collateralAfter: c - seized, debtAfter: d - repaid };
}

/** Apply a price shock in basis points (e.g. -2000 = −20%), as previewGlide does. */
export function shockPrice(price: bigint, shockBps: number): bigint {
  return (price * BigInt(10_000 + shockBps)) / 10_000n;
}
