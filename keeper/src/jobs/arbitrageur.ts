// Arbitrageur (07 §8): every ARB_EVERY_BLOCKS, move the MockAMM a share α of the way back to the oracle,
// within a budget. The cap matters: unlimited arbitrage would erase the cliff's price impact.

import { mockAmmAbi, mockOracleAbi, softLandingPoolAbi } from "../abis";
import { reason, sendTx, type Ctx } from "../context";
import { arbSize, getAmountOut } from "../lib/math";
import { balanceOf, ensureAllowance } from "./ghostLiquidator";

export async function runArbitrageur(ctx: Ctx, block: bigint) {
  const amm = { address: ctx.d.amm, abi: mockAmmAbi } as const;
  try {
    const oracleAddr = await ctx.pub.readContract({ address: ctx.d.softLandingPool, abi: softLandingPoolAbi, functionName: "oracle" });
    const [[price], rA, rB] = await Promise.all([
      ctx.pub.readContract({ address: oracleAddr, abi: mockOracleAbi, functionName: "getPrice" }),
      ctx.pub.readContract({ ...amm, functionName: "reserveA" }),
      ctx.pub.readContract({ ...amm, functionName: "reserveB" }),
    ]);
    const trade = arbSize(rA, rB, price, BigInt(ctx.cfg.ARB_ALPHA_BPS), BigInt(ctx.cfg.ARB_BUDGET_BPS), BigInt(ctx.cfg.ARB_THRESHOLD_BPS));
    if (!trade) return;

    const tokenIn = trade.aToB ? ctx.d.mETH : ctx.d.mUSD;
    const have = await balanceOf(ctx, tokenIn);
    const amountIn = trade.amountIn < have ? trade.amountIn : have;
    if (amountIn === 0n) {
      ctx.log.warn({ job: "arbitrageur", block, need: trade.amountIn, token: trade.aToB ? "mETH" : "mUSD" }, "no inventory to arbitrage with");
      return;
    }
    const [rIn, rOut] = trade.aToB ? [rA, rB] : [rB, rA];
    // 1% tolerance on the quote in case another trade lands first
    const minOut = (getAmountOut(amountIn, rIn, rOut) * 99n) / 100n;
    await ensureAllowance(ctx, tokenIn, ctx.d.amm, amountIn);
    const hash = await sendTx(ctx, "arbitrageur", {
      ...amm,
      functionName: trade.aToB ? "swapAForB" : "swapBForA",
      args: [amountIn, minOut, ctx.account.address],
    });
    ctx.metrics.inc("arbSwaps");
    ctx.log.info({ job: "arbitrageur", block, aToB: trade.aToB, amountIn, spot: trade.spot, oracle: price, hash }, "arbitraged");
  } catch (e) {
    ctx.metrics.inc("arbFailures");
    ctx.log.warn({ job: "arbitrageur", block, err: reason(e) }, "arbitrage not sent");
    ctx.nonce.resync();
  }
}
