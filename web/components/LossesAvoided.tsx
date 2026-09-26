"use client";

import { useQuery } from "@tanstack/react-query";
import { INDEXER_URL, indexerGet, type LossesAvoidedResponse } from "@/lib/indexer";
import { Skeleton } from "./ui";

// Losses Avoided (06 §5), computed by the indexer: for every user with a Soft Landing position and a
// cliff ghost opened with the same amounts, the difference in net equity (collateral − debt / price,
// in mETH, at the oracle price). Signed: users the glide did worse for are subtracted, not dropped.

export function LossesAvoided() {
  const q = useQuery({
    queryKey: ["losses-avoided"],
    enabled: !!INDEXER_URL,
    refetchInterval: 10_000,
    retry: 1,
    queryFn: () => indexerGet<LossesAvoidedResponse>("/stats/losses-avoided"),
  });

  if (!INDEXER_URL)
    return (
      <p className="text-sm text-muted">
        Live counter of equity kept against ghost positions: starts once the indexer is running.
      </p>
    );
  if (q.isLoading) return <Skeleton className="h-10 w-48" />;
  // Aggregates are hidden rather than shown stale when the indexer is down.
  if (q.error || !q.data) return <p className="text-sm text-muted">Stats temporarily unavailable.</p>;

  const d = q.data;
  const negative = d.totalMeth.startsWith("-");
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className={`num text-3xl font-semibold ${negative ? "text-text" : "text-safe"}`}>{d.totalMeth} mETH</span>
        <span className="text-sm text-muted">more equity kept than the same loans in a cliff pool</span>
      </p>
      <p className="num mt-1 text-sm text-muted">
        {d.pairedUsers} paired positions: {d.usersBetter} better, {d.usersWorse} worse, {d.usersEqual} equal · as of block {d.asOfBlock}
      </p>
      {d.seededUsers > 0 && (
        <p className="mt-1 text-xs text-muted">
          Includes {d.seededUsers} position{d.seededUsers === 1 ? "" : "s"} opened by the team for testing.
        </p>
      )}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">How this is counted</summary>
        <p className="mt-1">{d.definition}</p>
      </details>
    </div>
  );
}
