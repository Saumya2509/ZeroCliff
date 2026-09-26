import { describe, expect, it } from "vitest";
import { forecastLanding } from "./forecast";
import { H_COMFORT, health, WAD } from "./glide";

const w = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

describe("forecastLanding", () => {
  it("safe: health stays above 1.25, nothing sold", () => {
    const f = forecastLanding(10n * WAD, 10_000n * WAD, w(3_150), 60); // H ≈ 2.68
    expect(f.kind).toBe("safe");
    expect(f.sold).toBe(0n);
  });

  it("glide: between floor and comfort, sells gradually toward 1.25", () => {
    const f = forecastLanding(10n * WAD, 20_000n * WAD, w(2_800), 120); // H = 1.19
    expect(f.kind).toBe("glide");
    expect(f.sold).toBeGreaterThan(0n);
    expect(f.settleBlocks).toBeGreaterThan(1);
    expect(f.path.healthPath.at(-1)!).toBeGreaterThan(f.shockedHealth);
  });

  it("backstop: below the floor it is not reported as safe (regression)", () => {
    // The screenshot case: 7.0068 mETH / 12,240.56 mUSD after a −20% shock from 2,380 → H ≈ 0.92
    const c = w(7.0068);
    const d = w(12_240.56);
    const p = w(2_380 * 0.8);
    const f = forecastLanding(c, d, p, 120);
    expect(f.kind).toBe("backstop");
    expect(f.closeOut).toBe(false);
    expect(f.sold).toBeGreaterThan(0n);
    // at worst-case execution the backstop lands at or above comfort
    const repayWorst = (((f.sold * p) / WAD) * 95n / 100n * 999n) / 1000n;
    expect(health(f.final, d - repayWorst, p)).toBeGreaterThanOrEqual(H_COMFORT - 10n ** 12n);
  });

  it("backstop close-out when the position is underwater", () => {
    const f = forecastLanding(10n * WAD, 20_000n * WAD, w(1_500), 60); // collateral worth 15,000 < debt
    expect(f.kind).toBe("backstop");
    expect(f.closeOut).toBe(true);
    expect(f.final).toBe(0n);
  });
});

describe("forecastLanding cost", () => {
  it("cliff cost is exactly the 8% bonus on what it repaid", () => {
    const p = w(2_300);
    const f = forecastLanding(10n * WAD, 20_000n * WAD, p, 60);
    const bonus = (f.cliff.seized * p) / WAD - f.cliff.repaid;
    expect(f.cost.cliff).toBe(bonus);
    expect(Number(bonus) / Number(f.cliff.repaid)).toBeCloseTo(0.08, 3);
  });

  it("gliding costs only the fee", () => {
    const p = w(2_800);
    const f = forecastLanding(10n * WAD, 20_000n * WAD, p, 120);
    expect(f.kind).toBe("glide");
    expect(f.cost.soft).toBe((((f.sold * p) / WAD) * 1_000_000_000_000_000n) / WAD);
  });
});
