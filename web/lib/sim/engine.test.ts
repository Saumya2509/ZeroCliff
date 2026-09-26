import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAmountOut } from "./amm";
import { liquidateCliff, poke } from "./pools";
import { trySell } from "./router";

// The simulator must mirror all four contracts. Vectors come from the REAL contracts
// (contracts/test/vectors/ExportEngineVectors.t.sol); every field must match exactly.

type V = Record<string, string | boolean>;
const vectors = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "contracts", "vectors", "engine.json"), "utf8")) as {
  amm: V[];
  router: V[];
  cliff: V[];
  poke: V[];
};
const b = (x: string | boolean) => BigInt(x as string);

describe("engine mirrors MockAMM", () => {
  it.each(vectors.amm.map((v, i) => [i, v] as const))("quote %i", (_, v) => {
    expect(getAmountOut(b(v.amountIn), b(v.rIn), b(v.rOut))).toBe(b(v.out));
  });
});

describe("engine mirrors SliceRouter", () => {
  it.each(vectors.router.map((v, i) => [i, v] as const))("trySell %i", (_, v) => {
    const amm = { rA: b(v.reserveA), rB: b(v.reserveB) };
    const r = trySell(amm, b(v.amountIn), b(v.oraclePrice), v.backstop as boolean);
    expect(r.ok).toBe(v.ok);
    expect(r.out).toBe(b(v.out));
    expect(amm.rA).toBe(b(v.reserveAAfter));
    expect(amm.rB).toBe(b(v.reserveBAfter));
  });
});

describe("engine mirrors CliffPool", () => {
  it.each(vectors.cliff.map((v, i) => [i, v] as const))("liquidate %i", (_, v) => {
    const p = { c: b(v.collateral), d: b(v.debt) };
    const r = liquidateCliff(p, b(v.price), b(v.repayAmount));
    expect(r.ok).toBe(true);
    expect(r.seized).toBe(b(v.seized));
    expect(p.c).toBe(b(v.collateralAfter));
    expect(p.d).toBe(b(v.debtAfter));
    expect(r.badDebt).toBe(b(v.badDebt));
  });
});

describe("engine mirrors SoftLandingPool.poke (glide, backstop, sale, fee, tip, refund)", () => {
  it.each(vectors.poke.map((v, i) => [i, v] as const))("poke %i", (_, v) => {
    const p = { c: b(v.collateral), d: b(v.debt) };
    const amm = { rA: b(v.reserveA), rB: b(v.reserveB) };
    // each vector starts from a fresh pool, so protocolFees is 0 before the poke
    const r = poke(p, b(v.price), amm, b(v.blocks), 0n);
    expect(r.acted).toBe(v.acted);
    expect(r.lastUpdated).toBe(v.lastGlideUpdated);
    expect(p.c).toBe(b(v.collateralAfter));
    expect(p.d).toBe(b(v.debtAfter));
    expect(amm.rA).toBe(b(v.reserveAAfter));
    expect(amm.rB).toBe(b(v.reserveBAfter));
    expect(r.feesAfter).toBe(b(v.feeTaken)); // fee minus the flat tip, when paid
    expect(r.refund).toBe(b(v.refund));
    expect(r.shortfall).toBe(b(v.badDebt));
  });
});
