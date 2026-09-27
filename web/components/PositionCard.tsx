import type { Position } from "@/hooks/usePosition";
import { formatHealth, formatPercent, formatPrice, formatToken, healthState } from "@/lib/format";
import { glideRate } from "@/lib/sim/glide";
import { Skeleton, StatusBadge } from "./ui";

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
  const colUsd = price ? (soft.collateral * price) / 10n ** 18n : 0n;

  return (
    <div className="space-y-3.5">
      {/* 2x2 Primary Readouts */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-border/80 bg-surface/50 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Collateral</span>
          <p className="num mt-0.5 font-mono text-base font-semibold text-text">
            {formatToken(soft.collateral, "mETH", 3)}
          </p>
          {colUsd > 0n && (
            <p className="num text-[11px] text-muted">≈ {formatToken(colUsd, "mUSD")}</p>
          )}
        </div>

        <div className="rounded-lg border border-border/80 bg-surface/50 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Total Debt</span>
          <p className="num mt-0.5 font-mono text-base font-semibold text-text">
            {formatToken(soft.debt, "mUSD")}
          </p>
          <p className="text-[11px] text-muted">mUSD borrowed</p>
        </div>

        <div className="rounded-lg border border-border/80 bg-surface/50 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Health Factor</span>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="num font-mono text-base font-semibold text-text">
              {formatHealth(soft.health)}
            </span>
            <StatusBadge state={state} />
          </div>
        </div>

        <div className="rounded-lg border border-border/80 bg-surface/50 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Glide Rate</span>
          <p className="num mt-0.5 font-mono text-base font-semibold text-text">
            {state === "gliding" ? formatPercent(glideRate(soft.health)) : "0.00%"}
          </p>
          <p className="text-[11px] text-muted">per 2s block</p>
        </div>
      </div>

      {/* Ghost Comparison Sub-card */}
      {ghost && (ghost.collateral > 0n || ghost.debt > 0n) && (
        <div className="rounded-lg border border-border/70 bg-bg/60 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <span className="text-safe">✦</span> Ghost Twin (Classic Pool)
            </span>
            <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Health {formatHealth(ghost.health)}
            </span>
          </div>
          <p className="num mt-1 text-[11px] font-mono text-muted">
            Holds {formatToken(ghost.collateral, "mETH", 3)} · {formatToken(ghost.debt, "mUSD")} debt
          </p>
        </div>
      )}
    </div>
  );
}
