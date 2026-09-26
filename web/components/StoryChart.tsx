"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { health } from "@/lib/sim/glide";
import { canonicalRun } from "@/lib/sim/replay";

// "How a glide works", told on one computed crash: health over time for Soft Landing (solid) and the
// same loan in a cliff pool (dashed). Numbered markers are placed by the data, not by hand.

const Y_MIN = 0.85;
const Y_MAX = 1.6;
// Only "no debt" needs a finite stand-in; real values above Y_MAX leave the plot and are clipped.
const NO_DEBT = Y_MAX * 2;

export type StoryMarks = {
  glideStart: { minute: number; health: number };
  deepest: { minute: number; health: number };
  selling: { minute: number; health: number };
  cliffHits: { minute: number; health: number }[];
};

export function useStory() {
  return useMemo(() => {
    const r = canonicalRun();
    const h = (c: bigint, d: bigint, p: bigint) => (d === 0n ? NO_DEBT : Number(health(c, d, p)) / 1e18);
    const data = r.points.map((p) => ({
      minute: (p.block * 2) / 60,
      soft: h(p.raw.softC, p.raw.softD, p.raw.price),
      cliff: h(p.raw.cliffC, p.raw.cliffD, p.raw.price),
      softC: p.raw.softC,
      cliffC: p.raw.cliffC,
    }));
    const iStart = data.findIndex((d) => d.soft < 1.25);
    const iDeep = data.reduce((m, d, i) => (d.soft < data[m].soft ? i : m), 0);
    let iStop = iDeep;
    for (let i = data.length - 1; i > 0; i--) {
      if (data[i].softC !== data[i - 1].softC) {
        iStop = i;
        break;
      }
    }
    const cliffHits = data
      .map((d, i) => ({ d, hit: i > 0 && d.cliffC < data[i - 1].cliffC, prev: data[i - 1] }))
      .filter((x) => x.hit)
      .map((x) => ({ minute: x.d.minute, health: x.prev.cliff })); // mark where it crossed, before the jump
    const at = (i: number) => ({ minute: data[i].minute, health: data[i].soft });
    const marks: StoryMarks = { glideStart: at(iStart), deepest: at(iDeep), selling: at(iStop), cliffHits };
    return { data, marks, liquidations: r.liquidations };
  }, []);
}

export function StoryChart() {
  const { data, marks } = useStory();
  const tick = { fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-plex-mono)" };
  return (
    <div className="h-80 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: -4 }}>
          <ReferenceArea y1={1.02} y2={1.25} fill="var(--glide-fill)" fillOpacity={0.14} />
          <ReferenceArea y1={Y_MIN} y2={1.02} fill="var(--cliff-fill)" fillOpacity={0.08} />
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="minute" type="number" domain={[0, "dataMax"]} ticks={[0, 15, 30, 45]} tick={tick} stroke="var(--border)" tickFormatter={(m: number) => `${Math.round(m)}m`} />
          <YAxis domain={[Y_MIN, Y_MAX]} allowDataOverflow ticks={[1.02, 1.25, 1.4]} tick={tick} stroke="var(--border)" width={44} tickFormatter={(v: number) => v.toFixed(2)} />
          <ReferenceLine
            y={1.0}
            stroke="var(--cliff)"
            strokeDasharray="2 3"
            strokeOpacity={0.8}
            label={{ value: "cliff: liquidation below 1.00", position: "insideBottomLeft", fill: "var(--cliff)", fontSize: 11, fontFamily: "var(--font-plex-mono)" }}
          />
          <Line dataKey="cliff" type="linear" stroke="var(--cliff)" strokeWidth={1.75} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          <Line dataKey="soft" type="monotone" stroke="var(--safe)" strokeWidth={3} dot={false} isAnimationActive={false} />
          {marks.cliffHits.map((m, i) => (
            <ReferenceDot key={i} x={m.minute} y={m.health} r={0} label={<Cross />} />
          ))}
          {[marks.glideStart, marks.deepest, marks.selling].map((m, i) => (
            <ReferenceDot key={`m${i}`} x={m.minute} y={m.health} r={0} label={<Marker n={i + 1} />} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Marker({ viewBox, n }: { viewBox?: { x?: number; y?: number }; n: number }) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return (
    <g>
      <line x1={x} x2={x} y1={y - 8} y2={y - 20} stroke="var(--text)" strokeWidth={1} />
      <circle cx={x} cy={y - 30} r={11} fill="var(--text)" />
      <text x={x} y={y - 26} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--bg)" fontFamily="var(--font-plex-mono)">
        {n}
      </text>
      <circle cx={x} cy={y} r={4.5} fill="var(--surface)" stroke="var(--safe)" strokeWidth={2.5} />
    </g>
  );
}

function Cross({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return <path d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`} stroke="var(--cliff)" strokeWidth={2.2} />;
}

/** Chart + the three numbered steps, with every number taken from the same computed run. */
export function GlideStory() {
  const { marks, liquidations } = useStory();
  const m = (x: number) => Math.round(x);
  const steps = [
    {
      title: "The price falls; the glide starts",
      body: `At minute ${m(marks.glideStart.minute)} health drops below 1.25. Soft Landing starts selling a small slice every block. A normal protocol does nothing yet: it waits for the cliff at 1.00.`,
    },
    {
      title: "Slices hold the loan above the floor",
      body: `The deepest point is health ${marks.deepest.health.toFixed(2)}, still above the 1.02 floor. Meanwhile the cliff pool liquidated this same loan ${liquidations} times (✕), each time taking an 8% bonus.`,
    },
    {
      title: "The price recovers; selling stops",
      body: `From minute ${m(marks.selling.minute)} nothing more is sold. Health climbs back on its own and you keep everything that’s left.`,
    },
  ];
  return (
    <div>
      <StoryChart />
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--safe)" strokeWidth="3" /></svg>
          Soft Landing health
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--cliff)" strokeWidth="2" strokeDasharray="6 4" /></svg>
          Same loan in a cliff pool (✕ = liquidation)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-5 rounded-sm bg-glide-fill/30" aria-hidden="true" />
          Glide zone, 1.02–1.25
        </span>
      </div>
      {/* A key to the numbered markers on the chart, not a feature grid. */}
      <ol className="mt-8 divide-y divide-border border-y border-border">
        {steps.map((s, i) => (
          <li key={s.title} className="grid gap-1 py-4 sm:grid-cols-[18rem_1fr] sm:gap-8">
            <h3 className="flex items-start gap-3 font-medium">
              <span className="num mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-text font-mono text-[11px] text-bg" aria-hidden="true">
                {i + 1}
              </span>
              {s.title}
            </h3>
            <p className="max-w-[62ch] text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
