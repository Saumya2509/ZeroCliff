// Known borrowers, built from Borrowed events rather than scanning addresses (07 §4):
// backfill from startBlock, then follow new events. Users whose debt reaches zero are dropped on the next check.

import type { Address, PublicClient } from "viem";
import { softLandingPoolAbi } from "./abis";
import type { Deployments } from "./deployments";

export type PoolName = "soft" | "cliff";

export class Registry {
  readonly users: Record<PoolName, Set<Address>> = { soft: new Set(), cliff: new Set() };
  private unwatch: (() => void)[] = [];

  constructor(
    private readonly client: PublicClient,
    private readonly d: Deployments,
    private readonly logRange: number,
    private readonly pollMs: number,
  ) {}

  // Borrowed comes from LendingPoolBase, so one ABI decodes it for both pools.
  private pools() {
    return [
      ["soft", { address: this.d.softLandingPool, abi: softLandingPoolAbi }],
      ["cliff", { address: this.d.cliffPool, abi: softLandingPoolAbi }],
    ] as const;
  }

  async backfill(): Promise<bigint> {
    const latest = await this.client.getBlockNumber();
    const range = BigInt(this.logRange);
    for (const [name, pool] of this.pools()) {
      for (let from = BigInt(this.d.startBlock); from <= latest; from += range) {
        const to = from + range - 1n < latest ? from + range - 1n : latest;
        const logs = await this.client.getContractEvents({ ...pool, eventName: "Borrowed", fromBlock: from, toBlock: to });
        for (const l of logs) if (l.args.user) this.users[name].add(l.args.user);
      }
    }
    return latest;
  }

  watch(fromBlock: bigint) {
    for (const [name, pool] of this.pools()) {
      this.unwatch.push(
        this.client.watchContractEvent({
          ...pool,
          eventName: "Borrowed",
          fromBlock,
          pollingInterval: this.pollMs,
          onLogs: (logs) => {
            for (const l of logs) if (l.args.user) this.users[name].add(l.args.user);
          },
        }),
      );
    }
  }

  list(pool: PoolName): Address[] {
    return [...this.users[pool]];
  }

  drop(pool: PoolName, users: Address[]) {
    for (const u of users) this.users[pool].delete(u);
  }

  stop() {
    for (const u of this.unwatch) u();
    this.unwatch = [];
  }
}
