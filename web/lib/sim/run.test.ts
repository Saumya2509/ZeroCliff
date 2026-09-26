import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sqrt } from "./amm";
import { simulate, type Crash } from "./run";

const crash = (id: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "crashes", `${id}.json`), "utf8")) as Crash;

describe("sqrt", () => {
  it("is floor(sqrt(n)) for values the AMM maths produces", () => {
    for (const n of [2n, 3n, 4n, 10n ** 36n, 10n ** 36n - 1n, 3_500n * 10n ** 39n + 12_345n, 2n ** 200n + 7n]) {
      const r = sqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });
});

describe("Cascade Lab step loop", () => {
  const whip = crash("whipsaw");

  it("is deterministic", () => {
    const a = simulate(whip, { users: 40, beta: 0.3 });
    const b = simulate(whip, { users: 40, beta: 0.3 });
    expect(a.soft).toEqual(b.soft);
    expect(a.cliff).toEqual(b.cliff);
  });

  it("starts both designs from the same position and emits one snapshot per step", () => {
    let calls = 0;
    const r = simulate(whip, { users: 40 }, () => calls++);
    expect(r.snapshots).toHaveLength(whip.prices.length);
    expect(calls).toBe(whip.prices.length);
    // before any unwind, both designs hold the same collateral
    expect(r.snapshots[0].softCollateral).toBeCloseTo(r.snapshots[0].cliffCollateral, 9);
  });

  it("never gives collateral back and reports sane totals", () => {
    const r = simulate(whip, { users: 40, beta: 0.3 });
    for (const k of ["softCollateral", "cliffCollateral"] as const) {
      for (let i = 1; i < r.snapshots.length; i++) expect(r.snapshots[i][k]).toBeLessThanOrEqual(r.snapshots[i - 1][k]);
    }
    for (const s of [r.soft, r.cliff]) {
      expect(s.badDebtUsd).toBeGreaterThanOrEqual(0);
      expect(s.cascadeDepthPct).toBeGreaterThanOrEqual(0);
      expect(s.wiped).toBeLessThanOrEqual(40);
    }
  });

  it("has no cascade at β = 0: the oracle is the market", () => {
    const r = simulate(whip, { users: 40, beta: 0 });
    expect(r.soft.cascadeDepthPct).toBe(0);
    expect(r.cliff.cascadeDepthPct).toBe(0);
    for (const s of r.snapshots) expect(s.oracleCliff).toBeCloseTo(s.market, 6);
  });
});
