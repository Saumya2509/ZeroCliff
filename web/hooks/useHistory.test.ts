import { describe, expect, it } from "vitest";
import { buildPoints, type ActivityItem } from "./useHistory";

const item = (pool: "soft" | "cliff", block: number, collateralDelta: bigint): ActivityItem => ({
  key: `${pool}-${block}-${collateralDelta}`,
  pool,
  kind: collateralDelta > 0n ? "deposit" : pool === "soft" ? "glide" : "liquidated",
  block: BigInt(block),
  hash: "0x00",
  collateralDelta,
  debtDelta: 0n,
});

describe("buildPoints", () => {
  it("rebuilds collateral after each event, walking back from the current values", () => {
    const newestFirst = [item("soft", 30, -2n), item("cliff", 20, -4n), item("soft", 10, 10n), item("cliff", 10, 10n)];
    expect(buildPoints(newestFirst, { soft: 8n, ghost: 6n })).toEqual([
      { block: 10, soft: 10n, ghost: 10n },
      { block: 20, soft: 10n, ghost: 6n },
      { block: 30, soft: 8n, ghost: 6n },
    ]);
  });

  it("stays correct when older history was cut off: the chart just starts later", () => {
    // deposits happened before the window; only the glide is visible
    expect(buildPoints([item("soft", 500, -1n)], { soft: 9n, ghost: 10n })).toEqual([{ block: 500, soft: 9n, ghost: 10n }]);
  });

  it("returns nothing without events", () => {
    expect(buildPoints([], { soft: 1n, ghost: 1n })).toEqual([]);
  });
});
