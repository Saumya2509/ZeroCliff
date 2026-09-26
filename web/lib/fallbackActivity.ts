// Fallback when the indexer is down or not configured (06 §7): read a user's events straight from the
// chain, limited to the last ~5,000 blocks so public RPCs accept the query.

import type { Address, PublicClient } from "viem";
import { cliff, deployment, pool } from "./contracts";

export const FALLBACK_WINDOW = 5_000n;

/** The three reads the fallback needs; any chain's public client fits. */
type Reader = Pick<PublicClient, "getBlockNumber" | "getContractEvents" | "readContract">;

export async function fetchChainEvents(client: Reader, user: Address) {
  const latest = await client.getBlockNumber();
  const windowStart = latest > FALLBACK_WINDOW ? latest - FALLBACK_WINDOW : 0n;
  const fromBlock = windowStart > deployment.startBlock ? windowStart : deployment.startBlock;
  const [soft, ghost, softPos, ghostPos] = await Promise.all([
    client.getContractEvents({ ...pool, args: { user }, fromBlock, toBlock: latest, strict: false }),
    client.getContractEvents({ ...cliff, args: { user }, fromBlock, toBlock: latest, strict: false }),
    client.readContract({ ...pool, functionName: "positions", args: [user], blockNumber: latest }),
    client.readContract({ ...cliff, functionName: "positions", args: [user], blockNumber: latest }),
  ]);
  return {
    soft,
    ghost,
    current: { soft: softPos[0], ghost: ghostPos[0] },
    /** Set when older history may exist before the window. */
    partialFrom: fromBlock > deployment.startBlock ? fromBlock : undefined,
  };
}
