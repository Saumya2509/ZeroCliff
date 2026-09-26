// Glider (07 §5): poke every Soft Landing position below comfort, in batches of ≤ 20 via pokeMany.

import { parseEventLogs } from "viem";
import { softLandingPoolAbi } from "../abis";
import { readHealths, reason, sendTx, type Ctx } from "../context";
import { chunk, selectAtRisk, selectClosed } from "../lib/math";
import { pushOracle } from "./oraclePusher";

export async function runGlider(ctx: Ctx, block: bigint) {
  const users = ctx.registry.list("soft");
  if (users.length === 0) return;
  const pool = { address: ctx.d.softLandingPool, abi: softLandingPoolAbi } as const;

  // one round trip for every health value
  const healths = await readHealths(ctx, pool, users);
  ctx.registry.drop("soft", selectClosed(users, healths));
  const atRisk = selectAtRisk(users, healths);
  if (atRisk.length === 0) return;

  // fresh price first, mined before the pokes are simulated against it
  if (ctx.cfg.MODE === "live" && ctx.cfg.ENABLE_ORACLE_PUSHER) await pushOracle(ctx, block, true);

  for (const batch of chunk(atRisk, ctx.cfg.BATCH_SIZE)) {
    try {
      const hash = await sendTx(ctx, "glider", { ...pool, functionName: "pokeMany", args: [batch] });
      ctx.metrics.inc("pokesSent");
      ctx.metrics.inc("usersPoked", batch.length);
      ctx.log.info({ job: "glider", block, count: batch.length, hash }, "poked");
      // Count router skips from the receipt without holding up the loop.
      ctx.pub
        .waitForTransactionReceipt({ hash })
        .then((r) => {
          const skips = parseEventLogs({ abi: softLandingPoolAbi, logs: r.logs, eventName: "GlideSkipped" });
          if (skips.length) {
            ctx.metrics.inc("glideSkipsSeen", skips.length);
            ctx.log.info({ job: "glider", block: r.blockNumber, count: skips.length }, "router skipped slices (AMM outside band); they retry next block");
          }
        })
        .catch(() => {});
    } catch (e) {
      ctx.metrics.inc("pokeFailures");
      ctx.log.warn({ job: "glider", block, count: batch.length, err: reason(e) }, "poke not sent; will retry next block");
      ctx.nonce.resync();
    }
  }
}
