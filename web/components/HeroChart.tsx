"use client";

import Link from "next/link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { HeroRun } from "@/lib/sim/data";

// Home page chart: a real crash (19 May 2021, Binance 1-minute closes) run through 200 simulated
// borrowers under both designs by the Cascade Lab engine (the same engine that is verified against the
// contracts). Numbers come from public/results/e2.json; nothing here is typed in by hand.

const fmt = (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function HeroChart({ run }: { run: HeroRun }) {
  const reduced = useReducedMotion();
  const hours = run.intervalSeconds / 3600;
  const data = run.series.map((s) => ({ h: s.t * hours, soft: s.softEquity / 1e6, cliff: s.cliffEquity / 1e6, price: s.market }));
  const top = Math.ceil(Math.max(...data.map((d) => d.soft)) * 1.1);
  const anim = { isAnimationActive: reduced === false, animationDuration: 2200, animationEasing: "ease-out" as const };
  const tick = { fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-plex-mono)" };
  const lastH = data[data.length - 1]?.h ?? 24;

  return (
    <figure className="rounded-[4px] border border-border bg-surface px-4 pb-3 sm:px-5">
      <div className="grid gap-x-10 gap-y-4 py-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center">
        <figcaption className="text-sm">
          <span className="font-medium">{run.label}</span>
          <span className="text-muted">
            {" "}
            · ETH fell {fmt(run.marketLowPct, 1)}% at the low · {run.users} borrowers, same loans in both pools
          </span>
        </figcaption>
        <dl className="grid gap-2.5">
          <Kept label="Soft Landing" pct={run.soft.valueKeptPct} wiped={run.soft.wiped} tone="safe" delay={200} />
          <Kept label="Cliff pool" pct={run.cliff.valueKeptPct} wiped={run.cliff.wiped} tone="cliff" delay={350} />
        </dl>
      </div>
      <div className="h-64 w-full border-t border-border sm:h-80" aria-hidden="true">
        {reduced !== undefined && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 16, right: 96, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="h" type="number" domain={[0, lastH]} ticks={[0, 6, 12, 18, 24].filter((t) => t <= lastH)} tick={tick} stroke="var(--border)" tickFormatter={(h: number) => `${h}h`} />
              <YAxis yAxisId="e" domain={[0, top]} tick={tick} stroke="var(--border)" width={44} tickFormatter={(v: number) => `${v}M`} />
              <YAxis yAxisId="p" orientation="right" hide domain={["dataMin - 400", "dataMax + 100"]} />
              <Line yAxisId="p" dataKey="price" stroke="var(--chart-price)" strokeWidth={1.25} strokeDasharray="1 4" dot={false} {...anim}
                label={<End i={data.length - 1} text="ETH" color="var(--text-muted)" />} />
              <Line yAxisId="e" dataKey="cliff" type="linear" stroke="var(--cliff)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...anim}
                label={<End i={data.length - 1} text="Cliff pool" color="var(--cliff)" />} />
              <Line yAxisId="e" dataKey="soft" type="linear" stroke="var(--safe)" strokeWidth={2.5} dot={false} {...anim}
                label={<End i={data.length - 1} text="Soft Landing" color="var(--safe)" dy={-6} />} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="border-t border-border pt-2 text-xs text-muted">
        Value kept = collateral at market minus debt. {run.source}. Simulated borrowers, β = {run.beta} (30% of price discovery in the pool being sold into), mUSD millions.{" "}
        <Link href={`/simulate?crash=${run.crash}&beta=${run.beta}`} className="text-text underline underline-offset-2">
          Rerun it in the Cascade Lab
        </Link>
      </p>
    </figure>
  );
}

/** Share of starting equity kept, drawn as a bar so the gap reads at a glance. */
function Kept({ label, pct, wiped, tone, delay }: { label: string; pct: number; wiped: number; tone: "safe" | "cliff"; delay: number }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
      <dt className="text-sm">
        {label}
        <span className="block text-xs text-muted">{wiped} wiped out</span>
      </dt>
      <dd className="h-2.5 rounded-full bg-border" aria-hidden="true">
        <span
          className={`grow-x block h-full rounded-full ${tone === "safe" ? "bg-safe-fill" : "bg-cliff-fill"}`}
          style={{ width: `${pct}%`, ["--d" as string]: `${delay}ms` }}
        />
      </dd>
      <dd className={`num text-right font-mono text-xl ${tone === "safe" ? "text-safe" : "text-cliff"}`}>
        {fmt(pct, 1)}%<span className="sr-only"> of starting value kept</span>
      </dd>
    </div>
  );
}

function End(props: { x?: number; y?: number; index?: number; i: number; text: string; color: string; dy?: number }) {
  const { x, y, index, i, text, color, dy = 4 } = props;
  if (index !== i || x === undefined || y === undefined) return null;
  return (
    <text x={x + 6} y={y + dy} fill={color} fontSize={12} fontWeight={600}>
      {text}
    </text>
  );
}
