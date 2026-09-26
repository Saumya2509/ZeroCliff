"use client";

import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { cliff, isDeployed, mETH, mockOracle, mUSD, pool } from "@/lib/contracts";
import { MAX_UINT } from "@/lib/sim/glide";

const REFRESH = 4_000;

export type Position = { collateral: bigint; debt: bigint; health: bigint };

const asPosition = (pos: unknown, health: unknown): Position | undefined => {
  if (!Array.isArray(pos)) return undefined;
  const [collateral, debt] = pos as [bigint, bigint];
  return { collateral, debt, health: typeof health === "bigint" ? health : debt === 0n ? MAX_UINT : 0n };
};

/** The user's Soft Landing position and their ghost in the cliff pool. */
export function usePosition(user?: Address) {
  const q = useReadContracts({
    contracts: [
      { ...pool, functionName: "positions", args: [user!] },
      { ...pool, functionName: "healthOf", args: [user!] },
      { ...cliff, functionName: "positions", args: [user!] },
      { ...cliff, functionName: "healthOf", args: [user!] },
    ],
    query: { enabled: !!user && isDeployed, refetchInterval: REFRESH },
  });
  const d = q.data;
  const soft = d ? asPosition(d[0].result, d[1].result) : undefined;
  const ghost = d ? asPosition(d[2].result, d[3].result) : undefined;
  return {
    ...q,
    soft,
    ghost,
    hasPosition: !!soft && soft.collateral > 0n,
    hasGhost: !!ghost && (ghost.collateral > 0n || ghost.debt > 0n),
  };
}

/** Oracle price as the pool sees it (MockOracle or Pyth adapter, both expose getPrice). */
export function usePrice() {
  const oracleAddr = useReadContract({ ...pool, functionName: "oracle", query: { enabled: isDeployed } });
  const price = useReadContract({
    address: oracleAddr.data,
    abi: mockOracle.abi,
    functionName: "getPrice",
    query: { enabled: !!oracleAddr.data, refetchInterval: REFRESH },
  });
  const [p, updatedAt] = price.data ?? [];
  return { price: p, updatedAt, isLoading: oracleAddr.isLoading || price.isLoading, error: price.error };
}

/** Wallet balances and allowances for both pools. */
export function useBalances(user?: Address) {
  const q = useReadContracts({
    contracts: [
      { ...mETH, functionName: "balanceOf", args: [user!] },
      { ...mUSD, functionName: "balanceOf", args: [user!] },
      { ...mETH, functionName: "allowance", args: [user!, pool.address] },
      { ...mUSD, functionName: "allowance", args: [user!, pool.address] },
      { ...mETH, functionName: "allowance", args: [user!, cliff.address] },
      { ...mETH, functionName: "lastClaim", args: [user!] },
    ],
    query: { enabled: !!user && isDeployed, refetchInterval: REFRESH },
  });
  const r = (i: number) => (q.data?.[i]?.result as bigint | undefined) ?? 0n;
  return {
    ...q,
    meth: r(0),
    musd: r(1),
    methAllowancePool: r(2),
    musdAllowancePool: r(3),
    methAllowanceCliff: r(4),
    lastClaim: r(5),
  };
}

/** Totals for /transparency and the home page. */
export function usePoolStats() {
  const q = useReadContracts({
    contracts: [
      { ...pool, functionName: "totalCollateral" },
      { ...pool, functionName: "totalDebt" },
      { ...pool, functionName: "protocolFees" },
      { ...pool, functionName: "badDebt" },
      { ...pool, functionName: "totalFunded" },
      { ...cliff, functionName: "totalCollateral" },
      { ...cliff, functionName: "totalDebt" },
      { ...cliff, functionName: "badDebt" },
      { ...pool, functionName: "tip" },
    ],
    query: { enabled: isDeployed, refetchInterval: 6_000 },
  });
  const r = (i: number) => q.data?.[i]?.result as bigint | undefined;
  return {
    ...q,
    soft: { collateral: r(0), debt: r(1), fees: r(2), badDebt: r(3), funded: r(4), tip: r(8) },
    cliff: { collateral: r(5), debt: r(6), badDebt: r(7) },
  };
}
