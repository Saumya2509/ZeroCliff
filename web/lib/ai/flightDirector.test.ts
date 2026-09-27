import { describe, expect, it } from "vitest";
import { health, WAD } from "../sim/glide";
import {
  answer,
  briefing,
  editDistance,
  ewmaVolatility,
  maxDebt,
  monteCarlo,
  normCdf,
  parseIntent,
  statusOf,
  thresholds,
  topUp,
  touchProbability,
  type Context,
} from "./flightDirector";

const E = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
// 10 mETH, 20,000 mUSD at 3,500: health 10 × 3500 × 0.85 / 20000 = 1.4875
const ctx = (over: Partial<Context> = {}): Context => ({
  collateral: E(10),
  debt: E(20_000),
  price: E(3_500),
  sigma: 0.8,
  sigmaSource: "assumed",
  ...over,
});

describe("layer 1: intent parser", () => {
  it.each([
    ["What happens if ETH crashes 25% in 2 hours?", { type: "STRESS_TEST", dropPct: 25 }],
    ["what if eth drops 15 percent", { type: "STRESS_TEST", dropPct: 15 }],
    ["How much can I borrow safely against 2 ETH?", { type: "SAFE_BORROW", collateralEth: 2 }],
    ["Am I safe to sleep?", { type: "GLIDE_ODDS", hours: 8, assumedHours: true }],
    ["chance of gliding in the next 12 hours", { type: "GLIDE_ODDS", hours: 12 }],
    ["compare with aave at 30%", { type: "COMPARE_CLIFF", dropPct: 30 }],
    ["how much should I add to survive 40%", { type: "TOP_UP", dropPct: 40 }],
    ["where does the glide start", { type: "THRESHOLDS" }],
    ["hello", { type: "HELP" }],
  ])("%s", (q, expected) => {
    expect(parseIntent(q)).toMatchObject(expected);
  });

  it("tolerates typos in keywords", () => {
    expect(parseIntent("what if eth crahses 20%")).toMatchObject({ type: "STRESS_TEST", dropPct: 20 });
    expect(parseIntent("probabilty of a glide overnight")).toMatchObject({ type: "GLIDE_ODDS" });
    expect(editDistance("probabilty", "probability")).toBe(1);
  });

  it("says when it assumed the size of the fall", () => {
    expect(parseIntent("what if eth crashes")).toMatchObject({ type: "STRESS_TEST", dropPct: 20, assumedDrop: true });
  });
});

describe("layer 2: quant", () => {
  it("thresholds are exactly where health crosses each level", () => {
    const t = thresholds(ctx());
    expect(t.health).toBeCloseTo(1.4875, 6);
    for (const [p, h] of [[t.glidePrice, 1.25], [t.floorPrice, 1.02], [t.cliffPrice, 1]] as const) {
      expect(Number(health(E(10), E(20_000), E(p))) / 1e18).toBeCloseTo(h, 5);
    }
  });

  it("normCdf matches known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1)).toBeCloseTo(0.1587, 4);
  });

  it("touch probability is 2·Φ(−1) when the distance equals one standard deviation", () => {
    const sigma = 0.8;
    const hours = 24;
    const sd = sigma * Math.sqrt((hours * 3600) / (365 * 24 * 3600));
    const drop = (1 - Math.exp(-sd)) * 100;
    expect(touchProbability(drop, sigma, hours)).toBeCloseTo(2 * normCdf(-1), 4);
    expect(touchProbability(0, sigma, hours)).toBe(1);
    expect(touchProbability(10, 0, hours)).toBe(0);
    expect(touchProbability(10, sigma, 24)).toBeGreaterThan(touchProbability(10, sigma, 1));
  });

  it("EWMA volatility: zero for a flat price, null with too little data, right scale for a known series", () => {
    expect(ewmaVolatility(Array(50).fill(3500), 60)).toBe(0);
    expect(ewmaVolatility([1, 2, 3], 60)).toBeNull();
    // alternating ±1% every minute: per-period sd ≈ 0.01, annualised × √(525,600)
    const alt = Array.from({ length: 200 }, (_, i) => 3500 * (i % 2 ? 1.01 : 1));
    expect(ewmaVolatility(alt, 60)!).toBeCloseTo(0.00995 * Math.sqrt(525_600), 0);
  });

  it("top-up and borrowing limits land exactly on 1.25 after the fall", () => {
    const c = ctx();
    const t = topUp(c, 30);
    const shocked = E(3_500 * 0.7);
    expect(Number(health(c.collateral + E(t.addEth), c.debt, shocked)) / 1e18).toBeCloseTo(1.25, 4);
    expect(Number(health(c.collateral, c.debt - E(t.repayUsd), shocked)) / 1e18).toBeCloseTo(1.25, 4);
    const d = maxDebt(2, 3_500, 1.25, 30);
    expect(Number(health(E(2), E(d), shocked)) / 1e18).toBeCloseTo(1.25, 4);
  });

  it("Monte Carlo is reproducible, fast, and behaves sensibly", () => {
    const t0 = performance.now();
    const a = monteCarlo(ctx(), 0.8, 8, 300, 7);
    const ms = performance.now() - t0;
    expect(monteCarlo(ctx(), 0.8, 8, 300, 7)).toEqual(a);
    expect(ms).toBeLessThan(3000);
    // no volatility: nothing happens to a healthy loan
    const calm = monteCarlo(ctx(), 0, 8, 50);
    expect(calm).toMatchObject({ pGlide: 0, pBackstop: 0, pCliffLiquidation: 0, softKeptEth: 10, cliffKeptEth: 10 });
    // high volatility: the glide starts (at 1.25) at least as often as the cliff (at 1.00)
    const wild = monteCarlo(ctx(), 3, 24, 200);
    expect(wild.pGlide).toBeGreaterThan(0);
    expect(wild.pGlide).toBeGreaterThanOrEqual(wild.pCliffLiquidation);
  });
});

describe("layer 3: advisories", () => {
  it("status follows health bands", () => {
    expect(statusOf(ctx())).toBe("CLEAR_SKIES");
    expect(statusOf(ctx({ price: E(2_800) }))).toBe("MILD_TURBULENCE"); // 1.19
    expect(statusOf(ctx({ price: E(2_300) }))).toBe("CRITICAL_DESCENT"); // 0.98
    expect(statusOf(ctx({ debt: 0n }))).toBe("NO_POSITION");
  });

  it("the briefing's figures are the computed thresholds", () => {
    const b = briefing(ctx());
    const t = thresholds(ctx());
    expect(b.figures[0].value).toContain(t.glidePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  });

  it("marks levels the price has already passed instead of showing −0%", () => {
    const b = briefing(ctx({ price: E(2_800) })); // gliding: the glide level (2,941) is above the price
    expect(b.figures[0].value).toBe("2,941.18 (already below)");
    expect(b.figures[1].value).toMatch(/\(−\d/);
  });

  it("a stress test reports the exact contract forecast", () => {
    const a = answer({ type: "STRESS_TEST", dropPct: 20, assumedDrop: false }, ctx());
    // 0.8 × 1.4875 = 1.19: glide zone, no cliff liquidation yet
    expect(a.status).toBe("MILD_TURBULENCE");
    expect(a.lines.join(" ")).toContain("health would be 1.19");
    expect(a.figures.find((x) => x.label === "Normal pool seizes")?.value).toBe("0.0000 mETH");
  });

  it("never invents a position: questions that need one say so", () => {
    const empty = ctx({ collateral: 0n, debt: 0n });
    expect(answer({ type: "STRESS_TEST", dropPct: 20, assumedDrop: false }, empty).status).toBe("NO_POSITION");
    // borrowing questions still work with the collateral named in the question
    const b = answer({ type: "SAFE_BORROW", collateralEth: 2 }, empty);
    expect(b.figures[0].value).toBe(`${maxDebt(2, 3_500, 1.4).toLocaleString("en-US", { maximumFractionDigits: 0 })} mUSD`);
  });

  it("describes the right slippage basis and a glide already under way", () => {
    const backstop = answer({ type: "STRESS_TEST", dropPct: 40, assumedDrop: false }, ctx());
    expect(backstop.lines.join(" ")).toContain("backstop's worst case, a sale 5% below the oracle");
    const odds = answer({ type: "GLIDE_ODDS", hours: 8, assumedHours: false }, ctx({ price: E(2_800) }));
    expect(odds.lines[0]).toMatch(/already below the glide level/);
    expect(odds.figures[0].value).toBe("gliding now");
  });

  it("odds answers state their assumptions", () => {
    const a = answer({ type: "GLIDE_ODDS", hours: 8, assumedHours: true }, ctx());
    expect(a.lines.join(" ")).toMatch(/Volatility 80% a year \(assumed\), no trend assumed/);
  });

  it("handles every intent without throwing", () => {
    for (const q of ["help", "what if eth drops 50%", "compare cliff", "safe to sleep", "how much can i borrow", "how much to add", "where is the liquidation price"]) {
      expect(() => answer(parseIntent(q), ctx())).not.toThrow();
    }
    expect(WAD).toBe(10n ** 18n);
  });
});
