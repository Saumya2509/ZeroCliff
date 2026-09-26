// Mirrors the unwind logic of contracts/src/SoftLandingPool.sol (poke → _glide / _backstop /
// _applySale) and contracts/src/CliffPool.sol (liquidate), operation for operation.

import { type Amm } from "./amm";
import {
  backstopSlice,
  CLIFF_BONUS,
  CLIFF_CLOSE_FACTOR,
  FEE,
  glideSlice,
  health,
  H_COMFORT,
  H_FLOOR,
  N_MAX,
  R_MAX,
  WAD,
} from "./glide";
import { slipBps, trySell } from "./router";

export type Position = { c: bigint; d: bigint };

export type PokeResult = {
  acted: boolean;
  kind: "none" | "glide" | "backstop";
  skipped: boolean; // router refused (AMM outside band / too much slippage); retries later
  lastUpdated: boolean; // whether lastGlideBlock moves to now (false only on a skip)
  sold: bigint;
  proceeds: bigint;
  repaid: bigint;
  fee: bigint;
  refund: bigint;
  shortfall: bigint; // written off as bad debt
};

const idle = (lastUpdated: boolean): PokeResult => ({
  acted: false,
  kind: "none",
  skipped: false,
  lastUpdated,
  sold: 0n,
  proceeds: 0n,
  repaid: 0n,
  fee: 0n,
  refund: 0n,
  shortfall: 0n,
});

/** Book a completed sale like _applySale: fee, repay, refund any excess. Mutates `p`. */
function applySale(p: Position, sold: bigint, out: bigint) {
  const fee = (out * FEE) / WAD;
  const net = out - fee;
  const repaid = net < p.d ? net : p.d;
  const refund = net - repaid;
  p.c -= sold;
  p.d -= repaid;
  return { fee, repaid, refund };
}

/**
 * SoftLandingPool.poke(user) with the oracle working (strict). `blocks` = blocks since lastGlideBlock.
 * Mutates the position and the AMM exactly as the contract would.
 */
export function pokeSoft(p: Position, price: bigint, amm: Amm, blocks: bigint, rMax: bigint = R_MAX): PokeResult {
  if (p.d === 0n) return idle(true);
  if (blocks === 0n) return idle(false);

  const h = health(p.c, p.d, price);
  if (h >= H_COMFORT) return idle(true);
  if (h < H_FLOOR) return backstop(p, price, amm);

  const n = blocks > N_MAX ? N_MAX : blocks;
  const s = glideSlice(p.c, p.d, price, n, rMax);
  if (s === 0n) return idle(true);

  const sale = trySell(amm, s, price, false);
  if (!sale.ok) return { ...idle(false), skipped: true };
  const { fee, repaid, refund } = applySale(p, s, sale.out);
  return { acted: true, kind: "glide", skipped: false, lastUpdated: true, sold: s, proceeds: sale.out, repaid, fee, refund, shortfall: 0n };
}

function backstop(p: Position, price: bigint, amm: Amm): PokeResult {
  let s = backstopSlice(p.c, p.d, price, slipBps(true));
  const closeOut = s >= p.c;
  if (closeOut) s = p.c;

  let repaid = 0n;
  let fee = 0n;
  let refund = 0n;
  let proceeds = 0n;
  if (s > 0n) {
    const sale = trySell(amm, s, price, true);
    if (!sale.ok) return { ...idle(false), skipped: true };
    proceeds = sale.out;
    ({ fee, repaid, refund } = applySale(p, s, sale.out));
  }
  let shortfall = 0n;
  if (closeOut && p.d > 0n) {
    shortfall = p.d;
    p.d = 0n;
  }
  return { acted: true, kind: "backstop", skipped: false, lastUpdated: true, sold: s, proceeds, repaid, fee, refund, shortfall };
}

export type LiquidationResult = { ok: boolean; seized: bigint; repaid: bigint; badDebt: bigint };

/** CliffPool.liquidate(user, repayAmount). Returns ok = false where the contract would revert. */
export function liquidateCliff(p: Position, price: bigint, repayAmount: bigint): LiquidationResult {
  const h = health(p.c, p.d, price);
  if (h >= WAD) return { ok: false, seized: 0n, repaid: 0n, badDebt: 0n };
  const maxRepay = (p.d * CLIFF_CLOSE_FACTOR) / WAD;
  const r = repayAmount < maxRepay ? repayAmount : maxRepay;
  if (r === 0n) return { ok: false, seized: 0n, repaid: 0n, badDebt: 0n };
  const bySize = (r * CLIFF_BONUS) / price;
  const seized = bySize < p.c ? bySize : p.c;
  p.d -= r;
  p.c -= seized;
  let badDebt = 0n;
  if (p.c === 0n && p.d > 0n) {
    badDebt = p.d;
    p.d = 0n;
  }
  return { ok: true, seized, repaid: r, badDebt };
}

export const TIP = 500_000_000_000_000_000n; // 0.5 mUSD, SoftLandingPool.tip default

/**
 * SoftLandingPool.poke(user) in full: the glide/backstop, then _payTip, which pays the flat tip out of
 * accrued protocol fees only when the poke acted and fees cover it. `fees` is protocolFees before.
 */
export function poke(p: Position, price: bigint, amm: Amm, blocks: bigint, fees: bigint, rMax: bigint = R_MAX, tip = TIP) {
  const r = pokeSoft(p, price, amm, blocks, rMax);
  let feesAfter = fees + r.fee;
  let tipPaid = 0n;
  if (r.acted && tip > 0n && feesAfter >= tip) {
    feesAfter -= tip;
    tipPaid = tip;
  }
  return { ...r, feesAfter, tipPaid };
}
