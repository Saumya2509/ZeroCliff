import { formatHealth, formatPercent, healthLabel, healthState, wadToNumber } from "@/lib/format";
import { glideRate, MAX_UINT, H_COMFORT, H_OPEN } from "@/lib/sim/glide";
import { ShieldCheck, ShieldAlert, AlertTriangle, ArrowRight, Zap, Info } from "lucide-react";

const MIN = 0.9;
const MAX = 2.0;
const KNOTS: [number, number][] = [
  [0.9, 0],
  [1.02, 0.12],
  [1.25, 0.55],
  [1.4, 0.72],
  [2.0, 1],
];

/** Health → 0..1 height/width fraction (piecewise linear through the knots). */
export function scaleHealth(h: number): number {
  const x = Math.min(MAX, Math.max(MIN, h));
  for (let i = 1; i < KNOTS.length; i++) {
    const [x0, y0] = KNOTS[i - 1];
    const [x1, y1] = KNOTS[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

export function HealthAltimeter({ health }: { health: bigint }) {
  const state = healthState(health);
  const noDebt = health >= MAX_UINT / 2n;
  const h = noDebt ? MAX : wadToNumber(health);
  const shown = noDebt ? "No debt" : formatHealth(health);
  const rate = noDebt ? 0n : glideRate(health);
  const pct = Math.round(scaleHealth(h) * 100);

  const isSafe = !noDebt && health >= H_COMFORT;
  const isGliding = !noDebt && health >= 1020000000000000000n && health < H_OPEN;
  const isCliffRisk = !noDebt && health < 1020000000000000000n;

  return (
    <div className="space-y-4">
      {/* Top Banner: Big Score & Clear Explanation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/40 p-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              noDebt || isSafe
                ? "bg-safe/15 text-safe border border-safe/30"
                : isGliding
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
            }`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              {noDebt ? "No Debt (100% Safe)" : isSafe ? "Safe Zone (High Margin)" : isGliding ? "Soft Landing Active" : "Emergency Protection"}
            </span>
            <span className="text-xs text-muted">· Live Onchain</span>
          </div>

          <p className="text-xs text-muted">
            {noDebt
              ? "You have deposited collateral with zero active debt. Your funds are completely untouched."
              : isSafe
                ? "Your collateral comfortably exceeds requirements. No liquidation action will occur."
                : isGliding
                  ? "Market volatility active. ZeroCliff is executing gentle micro-sales (at most 0.5%/block) to defend your loan."
                  : "Position is near backstop limit. Rebalance or deposit collateral to restore normal flight."}
          </p>
        </div>

        <div className="sm:text-right shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted block">Loan Health Score</span>
          <span className={`font-mono text-3xl font-extrabold tracking-tight ${
            noDebt || isSafe ? "text-safe" : isGliding ? "text-amber-400" : "text-rose-400"
          }`}>
            {shown}
          </span>
        </div>
      </div>

      {/* Horizontal Safety Runway Track */}
      <div className="rounded-xl border border-border/80 bg-surface/50 p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-text">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-safe" />
            Safety Runway
          </span>
          <span className="font-mono text-muted text-[11px]">
            Current Altitude: <strong className="text-text">{shown}</strong> ({pct}% Safe)
          </span>
        </div>

        {/* The Track */}
        <div className="relative pt-6 pb-2">
          {/* Animated Pin Marker */}
          <div
            className="absolute top-0 -translate-x-1/2 flex flex-col items-center transition-all duration-500 z-10"
            style={{ left: `${pct}%` }}
          >
            <span className="rounded bg-text px-1.5 py-0.5 text-[10px] font-mono font-bold text-bg shadow">
              {shown}
            </span>
            <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-text" />
          </div>

          {/* 3-Zone Bar */}
          <div className="h-3.5 w-full rounded-full overflow-hidden flex bg-bg border border-border/80 shadow-inner">
            {/* Red: Cliff Danger Zone (< 1.02) */}
            <div className="w-[15%] bg-rose-500/70 border-r border-bg" title="Cliff Zone (< 1.02)" />
            {/* Amber: Soft Landing Glide Zone (1.02 - 1.25) */}
            <div className="w-[40%] bg-amber-500/70 border-r border-bg" title="Glide Zone (1.02 - 1.25)" />
            {/* Green: Safe Zone (>= 1.25) */}
            <div className="w-[45%] bg-safe/70" title="Safe Zone (>= 1.25)" />
          </div>

          {/* Zone Labels Under the Bar */}
          <div className="flex justify-between text-[10px] font-mono text-muted mt-2 pt-0.5">
            <span className="text-rose-400">1.00 Danger</span>
            <span className="text-amber-400">1.25 Protection Starts</span>
            <span className="text-safe">1.40+ Safe Buffer</span>
          </div>
        </div>
      </div>

      {/* Beginner-Friendly Protection Breakdown */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border/70 bg-bg/50 p-2.5">
          <span className="text-muted block text-[10px] uppercase font-mono">1. Cruising Zone</span>
          <span className="text-safe font-semibold block mt-0.5">Health &ge; 1.25</span>
          <p className="text-[11px] text-muted mt-1">0% selling. You have full freedom to borrow or withdraw.</p>
        </div>

        <div className="rounded-lg border border-border/70 bg-bg/50 p-2.5">
          <span className="text-muted block text-[10px] uppercase font-mono">2. Soft Protection</span>
          <span className="text-amber-400 font-semibold block mt-0.5">1.02 &le; Health &lt; 1.25</span>
          <p className="text-[11px] text-muted mt-1">Micro-sells fractional slices (&le;0.5%/block). Stops immediately when price recovers.</p>
        </div>

        <div className="rounded-lg border border-border/70 bg-bg/50 p-2.5">
          <span className="text-muted block text-[10px] uppercase font-mono">3. Competitor Cliff</span>
          <span className="text-rose-400 font-semibold block mt-0.5">Health &lt; 1.00</span>
          <p className="text-[11px] text-muted mt-1">Traditional pools wipe out 50-100% of loans here. ZeroCliff shields 90%+ collateral.</p>
        </div>
      </div>
    </div>
  );
}
