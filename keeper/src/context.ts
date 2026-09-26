import type { Logger } from "pino";
import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type PublicClient,
  type SimulateContractParameters,
  type Transport,
  type WalletClient,
} from "viem";
import { cliffPoolAbi, softLandingPoolAbi } from "./abis";
import type { Config } from "./config";
import type { HealthRead } from "./lib/math";
import type { Deployments } from "./deployments";
import type { Metrics } from "./lib/metrics";
import type { NonceManager } from "./lib/nonce";
import type { Registry } from "./registry";

export type Ctx = {
  cfg: Config;
  d: Deployments;
  pub: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  account: Account;
  nonce: NonceManager;
  registry: Registry;
  metrics: Metrics;
  log: Logger;
  /** Hashes sent but not yet mined. The loop skips a block while any are pending. */
  pending: Set<Hash>;
};

/**
 * healthOf for many users in one round trip: Multicall3 where the chain has it, otherwise one batched
 * JSON-RPC request (a fresh anvil has no Multicall3).
 */
export async function readHealths(ctx: Ctx, pool: { address: Address; abi: typeof softLandingPoolAbi | typeof cliffPoolAbi }, users: Address[]): Promise<HealthRead[]> {
  if (ctx.pub.chain?.contracts?.multicall3) {
    return (await ctx.pub.multicall({
      contracts: users.map((u) => ({ address: pool.address, abi: softLandingPoolAbi, functionName: "healthOf", args: [u] }) as const),
      allowFailure: true,
    })) as HealthRead[];
  }
  const settled = await Promise.allSettled(
    users.map((u) => ctx.pub.readContract({ address: pool.address, abi: softLandingPoolAbi, functionName: "healthOf", args: [u] })),
  );
  return settled.map((s) => (s.status === "fulfilled" ? { status: "success", result: s.value } : { status: "failure", error: s.reason }));
}

/** Short, log-friendly reason for a failed simulation or send. */
export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Simulate, then send with the next nonce (07 §5 rules). A transaction that would revert is never sent:
 * the simulation throws first. Receipts are tracked in the background unless `wait` is set, for steps
 * whose next step depends on this one being mined.
 */
export async function sendTx<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
  const args extends ContractFunctionArgs<abi, "nonpayable" | "payable", name>,
>(
  ctx: Ctx,
  label: string,
  params: Omit<SimulateContractParameters<abi, name, args, Chain, Chain, Account>, "account" | "chain">,
  opts: { wait?: boolean } = {},
): Promise<Hash> {
  const { request } = await ctx.pub.simulateContract({ ...params, account: ctx.account, chain: ctx.wallet.chain } as unknown as SimulateContractParameters);
  const nonce = await ctx.nonce.next();
  let hash: Hash;
  try {
    hash = await ctx.wallet.writeContract({ ...(request as Parameters<typeof ctx.wallet.writeContract>[0]), nonce });
  } catch (e) {
    ctx.nonce.resync();
    throw e;
  }
  ctx.pending.add(hash);
  const receipt = ctx.pub
    .waitForTransactionReceipt({ hash })
    .then((r) => {
      if (r.status === "reverted") {
        ctx.metrics.inc("txReverted");
        ctx.log.warn({ job: label, hash, block: r.blockNumber }, "transaction reverted after a passing simulation");
      } else {
        ctx.log.debug({ job: label, hash, block: r.blockNumber, gasUsed: r.gasUsed }, "confirmed");
      }
      return r;
    })
    .finally(() => ctx.pending.delete(hash));
  if (opts.wait) {
    const r = await receipt;
    if (r.status === "reverted") throw new Error(`${label} reverted: ${hash}`);
  } else {
    receipt.catch((e) => ctx.log.warn({ job: label, hash, err: reason(e) }, "receipt not found"));
  }
  return hash;
}
