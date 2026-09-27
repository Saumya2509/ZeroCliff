"use client";

import { useId, useMemo, useState } from "react";
import { answer, briefing, ewmaVolatility, parseIntent, type Advice, type Status } from "@/lib/ai/flightDirector";
import type { HealthState } from "@/lib/format";
import type { PriceHistory } from "@/hooks/usePriceHistory";
import {
  Sparkles,
  Bot,
  Send,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  SlidersHorizontal,
  Compass,
  Zap,
  RotateCcw,
  ArrowDownRight,
  TrendingDown,
  Moon,
  DollarSign,
  ShieldAlert,
} from "lucide-react";

// Flight Director (md/manali/10): 100% local, zero-API quantitative AI risk engine.
// Executes locally in the browser with zero external calls, sub-5ms latency, and 100% determinism.

const ASSUMED_SIGMA = 0.7; // Fallback volatility when price history is flat/limited

const PRESETS = [
  { label: "What if ETH drops 20%?", icon: Zap, query: "What if ETH drops 20%?" },
  { label: "Am I safe to sleep?", icon: Moon, query: "Am I safe to sleep?" },
  { label: "Where does glide start?", icon: ArrowDownRight, query: "Where does the glide start?" },
  { label: "How much can I borrow?", icon: DollarSign, query: "How much can I borrow?" },
  { label: "Survive 30% crash?", icon: ShieldAlert, query: "How much to add to survive 30%?" },
];

const STATUS_CONFIG: Record<
  Status,
  {
    badge: HealthState;
    label: string;
    icon: typeof ShieldCheck;
    glowClass: string;
    borderClass: string;
    bgClass: string;
    textClass: string;
    pingClass: string;
  }
> = {
  CLEAR_SKIES: {
    badge: "safe",
    label: "CLEAR SKIES",
    icon: ShieldCheck,
    glowClass: "shadow-[0_0_25px_-5px_rgba(34,197,94,0.15)]",
    borderClass: "border-emerald-500/30",
    bgClass: "bg-emerald-950/10",
    textClass: "text-emerald-400",
    pingClass: "bg-emerald-400",
  },
  MILD_TURBULENCE: {
    badge: "gliding",
    label: "MILD TURBULENCE",
    icon: AlertTriangle,
    glowClass: "shadow-[0_0_25px_-5px_rgba(245,158,11,0.15)]",
    borderClass: "border-amber-500/30",
    bgClass: "bg-amber-950/10",
    textClass: "text-amber-400",
    pingClass: "bg-amber-400",
  },
  CRITICAL_DESCENT: {
    badge: "backstop",
    label: "CRITICAL DESCENT",
    icon: AlertOctagon,
    glowClass: "shadow-[0_0_25px_-5px_rgba(239,68,68,0.15)]",
    borderClass: "border-rose-500/30",
    bgClass: "bg-rose-950/10",
    textClass: "text-rose-400",
    pingClass: "bg-rose-400",
  },
  NO_POSITION: {
    badge: "none",
    label: "READY · NO LOAN",
    icon: Bot,
    glowClass: "shadow-none",
    borderClass: "border-border/80",
    bgClass: "bg-surface/30",
    textClass: "text-muted",
    pingClass: "bg-muted",
  },
};

export function FlightDirector({
  collateral,
  debt,
  price,
  history,
}: {
  collateral: bigint;
  debt: bigint;
  price?: bigint;
  history?: PriceHistory;
}) {
  const ids = { q: useId(), sigma: useId() };
  const [query, setQuery] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: Advice; time: string }[]>([]);
  const [override, setOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showQuantTuner, setShowQuantTuner] = useState(false);

  const measured = useMemo(() => (history ? ewmaVolatility(history.prices, history.intervalS) : null), [history]);
  const usable = measured !== null && measured > 0.05 ? measured : null;
  const sigma = override ?? usable ?? ASSUMED_SIGMA;
  const sigmaSource: "measured" | "assumed" = override === null && usable !== null ? "measured" : "assumed";

  if (price === undefined || price === 0n) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-6 text-sm text-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span>Initializing local AI flight director with live Pyth oracle feed…</span>
      </div>
    );
  }

  const ctx = { collateral, debt, price, sigma, sigmaSource };
  const brief = briefing(ctx);
  const statusCfg = STATUS_CONFIG[brief.status];
  const StatusIcon = statusCfg.icon;

  const ask = (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setTimeout(() => {
      const a = answer(parseIntent(q), ctx);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setAnswers((prev) => [{ q, a, time }, ...prev].slice(0, 6));
      setQuery("");
      setBusy(false);
    }, 15);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-surface via-surface/95 to-bg/80 p-5 shadow-2xl backdrop-blur-xl">
      {/* High-Tech Avionics Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-safe/40 bg-safe/10 text-safe shadow-[0_0_15px_-3px_rgba(34,197,94,0.3)]">
            <Bot className="h-5 w-5" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${statusCfg.pingClass}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${statusCfg.pingClass}`} />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold tracking-tight text-text">AI Flight Director</h3>
              <span className="rounded-md border border-safe/40 bg-safe/15 px-2 py-0.5 font-mono text-[10px] font-bold text-safe">
                10.md LOCAL AI
              </span>
            </div>
            <p className="text-xs text-muted">Zero-API · Sub-5ms deterministic quantitative intelligence</p>
          </div>
        </div>

        {/* Quant Diagnostics Pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQuantTuner((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg/80 px-2.5 py-1 text-xs text-muted transition-colors hover:border-text hover:text-text"
            title="Adjust Volatility Model & View Math"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Vol: {Math.round(sigma * 100)}%</span>
            <span className="text-[10px] text-muted">({sigmaSource})</span>
          </button>
        </div>
      </div>

      {/* Hero Flight Advisory HUD */}
      <div
        className={`relative mb-5 overflow-hidden rounded-xl border p-4 transition-all duration-300 ${statusCfg.borderClass} ${statusCfg.bgClass} ${statusCfg.glowClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-lg p-2 ${statusCfg.textClass} bg-bg/60 border border-border/50`}>
              <StatusIcon className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-mono text-xs font-bold uppercase tracking-wider ${statusCfg.textClass}`}>
                  {statusCfg.label}
                </span>
                <span className="text-muted/60">·</span>
                <h4 className="text-sm font-semibold text-text">{brief.headline}</h4>
              </div>
              <div className="space-y-0.5 text-xs text-muted">
                {brief.lines.map((line, idx) => (
                  <p key={idx} className="leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Metric Telemetry Grid */}
        {brief.figures.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {brief.figures.map((fig) => (
              <div
                key={fig.label}
                className="rounded-lg border border-border/60 bg-bg/60 px-3 py-2 transition-colors hover:border-border"
              >
                <div className="text-[11px] font-medium text-muted">{fig.label}</div>
                <div className="font-mono text-sm font-bold text-text">{fig.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Natural Language Command Console */}
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(query);
          }}
          className="relative flex items-center"
        >
          <div className="pointer-events-none absolute left-3.5 text-muted">
            <Sparkles className="h-4 w-4 text-safe" />
          </div>
          <input
            id={ids.q}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask AI Copilot: 'What if ETH drops 25%?', 'Can I borrow 5000?', etc."
            autoComplete="off"
            className="w-full rounded-xl border border-border/80 bg-bg/90 py-2.5 pr-24 pl-10 text-sm text-text placeholder-muted/70 transition-all focus:border-safe/70 focus:ring-2 focus:ring-safe/20 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="absolute right-1.5 flex items-center gap-1 rounded-lg bg-safe px-3 py-1.5 text-xs font-semibold text-bg transition-transform hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg border-t-transparent" />
            ) : (
              <>
                <span>Ask</span>
                <Send className="h-3 w-3" />
              </>
            )}
          </button>
        </form>

        {/* Quick Action Prompt Chips with Icons */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => ask(p.query)}
                disabled={busy}
                className="group flex items-center gap-1.5 rounded-lg border border-border/80 bg-surface px-2.5 py-1 text-xs text-muted transition-all hover:border-safe/50 hover:bg-safe/5 hover:text-text disabled:opacity-50"
              >
                <Icon className="h-3 w-3 text-muted/80 transition-colors group-hover:text-safe" />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stream of Answers / Query History */}
      {answers.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-border/70 pt-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-semibold uppercase tracking-wider text-muted">Copilot Dialogue History</span>
            <button
              type="button"
              onClick={() => setAnswers([])}
              className="flex items-center gap-1 hover:text-text"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Clear</span>
            </button>
          </div>

          <div className="space-y-3">
            {answers.map(({ q, a, time }, i) => {
              const itemCfg = STATUS_CONFIG[a.status];
              const ItemIcon = itemCfg.icon;

              return (
                <div
                  key={`${answers.length - i}`}
                  className="rounded-xl border border-border/80 bg-surface/60 p-3.5 shadow-sm transition-all"
                >
                  <div className="mb-2 flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                        YOU
                      </span>
                      <p className="font-medium text-xs text-text">"{q}"</p>
                    </div>
                    <span className="font-mono text-[10px] text-muted">{time}</span>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 rounded-md p-1.5 ${itemCfg.textClass} bg-bg/80 border border-border/40`}>
                      <ItemIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[11px] font-bold uppercase ${itemCfg.textClass}`}>
                          {itemCfg.label}
                        </span>
                        <span className="text-muted/60">·</span>
                        <p className="text-xs font-semibold text-text">{a.headline}</p>
                      </div>
                      <div className="space-y-0.5 text-xs text-muted">
                        {a.lines.map((l, lineIdx) => (
                          <p key={lineIdx}>{l}</p>
                        ))}
                      </div>

                      {a.figures.length > 0 && (
                        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {a.figures.map((fig) => (
                            <div
                              key={fig.label}
                              className="rounded border border-border/60 bg-bg/70 px-2 py-1.5"
                            >
                              <div className="text-[10px] text-muted">{fig.label}</div>
                              <div className="font-mono text-xs font-semibold text-text">{fig.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quant Volatility Calibration & Explainability Drawer */}
      {showQuantTuner && (
        <div className="mt-4 rounded-xl border border-border/80 bg-bg/70 p-4 text-xs text-muted transition-all">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-text">Monte Carlo & Volatility Engine</span>
            {override !== null && (
              <button
                type="button"
                onClick={() => setOverride(null)}
                className="cursor-pointer text-safe underline underline-offset-2 hover:brightness-125"
              >
                Reset to Auto EWMA
              </button>
            )}
          </div>
          <p className="mb-3 leading-relaxed">
            The flight director executes 300 geometric Brownian motion paths directly in your browser. All liquidation
            mechanics match the on-chain <code className="text-text">previewGlide</code> contract implementation with zero
            network calls.
          </p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <label htmlFor={ids.sigma} className="font-medium text-text">
                Annualized Volatility (σ): <span className="font-mono text-safe">{Math.round(sigma * 100)}%</span>
              </label>
              <span className="text-muted">Source: {sigmaSource}</span>
            </div>
            <input
              id={ids.sigma}
              type="range"
              min={10}
              max={200}
              step={5}
              value={Math.round(sigma * 100)}
              onChange={(e) => setOverride(Number(e.target.value) / 100)}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface accent-safe"
            />
            <div className="flex justify-between text-[10px] text-muted font-mono">
              <span>10% (Low Vol)</span>
              <span>70% (Crypto Baseline)</span>
              <span>200% (Extreme Shock)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
