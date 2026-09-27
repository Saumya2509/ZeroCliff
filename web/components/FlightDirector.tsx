"use client";

import { useId, useMemo, useState } from "react";
import { answer, briefing, ewmaVolatility, parseIntent, type Advice, type Status } from "@/lib/ai/flightDirector";
import type { HealthState } from "@/lib/format";
import type { PriceHistory } from "@/hooks/usePriceHistory";
import { Button, StatusBadge } from "./ui";

// Flight Director (md/manali/10): ask about this loan in plain words. Everything runs here in the
// browser: a rule-based question parser, a volatility estimate and Monte Carlo forecast, and the
// contract's own maths. No network calls and no language model, so it works offline and every number
// can be traced to lib/ai/flightDirector.ts.

const ASSUMED_SIGMA = 0.7; // used only when there is too little price history to measure; adjustable below
const PRESETS = ["What if ETH drops 20%?", "Am I safe to sleep?", "Where does the glide start?", "How much can I borrow?", "How much to add to survive 30%?"];
const badge: Record<Status, HealthState> = { CLEAR_SKIES: "safe", MILD_TURBULENCE: "gliding", CRITICAL_DESCENT: "backstop", NO_POSITION: "none" };

export function FlightDirector({ collateral, debt, price, history }: { collateral: bigint; debt: bigint; price?: bigint; history?: PriceHistory }) {
  const ids = { q: useId(), sigma: useId() };
  const [query, setQuery] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: Advice }[]>([]);
  const [override, setOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const measured = useMemo(() => (history ? ewmaVolatility(history.prices, history.intervalS) : null), [history]);
  // A flat mock price measures ~0: fall back to the assumption rather than claim zero risk.
  const usable = measured !== null && measured > 0.05 ? measured : null;
  const sigma = override ?? usable ?? ASSUMED_SIGMA;
  const sigmaSource: "measured" | "assumed" = override === null && usable !== null ? "measured" : "assumed";

  if (price === undefined || price === 0n) return <p className="text-sm text-muted">Waiting for the oracle price…</p>;
  const ctx = { collateral, debt, price, sigma, sigmaSource };
  const brief = briefing(ctx);

  const ask = (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    // let the "working" state paint before the forecast runs (it can take up to ~1 s for long horizons)
    setTimeout(() => {
      const a = answer(parseIntent(q), ctx);
      setAnswers((prev) => [{ q, a }, ...prev].slice(0, 6));
      setQuery("");
      setBusy(false);
    }, 20);
  };

  return (
    <div className="space-y-5">
      <AdviceBlock advice={brief} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(query);
        }}
        className="space-y-2"
      >
        <label htmlFor={ids.q} className="text-sm font-medium">Ask about this loan</label>
        <div className="flex gap-2">
          <input
            id={ids.q}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What if ETH drops 30%?"
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-sm"
          />
          <Button type="submit" variant="primary" disabled={busy || !query.trim()}>{busy ? "Working…" : "Ask"}</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => ask(p)} disabled={busy}
              className="min-h-9 cursor-pointer rounded-sm border border-border px-2.5 text-xs text-muted transition-colors hover:border-text hover:text-text disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite" className="space-y-3">
        {answers.map(({ q, a }, i) => (
          <div key={`${answers.length - i}`} className="border-t border-border pt-3">
            <p className="font-mono text-xs text-muted">{q}</p>
            <AdviceBlock advice={a} compact />
          </div>
        ))}
      </div>

      <details className="border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium">How this is calculated</summary>
        <div className="mt-2 space-y-2 text-muted">
          <p>
            Questions are matched by keywords (typos tolerated) and numbers are read from the text; there is no language
            model, and nothing leaves your browser. Price levels and stress tests use the same maths as the contract. Odds
            use a driftless random walk: the chance of <em>touching</em> a price level, and 300 simulated price paths run
            through both Soft Landing and a normal pool.
          </p>
          <div>
            <label htmlFor={ids.sigma} className="font-medium text-text">
              Volatility: <span className="num">{Math.round(sigma * 100)}% a year</span> ({sigmaSource})
            </label>
            <input id={ids.sigma} type="range" min={10} max={200} step={5} value={Math.round(sigma * 100)}
              onChange={(e) => setOverride(Number(e.target.value) / 100)}
              aria-valuetext={`${Math.round(sigma * 100)}% a year`} className="mt-1 min-h-11 w-full accent-[var(--safe)]" />
            <p className="text-xs">
              {usable !== null
                ? `Measured ${Math.round(usable * 100)}% a year (EWMA, λ 0.94) from the ${history?.source}.`
                : `Not enough price movement to measure yet, so ${Math.round(ASSUMED_SIGMA * 100)}% a year is assumed.`}
              {override !== null && (
                <button type="button" onClick={() => setOverride(null)} className="ml-2 cursor-pointer underline underline-offset-2">
                  Reset
                </button>
              )}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

function AdviceBlock({ advice, compact }: { advice: Advice; compact?: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge state={badge[advice.status]} />
        <p className={compact ? "font-medium" : "text-base font-semibold"}>{advice.headline}</p>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        {advice.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      {advice.figures.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-3">
          {advice.figures.map((f) => (
            <div key={f.label} className="border-t border-border pt-1.5">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className="num font-mono text-sm">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
