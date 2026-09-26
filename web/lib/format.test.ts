import { describe, expect, it } from "vitest";
import { formatHealth, formatPercent, formatPrice, formatToken, healthState, parseAmount } from "./format";
import { MAX_UINT, WAD } from "./sim/glide";

describe("format", () => {
  it("formats tokens with units and fixed decimals", () => {
    expect(formatToken(10n * WAD, "mETH")).toBe("10.00 mETH");
    expect(formatToken(20_000n * WAD, "mUSD")).toBe("20,000.00 mUSD");
    expect(formatToken(4n * 10n ** 16n, "mETH", 4)).toBe("0.0400 mETH");
  });

  it("formats health to 2 decimals, and no debt", () => {
    expect(formatHealth(1_314_999_999_999_999_999n)).toBe("1.31");
    expect(formatHealth(MAX_UINT)).toBe("No debt");
  });

  it("formats percentages and prices", () => {
    expect(formatPercent(3_100_000_000_000_000n)).toBe("0.31%");
    expect(formatPrice(3_500n * WAD)).toBe("3,500.00 mUSD");
  });

  it("parses user input to WAD, rejecting junk", () => {
    expect(parseAmount("1.5")).toBe(15n * 10n ** 17n);
    expect(parseAmount("20,000")).toBe(20_000n * WAD);
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("abc")).toBeUndefined();
    expect(parseAmount("-1")).toBeUndefined();
  });

  it("maps health to states at the contract thresholds", () => {
    expect(healthState(1_500_000_000_000_000_000n)).toBe("safe");
    expect(healthState(1_250_000_000_000_000_000n)).toBe("safe");
    expect(healthState(1_200_000_000_000_000_000n)).toBe("gliding");
    expect(healthState(1_000_000_000_000_000_000n)).toBe("backstop");
    expect(healthState(MAX_UINT)).toBe("none");
  });
});
