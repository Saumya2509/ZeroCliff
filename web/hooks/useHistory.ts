"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hash, Log } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { cliff, isDeployed, pool } from "@/lib/contracts";
import { fetchChainEvents } from "@/lib/fallbackActivity";
import { INDEXER_URL, indexerGet, type ActivityResponse } from "@/lib/indexer";

// Position history for the ghost chart and the activity feed. Reads the indexer (06) when one is
// configured; if it is down, falls back silently to contract events from the last ~5,000 blocks.

export type ActivityItem = {
  key: string;
  pool: "soft" | "cliff";
  kind: "deposit" | "withdraw" | "glide" | "backstop" | "liquidated";
  block: bigint;
  hash: Hash;
  collateralDelta: bigint; // negative = collateral left the position
  debtDelta: bigint;
  detail?: { healthBefore?: bigint; healthAfter?: bigint; blocks?: bigint; shortfall?: bigint };
};

export type HistoryPoint = { block: number; soft: bigint; ghost: bigint };

export type History = {
  items: ActivityItem[]; // newest first
  points: HistoryPoint[]; // oldest first
  source: "indexer" | "chain";
  /** First block covered, when older history was cut off (fallback window or indexer limit). */
  partialFrom?: bigint;
};

/**
 * Collateral after each event, walking back from the current values. Works on a truncated history:
 * the chart simply starts later, instead of being wrong.
 */
export function buildPoints(itemsNewestFirst: ActivityItem[], current: { soft: bigint; ghost: bigint }): HistoryPoint[] {
  let soft = current.soft;
  let ghost = current.ghost;
  const points: HistoryPoint[] = [];
  for (const it of itemsNewestFirst) {
    const last = points[points.length - 1];
    if (!last || last.block !== Number(it.block)) points.push({ block: Number(it.block), soft, ghost });
    if (it.pool === "soft") soft -= it.collateralDelta;
    else ghost -= it.collateralDelta;
  }
  return points.reverse();
}

const byBlockDesc = (a: ActivityItem, b: ActivityItem) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1);

function fromIndexer(r: ActivityResponse["items"][number]): ActivityItem | undefined {
  const base = { key: r.id, pool: r.pool, block: BigInt(r.block), hash: r.txHash };
  const n = (k: string) => (r[k] === undefined || r[k] === null ? undefined : BigInt(r[k]));
  switch (r.type) {
    case "deposit":
      return { ...base, kind: "deposit", collateralDelta: n("amount")!, debtDelta: 0n };
    case "withdraw":
      return { ...base, kind: "withdraw", collateralDelta: -n("amount")!, debtDelta: 0n };
    case "glide":
      return {
        ...base,
        kind: "glide",
        collateralDelta: -n("collateralSold")!,
        debtDelta: -n("debtRepaid")!,
        detail: { healthBefore: n("healthBefore"), healthAfter: n("healthAfter"), blocks: n("blocksAccrued") },
      };
    case "backstop":
      return { ...base, kind: "backstop", collateralDelta: -n("collateralSold")!, debtDelta: -n("debtRepaid")!, detail: { shortfall: n("shortfall") } };
    case "liquidation":
      return { ...base, kind: "liquidated", collateralDelta: -n("seized")!, debtDelta: -n("repaid")!, detail: { healthBefore: n("health") } };
  }
  return undefined; // borrow / repay: debt-only, not shown on the collateral chart
}

const INDEXER_LIMIT = 1_000;

async function loadFromIndexer(user: Address): Promise<History> {
  const r = await indexerGet<ActivityResponse>(`/activity/${user}?limit=${INDEXER_LIMIT}`);
  const items = r.items.map(fromIndexer).filter((x): x is ActivityItem => !!x).sort(byBlockDesc);
  const col = (p: "soft" | "cliff") => BigInt(r.positions.find((x) => x.pool === p)?.collateral ?? "0");
  return {
    items,
    points: buildPoints(items, { soft: col("soft"), ghost: col("cliff") }),
    source: "indexer",
    partialFrom: r.items.length >= INDEXER_LIMIT ? items[items.length - 1]?.block : undefined,
  };
}

type AnyLog = Log & { eventName: string; args: Record<string, bigint | Address> };

function toItem(log: AnyLog, which: "soft" | "cliff"): ActivityItem | undefined {
  const a = log.args;
  const base = { key: `${log.transactionHash}-${log.logIndex}`, pool: which, block: log.blockNumber!, hash: log.transactionHash! };
  switch (log.eventName) {
    case "Deposited":
      return { ...base, kind: "deposit", collateralDelta: a.amount as bigint, debtDelta: 0n };
    case "Withdrawn":
      return { ...base, kind: "withdraw", collateralDelta: -(a.amount as bigint), debtDelta: 0n };
    case "Borrowed":
      return undefined; // debt-only; not shown on the collateral chart
    case "Glided":
      return {
        ...base,
        kind: "glide",
        collateralDelta: -(a.collateralSold as bigint),
        debtDelta: -(a.debtRepaid as bigint),
        detail: { healthBefore: a.healthBefore as bigint, healthAfter: a.healthAfter as bigint, blocks: a.blocksAccrued as bigint },
      };
    case "BackstopLiquidated":
      return {
        ...base,
        kind: "backstop",
        collateralDelta: -(a.collateralSold as bigint),
        debtDelta: -(a.debtRepaid as bigint),
        detail: { shortfall: a.shortfall as bigint },
      };
    case "Liquidated":
      return {
        ...base,
        kind: "liquidated",
        collateralDelta: -(a.collateralSeized as bigint),
        debtDelta: -(a.debtRepaid as bigint),
        detail: { healthBefore: a.health as bigint },
      };
  }
  return undefined;
}

export function useHistory(user?: Address) {
  const client = usePublicClient();
  const qc = useQueryClient();
  const key = ["history", user];

  const q = useQuery({
    queryKey: key,
    enabled: !!user && !!client && isDeployed,
    refetchInterval: 10_000,
    queryFn: async (): Promise<History> => {
      if (INDEXER_URL) {
        try {
          return await loadFromIndexer(user!);
        } catch {
          // indexer down: fall through to the chain, silently
        }
      }
      const r = await fetchChainEvents(client!, user!);
      const items = [
        ...(r.soft as unknown as AnyLog[]).map((l) => toItem(l, "soft")),
        ...(r.ghost as unknown as AnyLog[]).map((l) => toItem(l, "cliff")),
      ]
        .filter((x): x is ActivityItem => !!x)
        .sort(byBlockDesc);
      return { items, points: buildPoints(items, r.current), source: "chain", partialFrom: r.partialFrom };
    },
  });

  // Refetch as soon as something happens to this user, instead of waiting for the interval.
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  useWatchContractEvent({ ...pool, eventName: "Glided", args: { user }, enabled: !!user && isDeployed, onLogs: refresh });
  useWatchContractEvent({ ...pool, eventName: "BackstopLiquidated", args: { user }, enabled: !!user && isDeployed, onLogs: refresh });
  useWatchContractEvent({ ...cliff, eventName: "Liquidated", args: { user }, enabled: !!user && isDeployed, onLogs: refresh });

  return q;
}
