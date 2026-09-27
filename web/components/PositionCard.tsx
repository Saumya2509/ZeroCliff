import type { Position } from "@/hooks/usePosition";
import { formatHealth, formatPercent, formatPrice, formatToken, healthState } from "@/lib/format";
import { glideRate } from "@/lib/sim/glide";
import { Skeleton, Stat, StatusBadge } from "./ui";

export function PositionCard({
  soft,
  ghost,
  price,
  loading,
}: {
  soft?: Position;
  ghost?: Position;
  price?: bigint;
  loading?: boolean;
}) {
  if (loading || !soft) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading position">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  const state = healthState(soft.health);
  return (
    <div>
      <dl className="divide-y divide-border">
        <Stat label="Collateral" value={formatToken(soft.collateral, "mETH", 4)} />
        <Stat label="Debt" value={formatToken(soft.debt, "mUSD")} />
        <Stat
          label="Health"
          value={
            <span className="inline-flex items-center gap-2">
              {formatHealth(soft.health)} <StatusBadge state={state} />
            </span>
          }
        />
        <Stat label="Glide rate" value={state === "gliding" ? formatPercent(glideRate(soft.health)) : "0%"} hint="per block" />
        <Stat label="Price" value={price ? formatPrice(price) : "—"} hint="per mETH" />
      </dl>
      {ghost && (ghost.collateral > 0n || ghost.debt > 0n) && (
        <div className="mt-4 rounded-sm bg-sunken px-3 py-2 text-sm">
          <p className="font-medium">
            Ghost in the cliff pool{" "}
            <span className="font-normal text-muted">(same deposit, classic liquidation)</span>
          </p>
          <p className="num text-muted">
            {formatToken(ghost.collateral, "mETH", 4)} · {formatToken(ghost.debt, "mUSD")} · health{" "}
            {formatHealth(ghost.health)}
          </p>
        </div>
      )}
    </div>
  );
}
