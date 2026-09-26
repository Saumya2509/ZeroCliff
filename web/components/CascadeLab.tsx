"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Download, Pause, Play } from "lucide-react";
import type { CrashId, CrashMeta } from "@/lib/sim/data";
import type { Crash, DesignSummary, SimResult, Snapshot } from "@/lib/sim/run";
import type { WorkerRequest, WorkerResponse } from "@/lib/sim/worker";
import { useSearchParams } from "next/navigation";
import results from "@/lib/results.json";
import { Button, Card, Notice } from "./ui";

// Cascade Lab (05): replays a real crash through a population of borrowers twice, once under cliff
// liquidation and once under Soft Landing, each with its own AMM. The engine runs in a Web Worker;
// the page animates from the per-step snapshots it returns. Parameters live in the URL.

type Params = { crash: CrashId; beta: number; liquidity: number; rMaxPct: number; users: number; alpha: number };
const DEFAULTS: Params = { crash: "may-2021", beta: 0.3, liquidity: 1, rMaxPct: 0.5, users: 200, alpha: 0.3 };
const LIQUIDITY = [0.5, 1, 2, 5];
const DURATION_MS = 14_000;
const MAX_POINTS = 480;

const clamp = (x: number, lo: number, hi: number, dflt: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt);

function fromUrl(search: string, ids: string[]): Params {
  const q = new URLSearchParams(search);
  const num = (k: string, lo: number, hi: number, d: number) => (q.has(k) ? clamp(Number(q.get(k)), lo, hi, d) : d);
  const crash = q.get("crash");
  const liq = num("liq", 0.5, 5, DEFAULTS.liquidity);
  return {
    crash: crash && ids.includes(crash) ? (crash as CrashId) : DEFAULTS.crash,
    beta: num("beta", 0, 0.5, DEFAULTS.beta),
    liquidity: LIQUIDITY.includes(liq) ? liq : DEFAULTS.liquidity,
    rMaxPct: num("rmax", 0.1, 2, DEFAULTS.rMaxPct),
    users: Math.round(num("users", 50, 400, DEFAULTS.users) / 50) * 50,
    alpha: num("alpha", 0.1, 1, DEFAULTS.alpha),
  };
}

function toQuery(p: Params) {
  const q = new URLSearchParams({ crash: p.crash, beta: String(p.beta) });
  if (p.liquidity !== DEFAULTS.liquidity) q.set("liq", String(p.liquidity));
  if (p.rMaxPct !== DEFAULTS.rMaxPct) q.set("rmax", String(p.rMaxPct));
  if (p.users !== DEFAULTS.users) q.set("users", String(p.users));
  if (p.alpha !== DEFAULTS.alpha) q.set("alpha", String(p.alpha));
  return q.toString();
}

const crashCache = new Map<string, Promise<Crash>>();
const loadCrash = (id: string) => {
  if (!crashCache.has(id)) {
    crashCache.set(
      id,
      fetch(`/crashes/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load crash data (${r.status})`);
        return r.json() as Promise<Crash>;
      }),
    );
  }
  return crashCache.get(id)!;
};

const fmt = (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function CascadeLab({ crashes }: { crashes: CrashMeta[] }) {
  const ids = useMemo(() => crashes.map((c) => c.id), [crashes]);
  const search = useSearchParams();
  const [params, setParams] = useState<Params>(() => fromUrl(search.toString(), ids));
  const [result, setResult] = useState<SimResult>();
  const [running, setRunning] = useState(0); // 0 = idle, else progress in (0, 1]
  const [ranKey, setRanKey] = useState(""); // scenario the shown result belongs to
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const raf = useRef(0);
  const f = { crash: useId(), beta: useId(), liq: useId(), rmax: useId(), users: useId(), alpha: useId(), time: useId() };

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  }, []);

  const play = useCallback((from = 0) => {
    cancelAnimationFrame(raf.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }
    const start = performance.now() - from * DURATION_MS;
    setPlaying(true);
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION_MS);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  // Run the engine in a worker whenever the parameters change (debounced so sliders stay smooth).
  useEffect(() => {
    window.history.replaceState(null, "", `?${toQuery(params)}`);
    const id = ++reqId.current;
    const key = toQuery(params);
    const timer = window.setTimeout(async () => {
      setError(undefined);
      setRunning(0.01);
      stop();
      try {
        const crash = await loadCrash(params.crash);
        if (id !== reqId.current) return;
        // The engine is synchronous, so a stale run is cancelled by replacing the worker.
        worker.current?.terminate();
        const w = new Worker(new URL("../lib/sim/worker.ts", import.meta.url), { type: "module" });
        worker.current = w;
        w.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const m = e.data;
          if (m.id !== reqId.current) return;
          if (m.type === "progress") setRunning(Math.max(0.01, m.done));
          else if (m.type === "error") {
            setError(m.message);
            setRunning(0);
          } else {
            setResult(m.result);
            setRanKey(key);
            setRunning(0);
            setProgress(0);
            play(0);
          }
        };
        w.onerror = () => {
          setError("The simulation worker failed to start.");
          setRunning(0);
        };
        const req: WorkerRequest = {
          id,
          crash,
          params: { beta: params.beta, liquidity: params.liquidity, rMaxBps: Math.round(params.rMaxPct * 100), users: params.users, alpha: params.alpha },
        };
        w.postMessage(req);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRunning(0);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [params, play, stop]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      worker.current?.terminate();
    },
    [],
  );

  // Until the worker returns, the result on screen belongs to the previous scenario.
  const pending = !error && ranKey !== toQuery(params);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const meta = crashes.find((c) => c.id === (result?.crash.id ?? params.crash));

  // Chart points: evenly spaced snapshots, at most MAX_POINTS.
  const points = useMemo(() => {
    if (!result) return [];
    const s = result.snapshots;
    const step = Math.max(1, Math.ceil(s.length / MAX_POINTS));
    const hours = result.crash.interval_seconds / 3600;
    return s.filter((_, i) => i % step === 0 || i === s.length - 1).map((x) => ({ ...x, h: (x.t + 1) * hours }));
  }, [result]);

  const shown = Math.max(1, Math.ceil(points.length * progress));
  const visible = points.slice(0, shown);
  const now = visible[visible.length - 1];
  const totalH = points.length ? points[points.length - 1].h : 0;
  const days = totalH > 72;
  const timeLabel = (h: number) => (days ? `${fmt(h / 24, h < 48 ? 1 : 0)}d` : `${fmt(h, 0)}h`);

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ engine: "web/lib/sim/run.ts", ...result }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `cascade-lab-${result.crash.id}-beta${result.params.beta}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEquity = result?.startEquity ?? 0;
  const v = results.vectors;

  return (
    <div className="space-y-4">
      <Card title="Scenario" description="Every change reruns the engine in a background worker. The address bar keeps the exact scenario, so the link can be shared.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <label htmlFor={f.crash} className="text-sm font-medium">Crash</label>
            <select id={f.crash} value={params.crash} onChange={(e) => set("crash", e.target.value as CrashId)}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm">
              {crashes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} (−{fmt(c.lowPct, 1)}% at the low)
                </option>
              ))}
            </select>
            {meta && <p className="mt-1 text-xs text-muted">{meta.source}. {fmt(meta.steps)} steps of {meta.interval_seconds / 60} min.</p>}
          </div>
          <Slider id={f.beta} label="β, share of price discovery in the pool being sold into" value={params.beta} min={0} max={0.5} step={0.05}
            display={params.beta.toFixed(2)} onChange={(x) => set("beta", x)} />
          <div>
            <label htmlFor={f.liq} className="text-sm font-medium">AMM liquidity</label>
            <select id={f.liq} value={params.liquidity} onChange={(e) => set("liquidity", Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm">
              {LIQUIDITY.map((l) => <option key={l} value={l}>{l}× total borrower collateral</option>)}
            </select>
          </div>
          <Slider id={f.rmax} label="R_MAX, fastest glide per block" value={params.rMaxPct} min={0.1} max={2} step={0.05}
            display={`${params.rMaxPct.toFixed(2)}%`} onChange={(x) => set("rMaxPct", x)} />
          <Slider id={f.users} label="Borrowers" value={params.users} min={50} max={400} step={50} display={String(params.users)}
            onChange={(x) => set("users", x)} />
          <Slider id={f.alpha} label="α, share of the gap arbitrage closes per step" value={params.alpha} min={0.1} max={1} step={0.05}
            display={params.alpha.toFixed(2)} onChange={(x) => set("alpha", x)} />
          <div className="flex items-end">
            <Button onClick={() => setParams(DEFAULTS)} className="w-full">Reset to defaults</Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {playing ? (
            <Button onClick={stop} disabled={!result}><Pause size={16} aria-hidden="true" /> Pause</Button>
          ) : (
            <Button variant="primary" onClick={() => play(progress >= 1 ? 0 : progress)} disabled={!result || pending}>
              <Play size={16} aria-hidden="true" />
              {progress >= 1 ? "Replay" : "Resume"}
            </Button>
          )}
          <label htmlFor={f.time} className="sr-only">Replay position</label>
          <input id={f.time} type="range" min={0} max={1000} value={Math.round(progress * 1000)} disabled={!result}
            onChange={(e) => { stop(); setProgress(Number(e.target.value) / 1000); }}
            aria-valuetext={now ? `${timeLabel(now.h)} of ${timeLabel(totalH)}` : "no run yet"}
            className="min-h-11 min-w-0 flex-1 accent-[var(--safe)]" />
          <span className="num w-28 text-right text-sm text-muted">{now ? `${timeLabel(now.h)} / ${timeLabel(totalH)}` : "–"}</span>
          <Button onClick={download} disabled={!result || pending}><Download size={16} aria-hidden="true" /> Download results (JSON)</Button>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div className="h-full bg-safe-fill transition-[width] duration-150" style={{ width: `${Math.round((pending ? running : 1) * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted" role="status" aria-live="polite">
          {pending
            ? `Running ${params.users} borrowers through both designs… ${Math.round(running * 100)}%`
            : result
              ? `Ran ${fmt(result.crash.steps)} steps.`
              : "Could not run."}
        </p>
      </Card>

      {error && <Notice tone="warn" title="The simulation could not run">{error}</Notice>}

      {result && now && (
        <>
          <Card title="The price each protocol sees"
            description={result.params.beta > 0
              ? `Oracle = ${result.params.beta} × its own pool + ${fmt(1 - result.params.beta, 2)} × market. Liquidation dumps pull the cliff pool's oracle below the market: that gap is the cascade.`
              : "β = 0: the oracle reads only the external market, so no cascade is possible."}>
            <div className="h-60 w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="h" type="number" domain={[0, totalH]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" tickFormatter={timeLabel} minTickGap={32} />
                  <YAxis domain={[(min: number) => Math.floor((min * 0.95) / 100) * 100, (max: number) => Math.ceil((max * 1.02) / 100) * 100]}
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" width={52} tickFormatter={(x: number) => fmt(x)} />
                  {/* drawn soft → market → cliff so the cliff's dips below the market stay visible */}
                  <Line dataKey="oracleSoft" stroke="var(--safe)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="market" stroke="var(--chart-price)" strokeWidth={1.5} strokeDasharray="1 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="oracleCliff" stroke="var(--cliff)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-live="polite">
              <li><Key dash="1 4" color="var(--chart-price)" /> Market {fmt(now.market, 2)}</li>
              <li><Key dash="6 4" color="var(--cliff)" /> Cliff oracle {fmt(now.oracleCliff, 2)}</li>
              <li><Key color="var(--safe)" /> Soft Landing oracle {fmt(now.oracleSoft, 2)}</li>
            </ul>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <EquityPanel title="Cliff pool (normal protocol)" color="var(--cliff)" dashed data={visible} dataKey="cliffEquity" total={startEquity}
              timeLabel={timeLabel} totalH={totalH} held={now.cliffEquity}
              stat={`${fmt(now.liquidations)} liquidations so far`} />
            <EquityPanel title="Soft Landing" color="var(--safe)" data={visible} dataKey="softEquity" total={startEquity}
              timeLabel={timeLabel} totalH={totalH} held={now.softEquity}
              stat={`${fmt(now.glides)} glide slices · ${fmt(now.backstops)} backstops so far`} />
          </div>

          <ResultTable result={result} />
        </>
      )}

      <Card title="Can you trust the engine?">
        <p className="text-sm">
          The same TypeScript engine runs this page and the experiment CLI. It is checked against vectors exported from the real
          contracts:{" "}
          <strong>
            {v.glide} / {v.glide} glide vectors and {v.engineTotal} / {v.engineTotal} engine vectors
          </strong>{" "}
          ({v.engine.amm} AMM, {v.engine.router} router, {v.engine.cliff} cliff, {v.engine.poke} full pokes) match exactly.
        </p>
        <p className="mt-1 text-xs text-muted">Tests: web/lib/sim/glide.test.ts and engine.test.ts. Vectors: contracts/test/vectors.</p>
      </Card>
    </div>
  );
}

function Slider({ id, label, value, min, max, step, display, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step: number; display: string; onChange: (x: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}: <span className="num">{display}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={display} className="mt-1 min-h-11 w-full accent-[var(--safe)]" />
    </div>
  );
}

function Key({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="22" height="8" className="mr-1 inline-block align-middle" aria-hidden="true">
      <line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
}

type Point = Snapshot & { h: number };

function EquityPanel({ title, color, dashed, data, dataKey, total, held, stat, timeLabel, totalH }: {
  title: string; color: string; dashed?: boolean; data: Point[]; dataKey: "softEquity" | "cliffEquity"; total: number;
  held: number; stat: string; timeLabel: (h: number) => string; totalH: number;
}) {
  return (
    <Card title={title} description={stat}>
      <div className="h-52 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="h" type="number" domain={[0, totalH]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" tickFormatter={timeLabel} minTickGap={32} />
            <YAxis domain={[0, Math.ceil(total / 100_000) * 100_000]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" width={52}
              tickFormatter={(x: number) => `${fmt(x / 1e6, 1)}M`} />
            <Line dataKey={dataKey} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "6 4" : undefined} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="num mt-2 text-sm text-muted">
        Value left for all borrowers (collateral at market − debt):{" "}
        <strong className="text-text">{fmt(held)} of {fmt(total)} mUSD</strong>
      </p>
    </Card>
  );
}

const DEFINITIONS: [string, string][] = [
  ["Collateral lost per user", "Mean of (starting collateral − final collateral). The mUSD figure values it at the final market price."],
  ["Value kept after recovery", "Mean of final collateral × final market price − final debt, plus any surplus sale proceeds refunded to the user. Percent is of the mean starting equity."],
  ["Cascade depth", "Lowest oracle price minus lowest market price, as % of the starting price. Zero when the oracle never went below the market's low."],
  ["Slippage paid", "Sum over all sales of (collateral × oracle price − actual AMM proceeds). Negative when the pool paid more than the oracle price."],
  ["Events", "Cliff: liquidation calls. Soft Landing: glide slices plus backstops."],
  ["Router skips", "Soft Landing slices refused because the pool was outside the 2% band or slippage was over the limit. They retry on the next poke."],
  ["Bad debt", "Debt written off after a position's collateral reached zero."],
  ["Users fully wiped", "Borrowers with zero collateral at the end."],
];

function ResultTable({ result }: { result: SimResult }) {
  const { soft, cliff } = result;
  const row = (label: string, get: (s: DesignSummary) => string) => ({ label, a: get(cliff), b: get(soft) });
  const rows = [
    row("Collateral lost per user", (s) => `${fmt(s.collateralLostPerUserEth, 3)} mETH (${fmt(s.collateralLostPerUserUsd)} mUSD)`),
    row("Value kept after recovery", (s) => `${fmt(s.valueKeptPerUser)} mUSD (${fmt(s.valueKeptPct, 1)}%)`),
    row("Cascade depth", (s) => `${fmt(s.cascadeDepthPct, 2)}%`),
    row("Slippage paid", (s) => `${fmt(s.slippageUsd)} mUSD`),
    row("Events", (s) => fmt(s.events)),
    { label: "Backstops / router skips", a: "–", b: `${fmt(soft.backstops)} / ${fmt(soft.skips)}` },
    row("Bad debt", (s) => `${fmt(s.badDebtUsd)} mUSD`),
    row("Users fully wiped", (s) => `${fmt(s.wiped)} of ${result.params.users}`),
  ];
  return (
    <Card title="Results" description={`${result.crash.label}, ${result.params.users} borrowers, β = ${result.params.beta}. Market low −${fmt(result.marketLowPct, 1)}%.`}>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[34rem] table-fixed text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
              <th scope="col" className="py-2 pr-4 font-medium">Cliff</th>
              <th scope="col" className="py-2 font-medium">Soft Landing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="py-2 pr-4 text-left font-normal text-muted">{r.label}</th>
                <td className="py-2 pr-4 text-cliff">{r.a}</td>
                <td className="py-2 font-medium text-safe">{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium">How each metric is defined</summary>
        <ul className="mt-2 space-y-2">
          {DEFINITIONS.map(([t, d]) => (
            <li key={t}><strong className="font-medium">{t}.</strong> <span className="text-muted">{d}</span></li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
