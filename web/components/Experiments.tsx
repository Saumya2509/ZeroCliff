"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { ExperimentData } from "@/lib/sim/data";

// Experiments E1–E7 (05 §7), read from public/results/*.json, which `npm run sim` writes with the same
// engine as the lab above. Every figure has data-experiment="Ex" so scripts/export-charts.mjs can
// screenshot it for the deck. Captions are computed from the data, never typed in.

const fmt = (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const axis = { tick: { fill: "var(--text-muted)", fontSize: 12 }, stroke: "var(--border)" };
const SHORT: Record<string, string> = { "mar-2020": "Mar 2020", "may-2021": "May 2021", "jun-2022": "Jun 2022", "aug-2024": "Aug 2024" };

export function Experiments({ data }: { data: ExperimentData }) {
  const { e1, e2, e3, e4, e5, e6, e7 } = data;
  const avg = (rows: typeof e1.data, k: "soft" | "cliff") => rows.reduce((a, r) => a + r[k].valueKeptPct, 0) / rows.length;
  const maxCascade = Math.max(...e3.data.flatMap((c) => c.points.map((p) => p.cliff.cascadeDepthPct)));
  const maxCascadeSoft = Math.max(...e3.data.flatMap((c) => c.points.map((p) => p.soft.cascadeDepthPct)));
  const whip = e6.data.find((r) => r.beta > 0) ?? e6.data[0];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Figure id="E1" title={e1.title} question={e1.question}
        caption={`Across the four crashes, borrowers kept ${fmt(avg(e1.data, "soft"), 1)}% of their equity on average under Soft Landing vs ${fmt(avg(e1.data, "cliff"), 1)}% under the cliff.`}>
        <KeptBars rows={e1.data} />
      </Figure>

      <Figure id="E2" title={e2.title} question={e2.question}
        caption={`With feedback on: ${fmt(avg(e2.data, "soft"), 1)}% vs ${fmt(avg(e2.data, "cliff"), 1)}%. Cascade depth (cliff / soft): ${e2.data.map((r) => `${SHORT[r.crash]} ${fmt(r.cliff.cascadeDepthPct, 2)}% / ${fmt(r.soft.cascadeDepthPct, 2)}%`).join(", ")}.`}>
        <KeptBars rows={e2.data} />
      </Figure>

      <Figure id="E3" title={e3.title} question={e3.question} wide
        caption={`Extra oracle drop caused by the protocol's own sales. Worst case across all runs: ${fmt(maxCascade, 2)}% of the starting price under the cliff, ${fmt(maxCascadeSoft, 2)}% under Soft Landing. Where the lines overlap at 0%, neither design moved the oracle below the market's low. The cliff's cascade is not monotonic in β.`}>
        <SmallMultiples sweeps={e3.data} x="beta" xLabel={(x) => x.toFixed(1)} y={(s) => s.cascadeDepthPct} yUnit="%" category />
      </Figure>

      <Figure id="E4" title={e4.title} question={e4.question} wide
        caption={`Value kept (% of starting equity) as the pool gets deeper. ${honestE4(e4.data)}`}>
        <SmallMultiples sweeps={e4.data} x="liquidity" xLabel={(x) => `${x}×`} y={(s) => s.valueKeptPct} yUnit="%" category />
      </Figure>

      <Figure id="E5" title={e5.title} question={e5.question} wide
        caption={`Soft Landing's value kept vs R_MAX (the cliff line is flat for reference). Backstops at 0.1% / 0.25% / 0.5% / 1% / 2%: ${e5.data.map((c) => `${SHORT[c.crash]} ${c.points.map((p) => p.soft.backstops).join("/")}`).join("; ")}. A slower glide falls behind and needs the backstop more; slippage does not fall consistently with it.`}>
        <SmallMultiples sweeps={e5.data} x="rMaxPct" xLabel={(x) => `${x}%`} y={(s) => s.valueKeptPct} yUnit="%" category />
      </Figure>

      <Figure id="E6" title={e6.title} question={e6.question}
        caption={`β = ${whip.beta}. Soft Landing sold ${fmt(whip.soft.collateralLostPerUserEth, 2)} mETH per user vs ${fmt(whip.cliff.collateralLostPerUserEth, 2)} for the cliff: yes, the glide sells more in chop and does not buy back. Users still kept ${fmt(whip.soft.valueKeptPct, 1)}% of their equity vs ${fmt(whip.cliff.valueKeptPct, 1)}%: every cliff liquidation hands the liquidator an 8% bonus from the borrower's collateral.`}>
        <div className="h-56" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={whip.series} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} {...axis} tickFormatter={(t: number) => `${Math.round(t)}m`} minTickGap={28} />
              <YAxis {...axis} width={52} domain={["auto", "auto"]} tickFormatter={(x: number) => `${fmt(x / 1e6, 1)}M`} />
              <Line dataKey="cliffEquity" stroke="var(--cliff)" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="softEquity" stroke="var(--safe)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Legend items={[["Cliff equity", "var(--cliff)", "6 4"], ["Soft Landing equity", "var(--safe)"]]} />
      </Figure>

      <Figure id="E7" title={e7.title} question={e7.question}
        caption={`${e7.data.totalSoldMeth} mETH into a ${fmt(e7.data.poolDepthMeth)} mETH pool at ${fmt(e7.data.oraclePrice)}: one dump gets ${fmt(e7.data.cliff.avgPrice, 2)} on average (${e7.data.cliff.slippageBps} bps below the oracle), ${e7.data.slices} slices get ${fmt(e7.data.glide.avgPrice, 2)} (${e7.data.glide.slippageBps} bps). Same result as the Solidity experiment.`}>
        <div className="h-56" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[{ k: "One dump", v: e7.data.cliff.slippageBps }, { k: `${e7.data.slices} slices`, v: e7.data.glide.slippageBps }]}
              margin={{ top: 20, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="k" {...axis} />
              <YAxis {...axis} width={52} tickFormatter={(x: number) => `${x}`} label={{ value: "bps", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 12 }} />
              <Bar dataKey="v" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                <Cell fill="var(--cliff)" />
                <Cell fill="var(--safe)" />
                <LabelList dataKey="v" position="top" fill="var(--text)" fontSize={12} formatter={(x: unknown) => `${x} bps`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Figure>
    </div>
  );
}

function honestE4(sweeps: ExperimentData["e4"]["data"]) {
  const gaps = sweeps.map((c) => {
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    return { crash: c.crash, from: first.soft.valueKeptPct - first.cliff.valueKeptPct, to: last.soft.valueKeptPct - last.cliff.valueKeptPct };
  });
  return `Soft Landing's lead in points, ${sweeps[0].points[0].liquidity}× → ${sweeps[0].points.at(-1)!.liquidity}×: ${gaps.map((g) => `${SHORT[g.crash]} ${fmt(g.from, 1)} → ${fmt(g.to, 1)}`).join(", ")}. Deeper pools shrink the cliff's slippage but not its 8% bonus or its selling at the low, so the lead changes only a little.`;
}

function Figure({ id, title, question, caption, wide, children }: { id: string; title: string; question: string; caption: string; wide?: boolean; children: ReactNode }) {
  return (
    <figure data-experiment={id} className={`min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <p className="eyebrow text-muted">{id}</p>
      <h3 className="mt-1 text-base font-semibold">{title}</h3>
      <p className="mt-0.5 text-sm text-muted">{question}</p>
      <div className="mt-4">{children}</div>
      <figcaption className="num mt-3 text-sm">{caption}</figcaption>
    </figure>
  );
}

function Legend({ items }: { items: [string, string, string?][] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      {items.map(([label, color, dash]) => (
        <li key={label}>
          <svg width="22" height="8" className="mr-1 inline-block align-middle" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dash} />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

function KeptBars({ rows }: { rows: ExperimentData["e1"]["data"] }) {
  const data = rows.map((r) => ({ k: SHORT[r.crash] ?? r.crash, cliff: r.cliff.valueKeptPct, soft: r.soft.valueKeptPct }));
  return (
    <>
      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -12 }} barGap={2}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="k" {...axis} />
            <YAxis {...axis} width={44} domain={[0, 100]} tickFormatter={(x: number) => `${x}%`} />
            <Bar dataKey="cliff" fill="var(--cliff)" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="cliff" position="top" fill="var(--text-muted)" fontSize={11} formatter={(x: unknown) => `${fmt(Number(x))}`} />
            </Bar>
            <Bar dataKey="soft" fill="var(--safe)" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="soft" position="top" fill="var(--text)" fontSize={11} formatter={(x: unknown) => `${fmt(Number(x))}`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["Cliff: value kept, % of starting equity", "var(--cliff)"], ["Soft Landing", "var(--safe)"]]} />
      <Table rows={rows} />
    </>
  );
}

function Table({ rows }: { rows: ExperimentData["e1"]["data"] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="num w-full min-w-[26rem] text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th scope="col" className="py-1.5 pr-3 font-medium">Crash</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Low</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Lost / user (cliff · soft)</th>
            <th scope="col" className="py-1.5 font-medium">Bad debt, wiped</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.crash}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">{SHORT[r.crash] ?? r.crash}</th>
              <td className="py-1.5 pr-3">−{fmt(r.marketLowPct, 1)}%</td>
              <td className="py-1.5 pr-3">
                <span className="text-cliff">{fmt(r.cliff.collateralLostPerUserEth, 2)}</span> · <span className="text-safe">{fmt(r.soft.collateralLostPerUserEth, 2)}</span> mETH
              </td>
              <td className="py-1.5">
                <span className="text-cliff">{fmt(r.cliff.badDebtUsd)}, {r.cliff.wiped}</span> · <span className="text-safe">{fmt(r.soft.badDebtUsd)}, {r.soft.wiped}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Round axis top so the three ticks (0, half, top) are whole numbers. */
function niceMax(m: number) {
  if (m <= 2) return 2;
  if (m <= 10) return Math.ceil(m / 2) * 2;
  return Math.ceil((m * 1.05) / 10) * 10;
}

type Brief = ExperimentData["e1"]["data"][number]["soft"];

function SmallMultiples<K extends string>({ sweeps, x, xLabel, y, yUnit, category }: {
  sweeps: { crash: string; points: (Record<K, number> & { soft: Brief; cliff: Brief })[] }[];
  x: K; xLabel: (x: number) => string; y: (s: Brief) => number; yUnit: string; category?: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sweeps.map((c) => {
          const data = c.points.map((p) => ({ x: p[x], cliff: y(p.cliff), soft: y(p.soft) }));
          const top = niceMax(Math.max(...data.flatMap((d) => [d.cliff, d.soft])));
          return (
            <div key={c.crash}>
              <p className="text-xs font-medium">{SHORT[c.crash] ?? c.crash}</p>
              <div className="h-40" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="x" type={category ? "category" : "number"} domain={category ? undefined : ["dataMin", "dataMax"]} {...axis} tickFormatter={xLabel} fontSize={11} />
                    <YAxis {...axis} width={44} domain={[0, top]} ticks={[0, top / 2, top]} tickFormatter={(v: number) => `${fmt(v)}${yUnit}`} fontSize={11} />
                    <Line dataKey="cliff" stroke="var(--cliff)" strokeDasharray="6 4" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                    <Line dataKey="soft" stroke="var(--safe)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <Legend items={[["Cliff", "var(--cliff)", "6 4"], ["Soft Landing", "var(--safe)"]]} />
    </>
  );
}
