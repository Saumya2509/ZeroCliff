import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backstopSlice,
  cliffOutcome,
  glideRate,
  glideSlice,
  health,
  previewPath,
  sNeeded,
  WAD,
} from "./glide";

// Parity with the contract: every vector exported by contracts/test/vectors/ExportVectors.t.sol
// must match exactly (same integer maths, same rounding).
const dir = join(__dirname, "..", "..", "..", "contracts", "vectors");
const files = readdirSync(dir).filter((f) => f.startsWith("glide_") && f.endsWith(".json"));

type Vector = Record<string, string | string[]>;
const vectors: Vector[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const b = (s: string | string[]) => BigInt(s as string);

describe("parity with SoftLandingPool (contract test vectors)", () => {
  it("has all 50 vectors", () => {
    expect(vectors.length).toBe(50);
  });

  it.each(vectors.map((v) => [Number(v.index), v] as const))("vector %i matches exactly", (_, v) => {
    const c = b(v.collateralBefore);
    const d = b(v.debtBefore);
    const p = b(v.price);
    const h = health(c, d, p);
    expect(h).toBe(b(v.health));
    expect(glideRate(h)).toBe(b(v.glideRate));
    expect(sNeeded(c, d, p)).toBe(b(v.sNeeded));
    expect(glideSlice(c, d, p, b(v.blocks))).toBe(b(v.glideSlice));
    expect(backstopSlice(c, d, p, 500n)).toBe(b(v.backstopSlice));
    const { healthPath, collateralPath } = previewPath(c, d, p, Number(v.previewBlocks));
    expect(healthPath).toEqual((v.previewHealth as string[]).map(BigInt));
    expect(collateralPath).toEqual((v.previewCollateral as string[]).map(BigInt));
  });
});

describe("cliff model", () => {
  it("liquidates 50% with an 8% bonus below H = 1", () => {
    const out = cliffOutcome(10n * WAD, 20_000n * WAD, 2_300n * WAD);
    expect(out.liquidated).toBe(true);
    expect(out.repaid).toBe(10_000n * WAD);
    expect(out.seized).toBe((10_000n * WAD * 1_080_000_000_000_000_000n) / WAD / 2_300n);
  });

  it("leaves healthy positions alone", () => {
    expect(cliffOutcome(10n * WAD, 20_000n * WAD, 3_500n * WAD).liquidated).toBe(false);
  });
});
