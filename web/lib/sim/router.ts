// Mirrors contracts/src/SliceRouter.sol: sell only when the AMM agrees with the oracle, and only at an
// acceptable price. Skips (returns ok = false, nothing moved) instead of reverting.

import { getAmountOut, swapAForB, type Amm } from "./amm";
import { WAD } from "./glide";

export const BAND_BPS = 200n;
export const MAX_SLIP_BPS = 150n;
export const BACKSTOP_BAND_BPS = 1_000n;
export const BACKSTOP_SLIP_BPS = 500n;

export const slipBps = (backstop: boolean) => (backstop ? BACKSTOP_SLIP_BPS : MAX_SLIP_BPS);

export type SellResult = { ok: boolean; out: bigint; reason?: "price_band" | "slippage" | "no_liquidity" };

export function trySell(amm: Amm, amountIn: bigint, oraclePrice: bigint, backstop: boolean): SellResult {
  if (amountIn === 0n || oraclePrice === 0n) return { ok: false, out: 0n };
  const rA = amm.rA;
  const rB = amm.rB;
  if (rA === 0n || rB === 0n) return { ok: false, out: 0n, reason: "no_liquidity" };

  const spot = (rB * WAD) / rA;
  const diff = spot > oraclePrice ? spot - oraclePrice : oraclePrice - spot;
  const band = backstop ? BACKSTOP_BAND_BPS : BAND_BPS;
  if (diff * 10_000n > oraclePrice * band) return { ok: false, out: 0n, reason: "price_band" };

  const fair = (amountIn * oraclePrice) / WAD;
  const minOut = (fair * (10_000n - slipBps(backstop))) / 10_000n;
  const quoted = getAmountOut(amountIn, rA, rB);
  if (quoted < minOut || quoted === 0n) return { ok: false, out: 0n, reason: "slippage" };

  const out = swapAForB(amm, amountIn, minOut);
  return { ok: true, out };
}
