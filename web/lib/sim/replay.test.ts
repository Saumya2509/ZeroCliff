import { describe, expect, it } from "vitest";
import { WAD } from "./glide";
import { replay, STYLISED_CRASH } from "./replay";

describe("replay", () => {
  it("matches the contract crash scenario direction: soft landing keeps more equity", () => {
    // Same three users as contracts/test/scenarios/CrashScenario.t.sol (10 mETH each)
    for (const debt of [20_000n, 19_000n, 18_000n]) {
      const r = replay(STYLISED_CRASH, 60, 10n * WAD, debt * WAD);
      const last = r.points[r.points.length - 1];
      expect(last.softEquity).toBeGreaterThan(last.cliffEquity);
      expect(r.softBadDebt).toBe(0n);
      expect(r.liquidations).toBeGreaterThan(0);
      expect(r.glides).toBeGreaterThan(0);
    }
  });

  it("does nothing to a safe position on a flat path", () => {
    const r = replay([3500, 3500, 3500], 10, 10n * WAD, 10_000n * WAD);
    expect(r.glides + r.backstops + r.liquidations).toBe(0);
    expect(r.points.at(-1)!.soft).toBe(10);
  });
});
