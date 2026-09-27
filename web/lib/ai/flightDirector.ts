// Flight Director (md/manali/10): a local risk assistant for one position. Three layers, all in the
// browser, no network calls and no language model:
//   1. parseIntent: rule-based question parser (keywords with typo tolerance, numbers by regex)
//   2. quant: price thresholds, EWMA volatility, barrier probability, seeded Monte Carlo that runs the
//      contract-verified maths in ../sim/glide on every simulated path
//   3. advise: turns those numbers into plain advisories. Every figure in the text is computed here.

import { backstopSlice, cliffOutcome, FEE, glideSlice, health, H_COMFORT, H_FLOOR, H_OPEN, LT, WAD } from "../sim/glide";
import { forecastLanding } from "../sim/forecast";

const num = (x: bigint) => Number(x) / 1e18;
const wad = (x: number) => BigInt(Math.round(x * 1e9)) * 10n ** 9n;
const LT_F = num(LT);
const COMFORT = num(H_COMFORT);
const FLOOR = num(H_FLOOR);
const OPEN = num(H_OPEN);

// ---------------------------------------------------------------- 1. intent parser

export type Intent =
  | { type: "STRESS_TEST"; dropPct: number; assumedDrop: boolean }
  | { type: "SAFE_BORROW"; collateralEth?: number; dropPct?: number }
  | { type: "TOP_UP"; dropPct: number; assumedDrop: boolean }
  | { type: "GLIDE_ODDS"; hours: number; assumedHours: boolean }
  | { type: "THRESHOLDS" }
  | { type: "COMPARE_CLIFF"; dropPct: number; assumedDrop: boolean }
  | { type: "HELP" };

const KEYWORDS: Record<Exclude<Intent["type"], "HELP">, string[]> = {
  SAFE_BORROW: ["borrow", "loan", "max", "maximum", "afford"],
  TOP_UP: ["add", "deposit", "topup", "repay", "increase", "protect", "fix"],
  GLIDE_ODDS: ["sleep", "night", "chance", "odds", "probability", "likely", "overnight", "tomorrow", "hours", "hour"],
  THRESHOLDS: ["price", "where", "when", "threshold", "level", "distance", "far", "start", "liquidated", "liquidation"],
  COMPARE_CLIFF: ["compare", "cliff", "aave", "normal", "versus", "vs", "ghost", "difference"],
  STRESS_TEST: ["drop", "drops", "crash", "crashes", "fall", "falls", "dump", "dumps", "down", "shock", "tank", "tanks", "plunge"],
};

/** Levenshtein distance, early-exit when above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const matches = (token: string, word: string) =>
  token === word || (word.length >= 5 && editDistance(token, word, word.length >= 8 ? 2 : 1) <= (word.length >= 8 ? 2 : 1));

function score(tokens: string[], words: string[]) {
  return tokens.reduce((n, t) => n + (words.some((w) => matches(t, w)) ? 1 : 0), 0);
}

export function parseIntent(prompt: string): Intent {
  const p = prompt.toLowerCase().replace(/[’']/g, "");
  const tokens = p.split(/[^a-z0-9.]+/).filter(Boolean);

  const pct = p.match(/(\d+(?:\.\d+)?)\s*(%|percent|pct)/) ?? p.match(/(?:drop|drops|crash|crashes|fall|falls|down|dump|dumps|by)\s+(\d+(?:\.\d+)?)(?!\s*(?:h|hour|eth|meth))/);
  const dropPct = pct ? Math.min(95, parseFloat(pct[1])) : undefined;
  const hoursMatch = p.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  const ethMatch = p.match(/(\d+(?:\.\d+)?)\s*(m?eth)\b/);

  const s = Object.fromEntries(Object.entries(KEYWORDS).map(([k, words]) => [k, score(tokens, words)])) as Record<keyof typeof KEYWORDS, number>;
  if (/how much.*(borrow)|can i borrow|safe to borrow/.test(p)) s.SAFE_BORROW += 3;
  if (/how much.*(add|deposit|repay)|what should i do|how do i (stay|get) safe/.test(p)) s.TOP_UP += 3;
  if (/safe to sleep|over ?night|next \d+\s*h/.test(p)) s.GLIDE_ODDS += 3;
  if (/what if|if eth/.test(p)) s.STRESS_TEST += 1;

  const best = (Object.entries(s) as [keyof typeof KEYWORDS, number][]).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return dropPct !== undefined ? { type: "STRESS_TEST", dropPct, assumedDrop: false } : { type: "HELP" };

  const drop = dropPct ?? 20;
  switch (best[0]) {
    case "SAFE_BORROW":
      return { type: "SAFE_BORROW", collateralEth: ethMatch ? parseFloat(ethMatch[1]) : undefined, dropPct };
    case "TOP_UP":
      return { type: "TOP_UP", dropPct: drop, assumedDrop: dropPct === undefined };
    case "GLIDE_ODDS":
      return { type: "GLIDE_ODDS", hours: hoursMatch ? Math.min(72, parseFloat(hoursMatch[1])) : 8, assumedHours: !hoursMatch };
    case "THRESHOLDS":
      return dropPct !== undefined ? { type: "STRESS_TEST", dropPct, assumedDrop: false } : { type: "THRESHOLDS" };
    case "COMPARE_CLIFF":
      return { type: "COMPARE_CLIFF", dropPct: drop, assumedDrop: dropPct === undefined };
    default:
      return { type: "STRESS_TEST", dropPct: drop, assumedDrop: dropPct === undefined };
  }
}

// ---------------------------------------------------------------- 2. quant

export type Position = { collateral: bigint; debt: bigint; price: bigint };

/** Prices at which health crosses the comfort level, the backstop floor and the cliff (H = 1). */
export function thresholds({ collateral, debt, price }: Position) {
  const c = num(collateral);
  const d = num(debt);
  const p = num(price);
  const at = (h: number) => (c > 0 ? (h * d) / (c * LT_F) : Infinity);
  const drop = (x: number) => Math.max(0, (1 - x / p) * 100);
  const glide = at(COMFORT);
  const floor = at(FLOOR);
  const cliff = at(1);
  return {
    health: debt === 0n ? Infinity : num(health(collateral, debt, price)),
    glidePrice: glide,
    glideDropPct: drop(glide),
    floorPrice: floor,
    floorDropPct: drop(floor),
    cliffPrice: cliff,
    cliffDropPct: drop(cliff),
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7). */
export function normCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const YEAR_S = 365 * 24 * 3600;

/**
 * Annualised EWMA volatility (RiskMetrics, λ = 0.94) of log returns from prices sampled every
 * `intervalS` seconds. Null when there are too few returns to say anything.
 */
export function ewmaVolatility(prices: number[], intervalS: number, lambda = 0.94): number | null {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) if (prices[i - 1] > 0 && prices[i] > 0) r.push(Math.log(prices[i] / prices[i - 1]));
  if (r.length < 10 || intervalS <= 0) return null;
  let v = r.slice(0, 10).reduce((a, x) => a + x * x, 0) / 10; // seed with the first returns
  for (const x of r.slice(10)) v = lambda * v + (1 - lambda) * x * x;
  return Math.sqrt(v * (YEAR_S / intervalS));
}

/**
 * Probability that the price touches a level `dropPct` below today within `hours`, for a driftless
 * geometric random walk with annual volatility `sigma` (reflection principle: 2·Φ(−d / σ√T)).
 * Touching, not ending below: the glide starts the first block health crosses 1.25.
 */
export function touchProbability(dropPct: number, sigma: number, hours: number) {
  if (dropPct <= 0) return 1;
  if (dropPct >= 100 || sigma <= 0 || hours <= 0) return 0;
  const dist = -Math.log(1 - dropPct / 100);
  return Math.min(1, 2 * normCdf(-dist / (sigma * Math.sqrt((hours * 3600) / YEAR_S))));
}

/** Deterministic PRNG (mulberry32), so a forecast is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MonteCarlo = {
  paths: number;
  hours: number;
  sigma: number;
  pGlide: number; // share of paths where Soft Landing sold anything
  pBackstop: number;
  pCliffLiquidation: number; // share where the cliff ghost was liquidated at least once
  softKeptEth: number; // mean collateral left
  cliffKeptEth: number;
  equityGainMean: number; // mean (soft equity − cliff equity) at the end, mUSD
  equityGainP5: number; // 5th percentile of the same
};

const BLOCK_S = 2;
const STEP_BLOCKS = 150; // price moves every 5 minutes of 2 s blocks
const POKE_BLOCKS = 30n; // the keeper pokes at least every 30 blocks; the contract accrues the gap

/**
 * Monte Carlo over `paths` driftless GBM price paths for `hours`. On each path, the position runs
 * through Soft Landing (glide / backstop, exact contract maths, sales at the oracle price less the
 * fee) and through the cliff pool (50% close factor, 8% bonus, liquidated while H < 1).
 * Ignores AMM slippage and assumes an active keeper, like the Landing Forecast.
 */
export function monteCarlo(pos: Position, sigma: number, hours: number, paths = 300, seed = 1): MonteCarlo {
  const rand = rng(seed);
  const steps = Math.max(1, Math.round((hours * 3600) / (BLOCK_S * STEP_BLOCKS)));
  const dt = (STEP_BLOCKS * BLOCK_S) / YEAR_S;
  const drift = -0.5 * sigma * sigma * dt;
  const vol = sigma * Math.sqrt(dt);
  const pokes = BigInt(STEP_BLOCKS) / POKE_BLOCKS;
  let glideN = 0;
  let backstopN = 0;
  let cliffN = 0;
  let softKept = 0;
  let cliffKept = 0;
  const gains: number[] = [];

  for (let k = 0; k < paths; k++) {
    let sc = pos.collateral;
    let sd = pos.debt;
    let cc = pos.collateral;
    let cd = pos.debt;
    let px = num(pos.price);
    let glided = false;
    let backstopped = false;
    let liquidated = false;
    for (let s = 0; s < steps; s++) {
      // Box–Muller
      const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      px *= Math.exp(drift + vol * z);
      // Fast path: far from every threshold nothing can happen, so skip the exact (bigint) maths.
      // Near a threshold (within 2%), every decision below uses the contract's exact code.
      const hs = sd > 0n ? (num(sc) * px * LT_F) / num(sd) : Infinity;
      const hc = cd > 0n ? (num(cc) * px * LT_F) / num(cd) : Infinity;
      if (hs > COMFORT * 1.02 && hc > 1.02) continue;
      const price = wad(px);
      for (let i = 0n; i < pokes; i++) {
        if (sd > 0n) {
          const h = health(sc, sd, price);
          let sell = 0n;
          if (h < H_FLOOR) {
            sell = backstopSlice(sc, sd, price);
            if (sell >= sc) sell = sc;
            backstopped = true;
          } else if (h < H_COMFORT) {
            sell = glideSlice(sc, sd, price, POKE_BLOCKS);
            if (sell > 0n) glided = true;
          }
          if (sell > 0n) {
            const repay = (((sell * price) / WAD) * (WAD - FEE)) / WAD;
            sc -= sell;
            sd = repay >= sd || sc === 0n ? 0n : sd - repay;
          }
        }
        for (let guard = 0; cd > 0n && guard < 20; guard++) {
          const out = cliffOutcome(cc, cd, price);
          if (!out.liquidated) break;
          liquidated = true;
          cc = out.collateralAfter;
          cd = cc === 0n ? 0n : out.debtAfter;
        }
      }
    }
    glideN += glided ? 1 : 0;
    backstopN += backstopped ? 1 : 0;
    cliffN += liquidated ? 1 : 0;
    softKept += num(sc);
    cliffKept += num(cc);
    gains.push(num(sc) * px - num(sd) - (num(cc) * px - num(cd)));
  }
  gains.sort((a, b) => a - b);
  return {
    paths,
    hours,
    sigma,
    pGlide: glideN / paths,
    pBackstop: backstopN / paths,
    pCliffLiquidation: cliffN / paths,
    softKeptEth: softKept / paths,
    cliffKeptEth: cliffKept / paths,
    equityGainMean: gains.reduce((a, b) => a + b, 0) / paths,
    equityGainP5: gains[Math.floor(paths * 0.05)] ?? 0,
  };
}

/** Largest debt for `collateralEth` at `price` that keeps health ≥ `h` after a `dropPct` fall. */
export function maxDebt(collateralEth: number, price: number, h: number, dropPct = 0) {
  return (collateralEth * price * (1 - dropPct / 100) * LT_F) / h;
}

/** Collateral to add, or debt to repay, so a `dropPct` fall leaves health at 1.25 (no glide). */
export function topUp({ collateral, debt, price }: Position, dropPct: number) {
  const c = num(collateral);
  const d = num(debt);
  const shocked = num(price) * (1 - dropPct / 100);
  const addEth = Math.max(0, (COMFORT * d) / (shocked * LT_F) - c);
  const repayUsd = Math.max(0, d - (c * shocked * LT_F) / COMFORT);
  return { addEth, repayUsd };
}

// ---------------------------------------------------------------- 3. advisories

export type Status = "CLEAR_SKIES" | "MILD_TURBULENCE" | "CRITICAL_DESCENT" | "NO_POSITION";

export type Advice = {
  status: Status;
  headline: string;
  lines: string[];
  figures: { label: string; value: string }[];
};

export type Context = Position & { sigma: number; sigmaSource: "measured" | "assumed" };

const f = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pctS = (x: number, d = 1) => `${f(x, d)}%`;
const prob = (x: number) => (x < 0.01 ? "under 1%" : x > 0.99 ? "over 99%" : `${Math.round(x * 100)}%`);

/** A price level and how far below today it is, or that the price is already past it. */
const level = (price: number, dropPct: number) => (dropPct > 0 ? `${f(price)} (−${pctS(dropPct)})` : `${f(price)} (already below)`);

export function statusOf(pos: Position): Status {
  if (pos.debt === 0n || pos.collateral === 0n) return "NO_POSITION";
  const h = health(pos.collateral, pos.debt, pos.price);
  return h >= H_COMFORT ? "CLEAR_SKIES" : h >= H_FLOOR ? "MILD_TURBULENCE" : "CRITICAL_DESCENT";
}

/** The always-on summary shown above the question box. */
export function briefing(ctx: Context): Advice {
  const status = statusOf(ctx);
  if (status === "NO_POSITION") {
    return { status, headline: "No open loan", lines: ["Open a position to get a briefing. Questions about borrowing still work."], figures: [] };
  }
  const t = thresholds(ctx);
  const p8 = touchProbability(t.glideDropPct, ctx.sigma, 8);
  const headline =
    status === "CLEAR_SKIES"
      ? `Clear skies · health ${f(t.health)}`
      : status === "MILD_TURBULENCE"
        ? `Gliding · health ${f(t.health)}`
        : `Backstop range · health ${f(t.health)}`;
  const lines =
    status === "CLEAR_SKIES"
      ? [`ETH can fall ${pctS(t.glideDropPct)} (to ${f(t.glidePrice)}) before any collateral is sold.`, `Chance of reaching that level in the next 8 hours: ${prob(p8)} (volatility ${pctS(ctx.sigma * 100, 0)} a year, ${ctx.sigmaSource}).`]
      : status === "MILD_TURBULENCE"
        ? ["Health is below 1.25, so a small slice sells each block until it is back at 1.25. If the price recovers, selling stops.", `The backstop would take over below ${f(t.floorPrice)} (a further ${pctS(t.floorDropPct)}).`]
        : ["Health is below the 1.02 floor: the next poke sells what restores 1.25 in one step, with no bonus to anyone.", `A normal protocol would liquidate this loan below ${f(t.cliffPrice)}.`];
  return {
    status,
    headline,
    lines,
    figures: [
      { label: "Glide starts at", value: level(t.glidePrice, t.glideDropPct) },
      { label: "Backstop at", value: level(t.floorPrice, t.floorDropPct) },
      { label: "Cliff pool liquidates at", value: level(t.cliffPrice, t.cliffDropPct) },
    ],
  };
}

function stressAdvice(ctx: Context, dropPct: number, assumed: boolean, compare: boolean): Advice {
  const shocked = (ctx.price * BigInt(Math.round((100 - dropPct) * 100))) / 10_000n;
  const fc = forecastLanding(ctx.collateral, ctx.debt, shocked, 300);
  const h = num(fc.shockedHealth);
  const soldEth = num(fc.sold);
  const cliffEth = num(fc.cliff.seized);
  const status: Status = fc.kind === "safe" ? "CLEAR_SKIES" : fc.kind === "glide" ? "MILD_TURBULENCE" : "CRITICAL_DESCENT";
  const note = assumed ? ` (no size given, so ${dropPct}% is assumed)` : "";
  const lines: string[] = [];
  if (fc.kind === "safe") {
    lines.push(`After a ${dropPct}% fall${note}, health would be ${f(h)}, still above 1.25. Nothing is sold.`);
  } else if (fc.kind === "glide") {
    lines.push(`After a ${dropPct}% fall${note}, health would be ${f(h)}. Soft Landing would sell ${f(soldEth, 4)} mETH over about ${fc.settleBlocks} blocks, back to 1.25.`);
  } else {
    lines.push(`After a ${dropPct}% fall${note}, health would be ${f(h)}, below the 1.02 floor. The backstop would sell ${f(soldEth, 4)} mETH at once${fc.closeOut ? ", all of it, and the rest of the debt would be written off" : ""}.`);
  }
  if (fc.cliff.liquidated) {
    lines.push(`The same loan in a normal pool would be liquidated: ${f(cliffEth, 4)} mETH seized for ${f(num(fc.cliff.repaid), 0)} mUSD of debt, an 8% bonus to the liquidator.`);
  } else if (compare) {
    lines.push(`A normal pool would do nothing yet: health ${f(h)} is above its 1.00 cliff. It acts later, all at once.`);
  }
  const extra = num(fc.cost.cliff) - num(fc.cost.soft);
  if (fc.kind !== "safe" || fc.cliff.liquidated) {
    const basis =
      fc.kind === "backstop"
        ? "The Soft Landing figure assumes the backstop's worst case, a sale 5% below the oracle."
        : "Ignores AMM slippage (glide slices execute up to 1.5% below the oracle).";
    lines.push(`Value lost to the unwind itself: Soft Landing ${f(num(fc.cost.soft), 2)} mUSD, normal pool ${f(num(fc.cost.cliff), 2)} mUSD${extra > 0 ? `, so ${f(extra, 2)} mUSD kept` : ""}. ${basis}`);
  }
  return {
    status,
    headline: `${compare ? "Soft Landing vs a normal pool" : "Stress test"} · ETH −${dropPct}%`,
    lines,
    figures: [
      { label: "Health after the fall", value: f(h) },
      { label: "Soft Landing sells", value: `${f(soldEth, 4)} mETH` },
      { label: "Normal pool seizes", value: `${f(cliffEth, 4)} mETH` },
    ],
  };
}

/** Answer one parsed question about the position in `ctx`. */
export function answer(intent: Intent, ctx: Context): Advice {
  const has = ctx.debt > 0n && ctx.collateral > 0n;
  const price = num(ctx.price);
  const needPosition = (headline: string): Advice => ({
    status: "NO_POSITION",
    headline,
    lines: ["That needs an open loan. Open a position first, or ask how much you can borrow against some mETH."],
    figures: [],
  });

  switch (intent.type) {
    case "HELP":
      return {
        status: statusOf(ctx),
        headline: "Questions I can answer",
        lines: [
          "“What if ETH drops 25%?”: health, what gets sold, and what a normal pool would seize.",
          "“How much can I borrow against 3 mETH?”: the opening limit and a no-glide limit.",
          "“Am I safe to sleep?” or “chance of gliding in 12 hours”: probabilities from recent volatility.",
          "“Where does the glide start?”: the prices for glide, backstop and a normal pool's liquidation.",
          "“How much should I add to survive 30%?”: collateral to add or debt to repay.",
        ],
        figures: [],
      };

    case "THRESHOLDS": {
      if (!has) return needPosition("Price levels");
      const b = briefing(ctx);
      return { ...b, headline: "Price levels for this loan", lines: [`Current price ${f(price)}, health ${f(thresholds(ctx).health)}.`] };
    }

    case "STRESS_TEST":
    case "COMPARE_CLIFF":
      if (!has) return needPosition("Stress test");
      return stressAdvice(ctx, intent.dropPct, intent.assumedDrop, intent.type === "COMPARE_CLIFF");

    case "SAFE_BORROW": {
      const c = intent.collateralEth ?? num(ctx.collateral);
      if (c <= 0) return needPosition("Borrowing limit");
      const open = maxDebt(c, price, OPEN);
      const drop = intent.dropPct ?? 30;
      const noGlide = maxDebt(c, price, COMFORT, drop);
      const already = intent.collateralEth === undefined ? num(ctx.debt) : 0;
      return {
        status: statusOf(ctx),
        headline: `Borrowing against ${f(c, 4)} mETH`,
        lines: [
          `The pool lets you borrow up to ${f(open, 0)} mUSD (opening health 1.40).`,
          `To ride out a ${drop}% fall without selling anything, stay under ${f(noGlide, 0)} mUSD.`,
          ...(already > 0 ? [`You owe ${f(already, 0)} mUSD now, so ${f(Math.max(0, noGlide - already), 0)} mUSD more stays within that margin.`] : []),
        ],
        figures: [
          { label: "Opening limit", value: `${f(open, 0)} mUSD` },
          { label: `No glide through −${drop}%`, value: `${f(noGlide, 0)} mUSD` },
        ],
      };
    }

    case "TOP_UP": {
      if (!has) return needPosition("Top-up");
      const t = topUp(ctx, intent.dropPct);
      const note = intent.assumedDrop ? ` (no size given, so ${intent.dropPct}% is assumed)` : "";
      const done = t.addEth === 0 && t.repayUsd === 0;
      return {
        status: statusOf(ctx),
        headline: `Staying clear of a ${intent.dropPct}% fall`,
        lines: done
          ? [`Already covered${note}: after a ${intent.dropPct}% fall, health stays at or above 1.25.`]
          : [`To keep health at 1.25 after a ${intent.dropPct}% fall${note}, do either of these:`, `add ${f(t.addEth, 4)} mETH of collateral, or repay ${f(t.repayUsd, 0)} mUSD of debt.`],
        figures: done ? [] : [
          { label: "Or add collateral", value: `${f(t.addEth, 4)} mETH` },
          { label: "Or repay", value: `${f(t.repayUsd, 0)} mUSD` },
        ],
      };
    }

    case "GLIDE_ODDS": {
      if (!has) return needPosition("Odds of gliding");
      const t = thresholds(ctx);
      const pTouch = touchProbability(t.glideDropPct, ctx.sigma, intent.hours);
      const pCliff = touchProbability(t.cliffDropPct, ctx.sigma, intent.hours);
      const mc = monteCarlo(ctx, ctx.sigma, intent.hours, 300);
      const window = `${intent.hours} hour${intent.hours === 1 ? "" : "s"}${intent.assumedHours ? " (a night, assumed)" : ""}`;
      return {
        status: statusOf(ctx),
        headline: `The next ${window}`,
        lines: [
          t.glideDropPct > 0
            ? `Chance ETH reaches the glide level (${f(t.glidePrice)}) in that time: ${prob(pTouch)}. For a normal pool's liquidation level (${f(t.cliffPrice)}): ${prob(pCliff)}.`
            : `ETH is already below the glide level (${f(t.glidePrice)}), so slices are selling now. Chance it reaches a normal pool's liquidation level (${f(t.cliffPrice)}) in that time: ${prob(pCliff)}.`,
          `Across ${mc.paths} simulated paths: Soft Landing sold something on ${prob(mc.pGlide)} of them, the backstop acted on ${prob(mc.pBackstop)}, and a normal pool liquidated on ${prob(mc.pCliffLiquidation)}.`,
          mc.pCliffLiquidation > 0
            ? `On average you would end with ${f(mc.equityGainMean, 2)} mUSD ${mc.equityGainMean >= 0 ? "more" : "less"} equity than in a normal pool${
                mc.equityGainP5 < 0 ? `; on the worst 5% of paths Soft Landing ends ${f(-mc.equityGainP5, 2)} mUSD behind` : ""
              }.`
            : "Neither design sells anything on most paths; the loan simply rides it out.",
          `Volatility ${pctS(ctx.sigma * 100, 0)} a year (${ctx.sigmaSource}), no trend assumed, keeper active, AMM slippage ignored.`,
        ],
        figures: [
          { label: "Glide within window", value: t.glideDropPct > 0 ? prob(pTouch) : "gliding now" },
          { label: "Normal-pool liquidation", value: prob(pCliff) },
          { label: "Mean equity vs normal pool", value: `${mc.equityGainMean >= 0 ? "+" : "−"}${f(Math.abs(mc.equityGainMean), 2)} mUSD` },
        ],
      };
    }
  }
}
