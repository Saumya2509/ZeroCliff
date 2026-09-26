import { describe, expect, it } from "vitest";
import { EQUAL_EPSILON, equity, formatWad, lossesAvoided, WAD } from "../src/lib/lossesAvoided";

const E = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const price = 2_000n * WAD;
const pos = (user: string, c: number, d: number, refunded = 0) => ({ user, collateral: E(c), debt: E(d), refunded: E(refunded) });

describe("equity", () => {
  it("is collateral minus debt at the oracle price, in mETH", () => {
    expect(equity(pos("a", 10, 10_000), price)).toBe(E(5));
  });
  it("counts refunded mUSD as the user's", () => {
    expect(equity(pos("a", 0, 0, 2_000), price)).toBe(E(1));
  });
});

describe("lossesAvoided", () => {
  it("uses net equity, not collateral lost: a glide that sold 2 mETH to repay 4,000 is not a 2 mETH loss", () => {
    // both started 10 mETH / 16,000 mUSD. Soft sold 2 mETH at 2,000 (repaid 4,000); cliff was liquidated:
    // repaid 8,000 and lost 8,000 × 1.08 / 2,000 = 4.32 mETH.
    const r = lossesAvoided([pos("a", 8, 12_000)], [pos("A", 5.68, 8_000)], price);
    // soft equity 8 − 6 = 2; cliff equity 5.68 − 4 = 1.68
    expect(r.totalWei).toBe(E(0.32));
    expect(r).toMatchObject({ pairedUsers: 1, usersBetter: 1, usersWorse: 0, usersEqual: 0 });
  });

  it("keeps negative advantages in the sum (whipsaw: glide sold, cliff never triggered)", () => {
    const r = lossesAvoided(
      [pos("a", 8, 12_000), pos("b", 9.5, 15_050)],
      [pos("a", 5.68, 8_000), pos("b", 10, 16_000)],
      price,
    );
    // b: soft 9.5 − 7.525 = 1.975, cliff 10 − 8 = 2 → −0.025
    expect(r.totalWei).toBe(E(0.32) - E(0.025));
    expect(r).toMatchObject({ pairedUsers: 2, usersBetter: 1, usersWorse: 1 });
  });

  it("only counts users with both positions, matches addresses case-insensitively, and counts seeded wallets", () => {
    const r = lossesAvoided(
      [pos("0xAbC", 10, 0), pos("0xdef", 10, 0)],
      [pos("0xabc", 10, 0)],
      price,
      new Set(["0xABC"]),
    );
    expect(r).toMatchObject({ pairedUsers: 1, usersEqual: 1, seededUsers: 1, totalWei: 0n });
  });

  it("treats wei-level differences as equal", () => {
    const s = pos("a", 10, 0);
    const r = lossesAvoided([{ ...s, collateral: s.collateral + EQUAL_EPSILON }], [s], price);
    expect(r.usersEqual).toBe(1);
  });

  it("rejects a zero price", () => {
    expect(() => lossesAvoided([], [], 0n)).toThrow();
  });
});

describe("formatWad", () => {
  it("truncates towards zero and keeps the sign", () => {
    expect(formatWad(E(12.41239))).toBe("12.4123");
    expect(formatWad(-E(0.02509))).toBe("-0.0250");
    expect(formatWad(-1n)).toBe("0.0000");
    expect(formatWad(0n, 0)).toBe("0");
  });
});
