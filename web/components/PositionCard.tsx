import type { Position } from "@/hooks/usePosition";
import { formatHealth, formatPercent, formatToken, healthState } from "@/lib/format";
import { glideRate, H_COMFORT, H_OPEN } from "@/lib/sim/glide";
import { Skeleton, StatusBadge } from "./ui";
import { ShieldCheck, ShieldAlert, AlertTriangle, ArrowUpRight, TrendingUp, Layers, Coins } from "lucide-react";

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
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const state = healthState(soft.health);
  const colUsd = price ? (soft.collateral * price) / 10n ** 18n : 0n;
  const isSafe = soft.health >= H_COMFORT;
  const isGliding = soft.health >= 1020000000000000000n && soft.health < H_OPEN;

  // Calculate borrow utilization (debt / (collateral * price * 0.85))
  const maxSafeBorrow = price ? ((colUsd * 85n) / 100n) : 0n;
  const utilization = maxSafeBorrow > 0n ? Number((soft.debt * 100n) / maxSafeBorrow) : 0;

  return (
    <div className="space-y-4">
      {/* Friendly Status Header */}
      <div className="flex items-center justify-between rounded-xl border border-border/80 bg-surface/40 p-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isSafe ? "bg-safe/15 text-safe" : isGliding ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"
          }`}>
            {isSafe ? <ShieldCheck className="h-5 w-5" /> : isGliding ? <AlertTriangle className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text">
                {isSafe ? "Loan Protected & Safe" : isGliding ? "Soft Landing Active" : "Emergency Protection"}
              </span>
              <StatusBadge state={state} />
            </div>
            <p className="text-[11px] text-muted">
              {isSafe
                ? "Zero liquidation risk under normal market conditions."
                : isGliding
                  ? "Gentle micro-sales protecting your equity (max 0.5%/block)."
                  : "Collateral being stabilized to restore safety."}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase font-mono tracking-wider text-muted block">Safety Score</span>
          <span className="font-mono text-base font-bold text-text">{formatHealth(soft.health)}</span>
        </div>
      </div>

      {/* 4 Clean Metric Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Collateral */}
        <div className="rounded-xl border border-border/80 bg-surface/60 p-3 hover:border-border transition-colors">
          <div className="flex items-center gap-1.5 text-muted mb-1">
            <Coins className="h-3.5 w-3.5 text-safe" />
            <span className="text-[11px] font-medium uppercase tracking-wider">Collateral Backing</span>
          </div>
          <p className="num font-mono text-base font-bold text-text">
            {formatToken(soft.collateral, "mETH", 3)}
          </p>
          {colUsd > 0n && (
            <p className="num text-[11px] text-muted mt-0.5">Value: ≈ {formatToken(colUsd, "mUSD")}</p>
          )}
        </div>

        {/* Debt */}
        <div className="rounded-xl border border-border/80 bg-surface/60 p-3 hover:border-border transition-colors">
          <div className="flex items-center gap-1.5 text-muted mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-safe" />
            <span className="text-[11px] font-medium uppercase tracking-wider">Borrowed Debt</span>
          </div>
          <p className="num font-mono text-base font-bold text-text">
            {formatToken(soft.debt, "mUSD")}
          </p>
          <p className="text-[11px] text-muted mt-0.5">Stablecoins borrowed</p>
        </div>

        {/* Utilization */}
        <div className="rounded-xl border border-border/80 bg-surface/60 p-3 hover:border-border transition-colors">
          <div className="flex items-center gap-1.5 text-muted mb-1">
            <Layers className="h-3.5 w-3.5 text-safe" />
            <span className="text-[11px] font-medium uppercase tracking-wider">Borrow Capacity</span>
          </div>
          <p className="num font-mono text-base font-bold text-text">
            {Math.min(utilization, 100)}%
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            {utilization <= 75 ? "Safe buffer remaining" : "Near maximum limit"}
          </p>
        </div>

        {/* Liquidation Mode */}
        <div className="rounded-xl border border-border/80 bg-surface/60 p-3 hover:border-border transition-colors">
          <div className="flex items-center gap-1.5 text-muted mb-1">
            <ShieldCheck className="h-3.5 w-3.5 text-safe" />
            <span className="text-[11px] font-medium uppercase tracking-wider">Crash Protection</span>
          </div>
          <p className="num font-mono text-base font-bold text-safe">
            Soft Landing
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            {state === "gliding" ? `Selling ${formatPercent(glideRate(soft.health))}/block` : "0% sold (No cliff)"}
          </p>
        </div>
      </div>

      {/* Ghost Comparison Sub-card */}
      {ghost && (ghost.collateral > 0n || ghost.debt > 0n) && (
        <div className="rounded-xl border border-border/70 bg-bg/60 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text">
              <span className="text-safe">✦</span> Mirrored Ghost Position (Classic Pool)
            </span>
            <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted border border-border/60">
              Health {formatHealth(ghost.health)}
            </span>
          </div>
          <p className="num mt-1 text-[11px] font-mono text-muted">
            Holds {formatToken(ghost.collateral, "mETH", 3)} · {formatToken(ghost.debt, "mUSD")} debt · Liquidates in 1 single dump if health &lt; 1.00
          </p>
        </div>
      )}
    </div>
  );
}
