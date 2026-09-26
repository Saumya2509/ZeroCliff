// Block-by-block replay of a price path through Soft Landing rules and cliff rules, using the
// contract-verified maths in ./glide. Sales execute at the oracle price less the 0.1% fee: there is
// no AMM and no cascade feedback here. The full Cascade Lab (05) adds both.

import {
  backstopSlice,
  cliffOutcome,
  FEE,
  glideSlice,
  health,
  H_COMFORT,
  H_FLOOR,
  WAD,
} from "./glide";

export type ReplayPoint = {
  step: number;
  block: number;
  price: number; // mUSD per mETH
  soft: number; // mETH
  cliff: number; // mETH
  softEquity: number; // mUSD
  cliffEquity: number; // mUSD
  raw: { price: bigint; softC: bigint; softD: bigint; cliffC: bigint; cliffD: bigint };
};

export type ReplayResult = {
  points: ReplayPoint[];
  glides: number;
  backstops: number;
  liquidations: number;
  softBadDebt: bigint;
  cliffBadDebt: bigint;
};

const n = (x: bigint) => Number(x) / 1e18;

/**
 * @param path prices (whole mUSD) per step
 * @param blocksPerStep blocks between price updates; a keeper pokes / liquidates every block
 */
export function replay(path: number[], blocksPerStep: number, collateral: bigint, debt: bigint): ReplayResult {
  let sc = collateral;
  let sd = debt;
  let cc = collateral;
  let cd = debt;
  let glides = 0;
  let backstops = 0;
  let liquidations = 0;
  let softBadDebt = 0n;
  let cliffBadDebt = 0n;
  const points: ReplayPoint[] = [];

  let block = 0;
  for (let s = 0; s < path.length; s++) {
    const price = BigInt(Math.round(path[s] * 1e6)) * 10n ** 12n;
    for (let b = 0; b < blocksPerStep; b++) {
      block++;
      // soft: one poke per block
      if (sd > 0n) {
        const h = health(sc, sd, price);
        if (h < H_FLOOR) {
          let sell = backstopSlice(sc, sd, price);
          const closeOut = sell >= sc;
          if (closeOut) sell = sc;
          const repay = (((sell * price) / WAD) * (WAD - FEE)) / WAD;
          sc -= sell;
          if (repay >= sd) sd = 0n;
          else sd -= repay;
          if (closeOut && sd > 0n) {
            softBadDebt += sd;
            sd = 0n;
          }
          backstops++;
        } else if (h < H_COMFORT) {
          const sell = glideSlice(sc, sd, price, 1n);
          if (sell > 0n) {
            const repay = (((sell * price) / WAD) * (WAD - FEE)) / WAD;
            sc -= sell;
            sd = repay >= sd ? 0n : sd - repay;
            glides++;
          }
        }
      }
      // cliff: keeper liquidates whenever H < 1
      if (cd > 0n) {
        const out = cliffOutcome(cc, cd, price);
        if (out.liquidated) {
          cc = out.collateralAfter;
          cd = out.debtAfter;
          liquidations++;
          if (cc === 0n && cd > 0n) {
            cliffBadDebt += cd;
            cd = 0n;
          }
        }
      }
    }
    const p = n(price);
    points.push({
      step: s,
      block,
      price: p,
      soft: n(sc),
      cliff: n(cc),
      softEquity: n(sc) * p - n(sd),
      cliffEquity: n(cc) * p - n(cd),
      raw: { price, softC: sc, softD: sd, cliffC: cc, cliffD: cd },
    });
  }
  return { points, glides, backstops, liquidations, softBadDebt, cliffBadDebt };
}

/**
 * Stylised crash: −45% over ~50 minutes, then a partial recovery. Same shape as
 * contracts/test/scenarios/CrashScenario.t.sol. Illustrative, not historical data.
 */
export const STYLISED_CRASH = [
  3500, 3420, 3300, 3150, 3050, 2900, 2800, 2650, 2500, 2380, 2250, 2150, 2050, 1950, 1925, 2000, 2150, 2300, 2450,
  2550, 2650, 2700, 2750, 2800,
];

/** Linearly interpolate each price step into `sub` smaller steps (smoother charts and scrubbing). */
export function refinePath(path: number[], sub: number): number[] {
  return path.flatMap((p, i) => {
    const next = path[i + 1];
    if (next === undefined) return [p];
    return Array.from({ length: sub }, (_, k) => p + ((next - p) * k) / sub);
  });
}

/**
 * The one crash the site tells its story with (hero, story chart, /app preview): the stylised path
 * refined 5× with 12 blocks per sub-step, for a loan of 20,000 mUSD against 10 mETH. Sharing it keeps
 * every number on a page consistent.
 */
export const CANONICAL = { path: refinePath(STYLISED_CRASH, 5), blocksPerStep: 12 } as const;
export const canonicalRun = () => replay([...CANONICAL.path], CANONICAL.blocksPerStep, 10n * 10n ** 18n, 20_000n * 10n ** 18n);
