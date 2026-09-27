// Oracle pusher (07 §6), live mode only: fetch a signed Pyth update from Hermes and submit it through
// the adapter, which pays the Pyth fee and refunds the rest.

import { HermesClient } from "@pythnetwork/hermes-client";
import { pythOracleAdapterAbi } from "../abis";
import { reason, sendTx, type Ctx } from "../context";

const pythFeeAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

let hermes: HermesClient | undefined;
let lastPushMs = 0;

export function oraclePushDue(ctx: Ctx, now = Date.now()) {
  return (
    ctx.cfg.MODE === "live" &&
    ctx.cfg.ENABLE_ORACLE_PUSHER &&
    ctx.d.oracleMode === "pyth" &&
    now - lastPushMs >= ctx.cfg.ORACLE_PUSH_EVERY_S * 1000
  );
}

export async function pushOracle(ctx: Ctx, block: bigint, wait = false) {
  if (ctx.d.oracleMode !== "pyth") return;
  const adapter = { address: ctx.d.pythAdapter, abi: pythOracleAdapterAbi } as const;
  try {
    // Only send Authorization header if a key is explicitly provided (public Hermes needs no key)
    const clientOptions = ctx.cfg.PYTH_API_KEY ? { accessToken: ctx.cfg.PYTH_API_KEY } : undefined;
    hermes ??= new HermesClient(ctx.cfg.HERMES_URL, clientOptions);
    const [feedId, pyth] = await Promise.all([
      ctx.pub.readContract({ ...adapter, functionName: "feedId" }),
      ctx.pub.readContract({ ...adapter, functionName: "pyth" }),
    ]);
    const upd = await hermes.getLatestPriceUpdates([feedId], { encoding: "hex" });
    const data = upd.binary.data.map((x) => (x.startsWith("0x") ? x : `0x${x}`) as `0x${string}`);
    const fee = await ctx.pub.readContract({ address: pyth, abi: pythFeeAbi, functionName: "getUpdateFee", args: [data] });
    const hash = await sendTx(ctx, "oraclePusher", { ...adapter, functionName: "update", args: [data], value: fee }, { wait });
    lastPushMs = Date.now();
    ctx.metrics.inc("oraclePushes");
    ctx.log.info({ job: "oraclePusher", block, hash, fee }, "pushed Pyth update");
  } catch (e) {
    ctx.metrics.inc("oraclePushFailures");
    ctx.log.warn({ job: "oraclePusher", block, err: reason(e) }, "Pyth update failed");
    ctx.nonce.resync();
  }
}
