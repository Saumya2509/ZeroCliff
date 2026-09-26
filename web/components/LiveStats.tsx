"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { usePoolStats, usePrice } from "@/hooks/usePosition";
import { cliff, contractList, isDeployed, pool } from "@/lib/contracts";
import { formatPrice, formatToken, shortAddress } from "@/lib/format";
import { explorerUrl } from "@/lib/wagmi";
import { NotDeployed } from "./NotDeployed";
import { Card, Skeleton, Stat } from "./ui";

export function LiveStats() {
  const stats = usePoolStats();
  const { price, updatedAt } = usePrice();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (!isDeployed) return <NotDeployed />;
  const v = (x: bigint | undefined, sym: string) => (x === undefined ? <Skeleton className="h-5 w-28" /> : formatToken(x, sym));
  const age = updatedAt !== undefined ? Math.max(0, now - Number(updatedAt)) : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Soft Landing pool">
        <dl className="divide-y divide-border">
          <Stat label="Total collateral" value={v(stats.soft.collateral, "mETH")} />
          <Stat label="Total debt" value={v(stats.soft.debt, "mUSD")} />
          <Stat label="Protocol fees" value={v(stats.soft.fees, "mUSD")} />
          <Stat label="Bad debt" value={v(stats.soft.badDebt, "mUSD")} />
          <Stat label="Poke tip (flat)" value={v(stats.soft.tip, "mUSD")} />
        </dl>
      </Card>
      <Card title="Cliff pool (baseline)">
        <dl className="divide-y divide-border">
          <Stat label="Total collateral" value={v(stats.cliff.collateral, "mETH")} />
          <Stat label="Total debt" value={v(stats.cliff.debt, "mUSD")} />
          <Stat label="Bad debt" value={v(stats.cliff.badDebt, "mUSD")} />
        </dl>
      </Card>
      <Card title="Oracle">
        <dl className="divide-y divide-border">
          <Stat label="ETH price" value={price ? formatPrice(price) : <Skeleton className="h-5 w-28" />} />
          <Stat label="Age" value={age === undefined ? "—" : `${age.toLocaleString("en-US")} s`} hint={age !== undefined && age > 60 ? "older than 60 s" : undefined} />
        </dl>
      </Card>
    </div>
  );
}

export function ContractTable() {
  if (!isDeployed) return <p className="text-sm text-muted">Addresses appear here after deployment.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Contract</th>
            <th scope="col" className="py-2 font-medium">Address</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {contractList.map((c) => {
            const url = explorerUrl("address", c.address);
            return (
              <tr key={c.name}>
                <th scope="row" className="py-2 pr-4 text-left font-normal">{c.name}</th>
                <td className="num py-2 font-mono text-xs [overflow-wrap:anywhere]">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-text">
                      {c.address}
                      <span className="sr-only"> (opens block explorer, where verification status is shown)</span>
                    </a>
                  ) : (
                    c.address
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Recent glides, backstops and cliff liquidations across all users, read directly from the chain. */
export function RecentEvents() {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ["recent-events"],
    enabled: isDeployed && !!client,
    refetchInterval: 12_000,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      const fromBlock = latest > 5_000n ? latest - 5_000n : 0n;
      const [g, b, l] = await Promise.all([
        client!.getContractEvents({ ...pool, eventName: "Glided", fromBlock }),
        client!.getContractEvents({ ...pool, eventName: "BackstopLiquidated", fromBlock }),
        client!.getContractEvents({ ...cliff, eventName: "Liquidated", fromBlock }),
      ]);
      return [
        ...g.map((e) => ({ key: `${e.transactionHash}${e.logIndex}`, block: e.blockNumber, pool: "soft" as const, text: `Glided ${formatToken(e.args.collateralSold!, "mETH", 4)} for ${shortAddress(e.args.user!)}` })),
        ...b.map((e) => ({ key: `${e.transactionHash}${e.logIndex}`, block: e.blockNumber, pool: "soft" as const, text: `Backstop sold ${formatToken(e.args.collateralSold!, "mETH", 4)} for ${shortAddress(e.args.user!)}` })),
        ...l.map((e) => ({ key: `${e.transactionHash}${e.logIndex}`, block: e.blockNumber, pool: "cliff" as const, text: `Liquidated ${formatToken(e.args.collateralSeized!, "mETH", 4)} from ${shortAddress(e.args.user!)}` })),
      ]
        .sort((a, b) => (a.block < b.block ? 1 : -1))
        .slice(0, 25);
    },
  });

  if (!isDeployed) return <p className="text-sm text-muted">Events appear here after deployment.</p>;
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.error) return <p className="text-sm text-muted">The RPC refused the event query. Try again shortly.</p>;
  if (!q.data?.length) return <p className="text-sm text-muted">No glides or liquidations in the last 5,000 blocks.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {q.data.map((e) => (
        <li key={e.key} className="num flex flex-wrap gap-x-3 py-2">
          <span className={e.pool === "soft" ? "text-safe" : "text-cliff"}>{e.pool === "soft" ? "Soft Landing" : "Cliff pool"}</span>
          <span className="flex-1">{e.text}</span>
          <span className="text-muted">block {e.block.toLocaleString("en-US")}</span>
        </li>
      ))}
    </ul>
  );
}
