import { BACKSTOP_SLIP_BPS, backstopSlice, cliffOutcome, FEE, H_COMFORT, H_FLOOR, health, previewPath, WAD } from "./glide";

// Landing Forecast outcome at an already-shocked price. previewPath (and the contract's previewGlide)
// model only the glide; below the floor the backstop acts instead, so that case is handled here.

type Path = { healthPath: bigint[]; collateralPath: bigint[] };

export type Forecast = {
  kind: "safe" | "glide" | "backstop";
  shockedHealth: bigint;
  path: Path;
  final: bigint;
  sold: bigint;
  closeOut: boolean;
  settleBlocks: number;
  cliff: ReturnType<typeof cliffOutcome>;
  source: "contract" | "estimate";
  /** Value (mUSD, WAD) the unwind takes that does NOT go toward the user's debt. */
  cost: { soft: bigint; cliff: bigint };
};

const BPS = 10_000n;

/** Cliff: collateral value seized minus debt repaid (the 8% bonus). */
function cliffCost(cliff: ReturnType<typeof cliffOutcome>, price: bigint) {
  return cliff.liquidated ? (cliff.seized * price) / WAD - cliff.repaid : 0n;
}

export function forecastLanding(c: bigint, d: bigint, price: bigint, blocks: number, fromChain?: Path): Forecast {
  const cliff = cliffOutcome(c, d, price);
  const source = fromChain ? "contract" : "estimate";
  const shockedHealth = health(c, d, price);

  if (d > 0n && shockedHealth < H_FLOOR) {
    // sells, at most, what restores 1.25 at worst-case execution, in one step; everything if it can't
    const s = backstopSlice(c, d, price);
    const closeOut = s >= c;
    const after = closeOut ? 0n : c - s;
    const path = { healthPath: Array<bigint>(blocks).fill(shockedHealth), collateralPath: Array<bigint>(blocks).fill(after) };
    const sold = c - after;
    // worst case: executes BACKSTOP_SLIP_BPS below the oracle, then the 0.1% fee
    const value = (sold * price) / WAD;
    const received = (((value * (BPS - BACKSTOP_SLIP_BPS)) / BPS) * (WAD - FEE)) / WAD;
    const cost = { soft: value - received, cliff: cliffCost(cliff, price) };
    return { kind: "backstop", shockedHealth, path, final: after, sold, closeOut, settleBlocks: 1, cliff, source, cost };
  }

  const path = fromChain ?? previewPath(c, d, price, blocks);
  const final = path.collateralPath[path.collateralPath.length - 1] ?? c;
  const settleIdx = path.collateralPath.findIndex((x) => x === final);
  const kind = shockedHealth >= H_COMFORT || final === c ? "safe" : "glide";
  const sold = c - final;
  // glide at the oracle price: the 0.1% fee (the forecast ignores AMM slippage, as labelled)
  const cost = { soft: (((sold * price) / WAD) * FEE) / WAD, cliff: cliffCost(cliff, price) };
  return { kind, shockedHealth, path, final, sold, closeOut: false, settleBlocks: settleIdx + 1, cliff, source, cost };
}
