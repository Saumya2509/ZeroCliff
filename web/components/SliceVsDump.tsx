"use client";

import type { CSSProperties } from "react";
import { useInView } from "@/hooks/useInView";
import type { ExperimentData } from "@/lib/sim/data";

// The core idea as a picture: the same collateral sold into the same pool, once as a single
// liquidation and once as many small slices. Numbers come from experiment E7 (public/results/e7.json).
// Slices drop in one after another when the section scrolls into view.

const fmt = (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function SliceVsDump({ e7 }: { e7: ExperimentData["e7"]["data"] }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const impact = (p: number) => ((e7.oraclePrice - p) / e7.oraclePrice) * 100;

  return (
    <div ref={ref} data-inview={seen} className="grid gap-6">
      <Lane
        name="Normal protocol"
        detail="one liquidation"
        tone="cliff"
        avg={e7.cliff.avgPrice}
        bps={e7.cliff.slippageBps}
        after={e7.cliff.finalPrice}
        impact={impact(e7.cliff.finalPrice)}
      >
        <span className="drop on-view block h-full w-full rounded-[2px] bg-cliff-fill" style={{ "--d": "150ms" } as CSSProperties} />
      </Lane>
      <Lane
        name="Soft Landing"
        detail={`${e7.slices} slices`}
        tone="safe"
        avg={e7.glide.avgPrice}
        bps={e7.glide.slippageBps}
        after={e7.glide.finalPrice}
        impact={impact(e7.glide.finalPrice)}
      >
        <span className="grid h-full w-full gap-[3px]" style={{ gridTemplateColumns: `repeat(${e7.slices}, minmax(0, 1fr))` }}>
          {Array.from({ length: e7.slices }, (_, i) => (
            <span key={i} className="drop on-view block rounded-[1px] bg-safe-fill" style={{ "--d": `${250 + i * 32}ms` } as CSSProperties} />
          ))}
        </span>
      </Lane>
      <p className="text-sm text-muted">
        {e7.totalSoldMeth} mETH sold into a pool holding {fmt(e7.poolDepthMeth)} mETH at an oracle price of {fmt(e7.oraclePrice)}, with a
        budget-limited arbitrageur between slices. The single sale moves the pool itself, so the last coins sell cheapest and
        the next borrower&rsquo;s oracle may see the damage.
      </p>
    </div>
  );
}

function Lane(props: {
  name: string;
  detail: string;
  tone: "safe" | "cliff";
  avg: number;
  bps: number;
  after: number;
  impact: number;
  children: React.ReactNode;
}) {
  const color = props.tone === "safe" ? "text-safe" : "text-cliff";
  return (
    <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[11rem_minmax(0,1fr)_13rem]">
      <p>
        <span className="font-medium">{props.name}</span>
        <span className="block text-sm text-muted">{props.detail}</span>
      </p>
      <div className="h-12 rounded-[3px] border border-border bg-sunken p-1">{props.children}</div>
      <p className="num text-sm">
        <span className={`font-mono text-2xl ${color}`}>{(props.bps / 100).toFixed(2)}%</span>
        <span className="text-muted"> below the oracle</span>
        <span className="block text-xs text-muted">
          avg {fmt(props.avg, 2)} · pool left at {fmt(props.after, 0)}
          {props.impact > 0.05 ? ` (−${props.impact.toFixed(1)}%)` : ""}
        </span>
      </p>
    </div>
  );
}
