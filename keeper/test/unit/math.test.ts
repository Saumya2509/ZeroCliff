import { describe, expect, it } from "vitest";
import { arbSize, chunk, getAmountOut, H_COMFORT, NO_DEBT, selectAtRisk, selectClosed, selectLiquidatable, sqrt, WAD, type HealthRead } from "../../src/lib/math";

const h = (x: number): HealthRead => ({ status: "success", result: BigInt(Math.round(x * 1e6)) * 10n ** 12n });
const fail: HealthRead = { status: "failure", error: new Error("oracle stale") };

describe("selectAtRisk", () => {
  it("pokes below comfort only: 1.30 no, 1.25 no, 1.24 yes, 1.01 yes (backstop)", () => {
    expect(selectAtRisk(["a", "b", "c", "d"], [h(1.3), h(1.25), h(1.24), h(1.01)])).toEqual(["c", "d"]);
  });
  it("uses the contract's exact threshold", () => {
    expect(selectAtRisk(["x", "y"], [{ status: "success", result: H_COMFORT }, { status: "success", result: H_COMFORT - 1n }])).toEqual(["y"]);
  });
  it("skips failed reads and debt-free users", () => {
    expect(selectAtRisk(["a", "b"], [fail, { status: "success", result: NO_DEBT }])).toEqual([]);
  });
});

describe("selectLiquidatable / selectClosed", () => {
  it("liquidates the cliff ghost only below health 1", () => {
    expect(selectLiquidatable(["a", "b", "c"], [h(1.0), h(0.99), h(1.01)])).toEqual(["b"]);
  });
  it("drops users with no debt", () => {
    expect(selectClosed(["a", "b"], [{ status: "success", result: NO_DEBT }, h(2)])).toEqual(["a"]);
  });
});

describe("chunk", () => {
  it("never exceeds the batch size and keeps every user once, in order", () => {
    const users = Array.from({ length: 47 }, (_, i) => i);
    const batches = chunk(users, 20);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 7]);
    expect(batches.flat()).toEqual(users);
    expect(chunk([], 20)).toEqual([]);
  });
  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("arbSize", () => {
  const rA = 1_000n * WAD;
  const rB = 3_500_000n * WAD; // spot 3,500
  const swap = (aToB: boolean, amountIn: bigint) => {
    if (aToB) {
      const out = getAmountOut(amountIn, rA, rB);
      return ((rB - out) * WAD) / (rA + amountIn);
    }
    const out = getAmountOut(amountIn, rB, rA);
    return ((rB + amountIn) * WAD) / (rA - out);
  };

  it("does nothing inside the threshold", () => {
    expect(arbSize(rA, rB, 3_505n * WAD, 3_000n, 200n, 30n)).toBeNull(); // 0.14% gap
  });

  it("moves the price α of the way down when the pool is above the oracle", () => {
    const target = 3_400n * WAD;
    const t = arbSize(rA, rB, target, 3_000n, 10_000n, 30n)!;
    expect(t.aToB).toBe(true);
    const after = swap(true, t.amountIn);
    const expected = 3_470n * WAD; // 3,500 − 0.3 × 100
    const err = after > expected ? after - expected : expected - after;
    expect(err * 10_000n).toBeLessThan(expected); // within 1 bp
  });

  it("moves the price α of the way up when the pool is below the oracle", () => {
    const t = arbSize(rA, rB, 3_600n * WAD, 5_000n, 10_000n, 30n)!;
    expect(t.aToB).toBe(false);
    const after = swap(false, t.amountIn);
    const expected = 3_550n * WAD;
    const err = after > expected ? after - expected : expected - after;
    expect(err * 10_000n).toBeLessThan(expected);
  });

  it("respects the budget in both directions", () => {
    const up = arbSize(rA, rB, 5_000n * WAD, 10_000n, 200n, 30n)!;
    expect(up.amountIn).toBe((rB * 200n) / 10_000n); // 2% of the mUSD reserve
    const down = arbSize(rA, rB, 2_000n * WAD, 10_000n, 200n, 30n)!;
    expect(down.amountIn).toBe((((rB * 200n) / 10_000n) * WAD) / ((rB * WAD) / rA)); // same value in mETH
  });
});

describe("sqrt", () => {
  it("is exact floor(sqrt(n)), including large values", () => {
    for (const n of [2n, 99n, 10n ** 36n + 1n, 3_500n * 10n ** 42n + 7n]) {
      const r = sqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });
});
