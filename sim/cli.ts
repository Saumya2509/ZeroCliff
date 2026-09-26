// Cascade Lab CLI: runs the experiments in md/manali/05-crash-simulator.md §7 with the same engine the
// website uses (web/lib/sim), and writes one JSON per experiment.
//
//   npx tsx cli.ts --all --out ../web/public/results      all experiments (E1–E7)
//   npx tsx cli.ts --exp E3 --out ../web/public/results   one experiment
//   npx tsx cli.ts --run may-2021 --beta 0.3               one scenario, summary to the console

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAmountOut, spotPrice, sqrt, swapAForB, swapBForA, type Amm } from "../web/lib/sim/amm";
import { WAD } from "../web/lib/sim/glide";
import { simulate, type Crash, type DesignSummary, type SimParams, type SimResult } from "../web/lib/sim/run";

const here = dirname(fileURLToPath(import.meta.url));
const crashDir = join(here, "..", "web", "public", "crashes");
const REAL = ["mar-2020", "may-2021", "jun-2022", "aug-2024"];
const loadCrash = (id: string) => JSON.parse(readFileSync(join(crashDir, `${id}.json`), "utf8")) as Crash;

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------- helpers ----------

const round = (x: number, d = 2) => Number(x.toFixed(d));
const brief = (s: DesignSummary) => ({
  valueKeptPerUser: round(s.valueKeptPerUser, 0),
  valueKeptPct: round(s.valueKeptPct, 1),
  collateralLostPerUserEth: round(s.collateralLostPerUserEth, 3),
  collateralLostPerUserUsd: round(s.collateralLostPerUserUsd, 0),
  cascadeDepthPct: round(s.cascadeDepthPct, 2),
  slippageUsd: round(s.slippageUsd, 0),
  events: s.events,
  backstops: s.backstops,
  skips: s.skips,
  badDebtUsd: round(s.badDebtUsd, 0),
  wiped: s.wiped,
});

/** Keep at most `max` snapshots (evenly spaced, always including the last) for charts. */
function downsample(r: SimResult, max = 240) {
  const s = r.snapshots;
  const step = Math.max(1, Math.ceil(s.length / max));
  const kept = s.filter((_, i) => i % step === 0 || i === s.length - 1);
  return kept.map((x) => ({
    t: x.t,
    market: round(x.market),
    oracleSoft: round(x.oracleSoft),
    oracleCliff: round(x.oracleCliff),
    softEquity: round(x.softEquity, 0),
    cliffEquity: round(x.cliffEquity, 0),
    softCollateral: round(x.softCollateral, 3),
    cliffCollateral: round(x.cliffCollateral, 3),
  }));
}

function row(crash: Crash, params: Partial<SimParams>, withSeries = false) {
  const t0 = performance.now();
  const r = simulate(crash, params);
  const ms = Math.round(performance.now() - t0);
  return {
    crash: crash.id,
    label: crash.label,
    marketLowPct: round(r.marketLowPct, 1),
    params: r.params,
    soft: brief(r.soft),
    cliff: brief(r.cliff),
    runtimeMs: ms,
    ...(withSeries ? { series: downsample(r) } : {}),
  };
}

// ---------- experiments ----------

type Experiment = { id: string; title: string; question: string; run: () => unknown };

const BETAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
const LIQ = [0.5, 1, 2, 5];
const RMAX = [10, 25, 50, 100, 200];

const experiments: Experiment[] = [
  {
    id: "E1",
    title: "Each crash, default parameters, β = 0",
    question: "Loss per user under cliff liquidation vs Soft Landing, with no feedback from the protocol's own sales.",
    run: () => REAL.map((id) => row(loadCrash(id), { beta: 0 }, true)),
  },
  {
    id: "E2",
    title: "Each crash, β = 0.3",
    question: "Same, with 30% of price discovery in the pool being sold into: the cascade case.",
    run: () => REAL.map((id) => row(loadCrash(id), { beta: 0.3 }, true)),
  },
  {
    id: "E3",
    title: "Sweep β from 0 to 0.5",
    question: "How deep does the cascade get as more price discovery happens in the pool being dumped into?",
    run: () => REAL.map((id) => ({ crash: id, points: BETAS.map((beta) => ({ beta, ...row(loadCrash(id), { beta }) })) })),
  },
  {
    id: "E4",
    title: "Sweep AMM liquidity (0.5×, 1×, 2×, 5×), β = 0.3",
    question: "Where does the glide's advantage shrink? (Honesty check.)",
    run: () =>
      REAL.map((id) => ({ crash: id, points: LIQ.map((liquidity) => ({ liquidity, ...row(loadCrash(id), { beta: 0.3, liquidity }) })) })),
  },
  {
    id: "E5",
    title: "Sweep R_MAX (0.1%–2% per block), β = 0.3",
    question: "Is there a trade-off, with a slower glide paying less slippage but hitting the backstop more?",
    run: () =>
      REAL.map((id) => ({
        crash: id,
        points: RMAX.map((rMaxBps) => ({ rMaxPct: rMaxBps / 100, ...row(loadCrash(id), { beta: 0.3, rMaxBps }) })),
      })),
  },
  {
    id: "E6",
    title: "Whipsaw path (synthetic −20%, +15%, −20%, +20%)",
    question: "Does the glide over-sell in a choppy market? Reported either way.",
    run: () => [0, 0.3].map((beta) => ({ beta, ...row(loadCrash("whipsaw"), { beta }, true) })),
  },
  {
    id: "E7",
    title: "One big dump vs slices on the same AMM",
    question: "Slippage of selling 20 mETH at once vs 40 slices of 0.5 mETH with a budget-limited arbitrageur between slices.",
    run: () => dumpVsSlices(),
  },
];

/** E7, same setup as contracts/test/experiments/SlippageExperiment.t.sol, on the TS engine. */
function dumpVsSlices() {
  const price = 3_500n * WAD;
  const depth = 1_000n * WAD;
  const total = 20n * WAD;
  const slices = 40n;
  const budget = 2_000n * WAD;
  const pool = (): Amm => ({ rA: depth, rB: (depth * price) / WAD });

  const cliff = pool();
  const cliffOut = swapAForB(cliff, total);

  const glide = pool();
  let glideOut = 0n;
  for (let i = 0n; i < slices; i++) {
    glideOut += swapAForB(glide, total / slices);
    const targetB = sqrt((((glide.rA * glide.rB) / WAD) * price));
    if (targetB > glide.rB) {
      const need = ((targetB - glide.rB) * 10_000n) / 9_970n;
      swapBForA(glide, need < budget ? need : budget);
    }
  }
  const avg = (out: bigint) => Number((out * WAD) / total) / 1e18;
  const p = Number(price) / 1e18;
  const cliffAvg = avg(cliffOut);
  const glideAvg = avg(glideOut);
  const bpsBelow = (x: number) => round(((p - x) / p) * 10_000, 0);
  return {
    oraclePrice: p,
    poolDepthMeth: 1000,
    totalSoldMeth: 20,
    slices: Number(slices),
    cliff: { avgPrice: round(cliffAvg), slippageBps: bpsBelow(cliffAvg), finalPrice: round(Number(spotPrice(cliff)) / 1e18) },
    glide: { avgPrice: round(glideAvg), slippageBps: bpsBelow(glideAvg), finalPrice: round(Number(spotPrice(glide)) / 1e18) },
    note: "Matches the Solidity experiment (results/slippage.json) up to arbitrage rounding.",
    quoteCheck: getAmountOut(WAD, depth, (depth * price) / WAD).toString(),
  };
}

// ---------- main ----------

const out = arg("--out");
const one = arg("--run");

if (one) {
  const r = row(loadCrash(one), { beta: Number(arg("--beta") ?? 0), liquidity: Number(arg("--liquidity") ?? 1) });
  console.log(`${r.label}: market low −${r.marketLowPct}%, ${r.runtimeMs} ms`);
  console.table({ cliff: r.cliff, soft: r.soft });
} else {
  const wanted = args.includes("--all") ? experiments : experiments.filter((e) => e.id === arg("--exp"));
  if (!wanted.length || !out) {
    console.error("usage: tsx cli.ts --all --out <dir> | --exp E1 --out <dir> | --run <crash> [--beta 0.3]");
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const index: { id: string; title: string; file: string }[] = [];
  for (const e of wanted) {
    const t0 = performance.now();
    const data = e.run();
    const file = `${e.id.toLowerCase()}.json`;
    writeFileSync(join(out, file), JSON.stringify({ id: e.id, title: e.title, question: e.question, generatedAt: new Date().toISOString(), data }));
    index.push({ id: e.id, title: e.title, file });
    console.log(`${e.id} ${e.title}: ${Math.round(performance.now() - t0)} ms`);
  }
  if (args.includes("--all")) writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2));
}
