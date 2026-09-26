// Cascade Lab step loop (05-crash-simulator.md §3). Runs a population of borrowers through a price
// path twice: once under cliff liquidation, once under Soft Landing, each with its own identical AMM.
// Every unwind goes through the contract-mirroring functions in ./pools, ./router and ./amm.

import { spotPrice, sqrt, swapAForB, swapBForA, type Amm, AMM_FEE_BPS } from "./amm";
import { health, LT, N_MAX, R_MAX, WAD } from "./glide";
import { liquidateCliff, poke, type Position } from "./pools";

export type Crash = {
  id: string;
  label: string;
  source: string;
  interval_seconds: number;
  start: string | null;
  prices: number[];
};

export type SimParams = {
  /** Number of borrowers. */
  users: number;
  /** Opening health spread; `skew` > 1 puts more borrowers near `hMin` (riskier). */
  hMin: number;
  hMax: number;
  skew: number;
  /** Share of price discovery in the pool being sold into: oracle = β·amm + (1−β)·market. */
  beta: number;
  /** Fraction of the gap to the market price the arbitrageur closes each step. */
  alpha: number;
  /** Arbitrage budget per step, as a share of the pool's mUSD reserve. */
  arbBudget: number;
  /** AMM depth: mETH reserve = total borrower collateral × liquidity. */
  liquidity: number;
  /** Blocks per candle (default: interval / 2 s). */
  blocksPerStep?: number;
  /** Max glide per block in basis points (contract: 50 = 0.5%). Experiments only. */
  rMaxBps?: number;
};

export const DEFAULT_PARAMS: SimParams = {
  users: 200,
  hMin: 1.3,
  hMax: 2.0,
  skew: 2,
  beta: 0,
  alpha: 0.3,
  arbBudget: 0.02,
  liquidity: 1,
  rMaxBps: 50,
};

export type Snapshot = {
  t: number;
  market: number;
  oracleSoft: number;
  oracleCliff: number;
  ammSoft: number;
  ammCliff: number;
  softCollateral: number; // total mETH held by borrowers
  cliffCollateral: number;
  softEquity: number; // total collateral value − debt (+ refunds), mUSD at market
  cliffEquity: number;
  liquidations: number; // cumulative
  glides: number;
  backstops: number;
};

export type DesignSummary = {
  collateralLostPerUserEth: number;
  collateralLostPerUserUsd: number; // valued at the final market price (spec §6)
  valueKeptPerUser: number; // final collateral × final price − final debt (+ refunds), mUSD
  valueKeptPct: number; // of the average starting equity
  cascadeDepthPct: number; // extra drop of the oracle below the market low, % of start price
  slippageUsd: number; // Σ (oracle value − proceeds) over all sales
  events: number; // liquidations (cliff) or glide slices + backstops (soft)
  backstops: number;
  skips: number;
  badDebtUsd: number;
  wiped: number; // users with zero collateral at the end
};

export type SimResult = {
  crash: { id: string; label: string; source: string; interval_seconds: number; steps: number };
  params: Required<SimParams>;
  startPrice: number;
  /** Total equity of all borrowers at the opening price (collateral value − debt), mUSD. */
  startEquity: number;
  marketLowPct: number;
  snapshots: Snapshot[];
  soft: DesignSummary;
  cliff: DesignSummary;
};

const toWad = (x: number) => BigInt(Math.round(x * 1e9)) * 10n ** 9n;
const toNum = (x: bigint) => Number(x) / 1e18;
const BPS = 10_000n;
/** blend two WAD prices: w·a + (1−w)·b, w in [0, 1] */
const blend = (w: number, a: bigint, b: bigint) => {
  const wb = BigInt(Math.round(w * 10_000));
  return (wb * a + (BPS - wb) * b) / BPS;
};

/** Move the pool a fraction `alpha` of the way to the market price, spending at most `budget` share of its mUSD. */
function arbitrage(amm: Amm, market: bigint, alpha: number, budget: number) {
  const spot = spotPrice(amm);
  const target = blend(alpha, market, spot);
  const k = amm.rA * amm.rB;
  const capB = (amm.rB * BigInt(Math.round(budget * 1e6))) / 1_000_000n;
  const gross = (x: bigint) => (x * BPS) / (BPS - AMM_FEE_BPS);
  if (target > spot) {
    const rB2 = sqrt((k * target) / WAD);
    if (rB2 <= amm.rB) return;
    const dB = gross(rB2 - amm.rB);
    swapBForA(amm, dB < capB ? dB : capB);
  } else if (target < spot) {
    const rA2 = sqrt((k * WAD) / target);
    if (rA2 <= amm.rA) return;
    const dA = gross(rA2 - amm.rA);
    const capA = (capB * WAD) / spot;
    swapAForB(amm, dA < capA ? dA : capA);
  }
}

type Borrower = { soft: Position; cliff: Position; c0: bigint; d0: bigint; last: bigint; refund: bigint };

/** Called after every step with the new snapshot (the worker uses it to report progress). */
export type OnStep = (snapshot: Snapshot, steps: number) => void;

export function simulate(crash: Crash, input: Partial<SimParams> = {}, onStep?: OnStep): SimResult {
  const interval = crash.interval_seconds;
  const params: Required<SimParams> = {
    ...DEFAULT_PARAMS,
    blocksPerStep: Math.max(1, Math.round(interval / 2)),
    rMaxBps: 50,
    ...input,
  } as Required<SimParams>;
  const rMax = (R_MAX * BigInt(params.rMaxBps)) / 50n;
  const P0 = toWad(crash.prices[0]);

  // Borrowers: deterministic sizes (1–20 mETH) and opening health skewed towards the risky end.
  const borrowers: Borrower[] = Array.from({ length: params.users }, (_, i) => {
    const frac = (i * 0.6180339887) % 1;
    const c = toWad(1 + 19 * frac);
    const u = params.users === 1 ? 0 : i / (params.users - 1);
    const h = params.hMin + (params.hMax - params.hMin) * Math.pow(u, params.skew);
    const d = (((c * P0) / WAD) * LT) / toWad(h);
    return { soft: { c, d }, cliff: { c, d }, c0: c, d0: d, last: 0n, refund: 0n };
  });
  const totalC = borrowers.reduce((a, b) => a + b.c0, 0n);
  const depthA = (totalC * BigInt(Math.round(params.liquidity * 1000))) / 1000n;
  const ammSoft: Amm = { rA: depthA, rB: (depthA * P0) / WAD };
  const ammCliff: Amm = { ...ammSoft };

  const bps = BigInt(params.blocksPerStep);
  const subSteps = (bps + N_MAX - 1n) / N_MAX; // keeper pokes at most N_MAX blocks apart
  const perSub = bps / subSteps;

  let fees = 0n;
  let liquidations = 0;
  let glides = 0;
  let backstops = 0;
  let skips = 0;
  let softSlip = 0n;
  let cliffSlip = 0n;
  let softBad = 0n;
  let cliffBad = 0n;
  let minOracleSoft = P0;
  let minOracleCliff = P0;
  let minMarket = P0;
  const snapshots: Snapshot[] = [];

  let prevSpotSoft = spotPrice(ammSoft);
  let prevSpotCliff = spotPrice(ammCliff);

  for (let t = 0; t < crash.prices.length; t++) {
    const market = toWad(crash.prices[t]);
    if (market < minMarket) minMarket = market;
    // 1. oracle blends the market with the design's own pool (previous step)
    const oSoft = blend(params.beta, prevSpotSoft, market);
    const oCliff = blend(params.beta, prevSpotCliff, market);
    if (oSoft < minOracleSoft) minOracleSoft = oSoft;
    if (oCliff < minOracleCliff) minOracleCliff = oCliff;

    // 2. cliff pool: liquidate everything below H = 1, liquidator dumps the seized collateral
    for (const b of borrowers) {
      const p = b.cliff;
      if (p.d === 0n || health(p.c, p.d, oCliff) >= WAD) continue;
      const r = liquidateCliff(p, oCliff, p.d);
      if (!r.ok) continue;
      liquidations++;
      cliffBad += r.badDebt;
      const out = swapAForB(ammCliff, r.seized);
      cliffSlip += (r.seized * oCliff) / WAD - out;
    }

    // 3. soft pool: keeper pokes every position (in ≤ N_MAX-block pokes), slices sold via the router rules
    for (let k = 1n; k <= subSteps; k++) {
      const block = BigInt(t) * bps + k * perSub;
      for (const b of borrowers) {
        const r = poke(b.soft, oSoft, ammSoft, block - b.last, fees, rMax);
        fees = r.feesAfter;
        if (r.lastUpdated) b.last = block;
        if (r.skipped) skips++;
        if (!r.acted) continue;
        if (r.kind === "glide") glides++;
        else backstops++;
        softSlip += (r.sold * oSoft) / WAD - r.proceeds;
        softBad += r.shortfall;
        b.refund += r.refund;
      }
    }

    // 4. arbitrage pulls each pool part of the way back to the market
    arbitrage(ammSoft, market, params.alpha, params.arbBudget);
    arbitrage(ammCliff, market, params.alpha, params.arbBudget);
    prevSpotSoft = spotPrice(ammSoft);
    prevSpotCliff = spotPrice(ammCliff);

    // 5. record
    const m = toNum(market);
    let sc = 0n;
    let cc = 0n;
    let se = 0;
    let ce = 0;
    for (const b of borrowers) {
      sc += b.soft.c;
      cc += b.cliff.c;
      se += toNum(b.soft.c) * m - toNum(b.soft.d) + toNum(b.refund);
      ce += toNum(b.cliff.c) * m - toNum(b.cliff.d);
    }
    snapshots.push({
      t,
      market: m,
      oracleSoft: toNum(oSoft),
      oracleCliff: toNum(oCliff),
      ammSoft: toNum(prevSpotSoft),
      ammCliff: toNum(prevSpotCliff),
      softCollateral: toNum(sc),
      cliffCollateral: toNum(cc),
      softEquity: se,
      cliffEquity: ce,
      liquidations,
      glides,
      backstops,
    });
    onStep?.(snapshots[t], crash.prices.length);
  }

  const finalPrice = crash.prices[crash.prices.length - 1];
  const p0 = crash.prices[0];
  const startEquity = borrowers.reduce((a, b) => a + toNum(b.c0) * p0 - toNum(b.d0), 0) / params.users;
  const summarise = (design: "soft" | "cliff"): DesignSummary => {
    const n = params.users;
    const lostEth = borrowers.reduce((a, b) => a + toNum(b.c0 - b[design].c), 0) / n;
    const kept =
      borrowers.reduce((a, b) => a + toNum(b[design].c) * finalPrice - toNum(b[design].d) + (design === "soft" ? toNum(b.refund) : 0), 0) / n;
    const minOracle = design === "soft" ? minOracleSoft : minOracleCliff;
    return {
      collateralLostPerUserEth: lostEth,
      collateralLostPerUserUsd: lostEth * finalPrice,
      valueKeptPerUser: kept,
      valueKeptPct: (kept / startEquity) * 100,
      cascadeDepthPct: Math.max(0, (toNum(minMarket - minOracle) / p0) * 100),
      slippageUsd: toNum(design === "soft" ? softSlip : cliffSlip),
      events: design === "soft" ? glides + backstops : liquidations,
      backstops: design === "soft" ? backstops : 0,
      skips: design === "soft" ? skips : 0,
      badDebtUsd: toNum(design === "soft" ? softBad : cliffBad),
      wiped: borrowers.filter((b) => b[design].c === 0n).length,
    };
  };

  return {
    crash: { id: crash.id, label: crash.label, source: crash.source, interval_seconds: interval, steps: crash.prices.length },
    params,
    startPrice: p0,
    startEquity: startEquity * params.users,
    marketLowPct: ((p0 - toNum(minMarket)) / p0) * 100,
    snapshots,
    soft: summarise("soft"),
    cliff: summarise("cliff"),
  };
}
