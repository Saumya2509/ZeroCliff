// Ghost liquidator (07 §7): behaves like a competitive liquidation bot on the cliff pool, so the ghost
// line is realistic. It repays half the debt of any position below health 1, then dumps the seized
// collateral into the AMM. That dump is the price impact the cliff design causes.

import type { Address } from "viem";
import { cliffPoolAbi, mockAmmAbi, mockTokenAbi } from "../abis";
import { readHealths, reason, sendTx, type Ctx } from "../context";
import { selectClosed, selectLiquidatable } from "../lib/math";

export async function runGhostLiquidator(ctx: Ctx, block: bigint) {
  const users = ctx.registry.list("cliff");
  if (users.length === 0) return;
  const pool = { address: ctx.d.cliffPool, abi: cliffPoolAbi } as const;
  const healths = await readHealths(ctx, pool, users);
  ctx.registry.drop("cliff", selectClosed(users, healths));

  for (const user of selectLiquidatable(users, healths)) {
    try {
      const [, debt] = await ctx.pub.readContract({ ...pool, functionName: "positions", args: [user] });
      const repay = debt / 2n; // the pool's 50% close factor
      if (repay === 0n) continue;
      await ensureAllowance(ctx, ctx.d.mUSD, ctx.d.cliffPool, repay);
      const before = await balanceOf(ctx, ctx.d.mETH);
      await sendTx(ctx, "ghostLiquidator", { ...pool, functionName: "liquidate", args: [user, repay] }, { wait: true });
      ctx.metrics.inc("liquidations");
      const seized = (await balanceOf(ctx, ctx.d.mETH)) - before;
      ctx.log.info({ job: "ghostLiquidator", block, user, repay, seized }, "liquidated");
      if (seized > 0n) await dump(ctx, block, seized);
    } catch (e) {
      ctx.metrics.inc("liquidationFailures");
      ctx.log.warn({ job: "ghostLiquidator", block, user, err: reason(e) }, "liquidation not sent");
      ctx.nonce.resync();
    }
  }
}

async function dump(ctx: Ctx, block: bigint, amount: bigint) {
  await ensureAllowance(ctx, ctx.d.mETH, ctx.d.amm, amount);
  // A liquidator selling seized collateral takes whatever the pool pays (minOut 0). That is the cliff.
  const hash = await sendTx(
    ctx,
    "ghostLiquidator",
    { address: ctx.d.amm, abi: mockAmmAbi, functionName: "swapAForB", args: [amount, 0n, ctx.account.address] },
    { wait: true },
  );
  ctx.metrics.inc("collateralDumps");
  ctx.log.info({ job: "ghostLiquidator", block, amount, hash }, "dumped seized collateral into the AMM");
}

export async function balanceOf(ctx: Ctx, token: Address) {
  return ctx.pub.readContract({ address: token, abi: mockTokenAbi, functionName: "balanceOf", args: [ctx.account.address] });
}

/** Approve exactly what is needed, and only when the current allowance is short. */
export async function ensureAllowance(ctx: Ctx, token: Address, spender: Address, amount: bigint) {
  const allowance = await ctx.pub.readContract({
    address: token,
    abi: mockTokenAbi,
    functionName: "allowance",
    args: [ctx.account.address, spender],
  });
  if (allowance >= amount) return;
  await sendTx(ctx, "approve", { address: token, abi: mockTokenAbi, functionName: "approve", args: [spender, amount] }, { wait: true });
}
