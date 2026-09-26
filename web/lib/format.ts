import { formatUnits, parseUnits } from "viem";
import { MAX_UINT } from "./sim/glide";

// WAD (18-decimal) values → strings for people. Numbers always carry units and fixed decimals.

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

/** WAD → JS number. Fine for display; never use the result for maths that goes back onchain. */
export function wadToNumber(x: bigint): number {
  return Number(formatUnits(x, 18));
}

/** Token amount with 2–4 decimals, e.g. "10.00 mETH". */
export function formatToken(x: bigint, symbol: string, decimals = 2): string {
  return `${nf(decimals, decimals).format(wadToNumber(x))} ${symbol}`;
}

/** WAD → fixed decimals, rounded down (never shows a safety number higher than it is). */
function truncWad(x: bigint, decimals: number): string {
  const scaled = x / 10n ** BigInt(18 - decimals);
  const s = scaled.toString().padStart(decimals + 1, "0");
  const whole = BigInt(s.slice(0, -decimals));
  return `${new Intl.NumberFormat("en-US").format(whole)}.${s.slice(-decimals)}`;
}

/** Health with 2 decimals, rounded down; "No debt" when there is none. */
export function formatHealth(h: bigint): string {
  if (h >= MAX_UINT / 2n) return "No debt";
  return truncWad(h, 2);
}

/** A WAD share as a percentage, e.g. 0.0031e18 → "0.31%". */
export function formatPercent(x: bigint, decimals = 2): string {
  return `${truncWad(x * 100n, decimals)}%`;
}

/** Price per mETH, e.g. "3,500.00 mUSD". */
export function formatPrice(p: bigint): string {
  return `${nf(2, 2).format(wadToNumber(p))} mUSD`;
}

/** Parse user input to WAD. Returns undefined for empty or invalid input. */
export function parseAmount(input: string): bigint | undefined {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return undefined;
  try {
    return parseUnits(s, 18);
  } catch {
    return undefined;
  }
}

export type HealthState = "safe" | "gliding" | "backstop" | "none";

export function healthState(h: bigint): HealthState {
  if (h >= MAX_UINT / 2n) return "none";
  if (h >= 1_250_000_000_000_000_000n) return "safe";
  if (h >= 1_020_000_000_000_000_000n) return "gliding";
  return "backstop";
}

export const healthLabel: Record<HealthState, string> = {
  safe: "Safe",
  gliding: "Gliding",
  backstop: "Backstop",
  none: "No debt",
};

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
