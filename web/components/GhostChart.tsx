"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/hooks/useHistory";
import { wadToNumber } from "@/lib/format";
import { Skeleton } from "./ui";

// You vs a normal protocol: solid line = your Soft Landing collateral, dashed = your ghost in the
// cliff pool. Same deposits, same price path, different unwinding rules.

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function GhostChart({
  points,
  current,
  loading,
}: {
  points: HistoryPoint[];
  current?: { block: number; soft: bigint; ghost: bigint };
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-64 w-full" />;

  const data = points.map((p) => ({ block: p.block, soft: wadToNumber(p.soft), ghost: wadToNumber(p.ghost) }));
  if (current && data.length > 0 && current.block > data[data.length - 1].block) {
    data.push({ block: current.block, soft: wadToNumber(current.soft), ghost: wadToNumber(current.ghost) });
  }

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-sm border border-dashed border-border px-4 text-center text-sm text-muted">
        No history yet. Open a position with its ghost to see both lines here.
      </div>
    );
  }

  const last = data[data.length - 1];
  const hasGhost = data.some((d) => d.ghost > 0);
  const diff = last.soft - last.ghost;

  return (
    <figure>
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 72, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="block"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickFormatter={(b: number) => b.toLocaleString("en-US")}
              minTickGap={40}
              stroke="var(--border)"
              label={{ value: "Block", position: "insideBottomRight", offset: -2, fill: "var(--text-muted)", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              stroke="var(--border)"
              width={56}
              tickFormatter={(v: number) => v.toFixed(1)}
              label={{ value: "mETH", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
              labelFormatter={(b) => `Block ${Number(b).toLocaleString("en-US")}`}
              formatter={(v, name) => [`${fmt(Number(v))} mETH`, name === "soft" ? "Soft Landing" : "Ghost (cliff pool)"]}
            />
            <Line
              type="stepAfter"
              dataKey="soft"
              stroke="var(--safe)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              label={<EndLabel total={data.length} text="You" color="var(--safe)" dy={-6} />}
            />
            {hasGhost && (
              <Line
                type="stepAfter"
                dataKey="ghost"
                stroke="var(--cliff)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                label={<EndLabel total={data.length} text="Ghost" color="var(--cliff)" dy={14} />}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--safe)" strokeWidth="2.5" /></svg>
          Your collateral (Soft Landing)
        </span>
        {hasGhost && (
          <span className="inline-flex items-center gap-2">
            <svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--cliff)" strokeWidth="2" strokeDasharray="6 4" /></svg>
            Ghost in a normal (cliff) pool
          </span>
        )}
      </div>
      <figcaption className="num mt-2 text-sm text-muted">
        {hasGhost
          ? `Now: you hold ${fmt(last.soft)} mETH; your ghost holds ${fmt(last.ghost)} mETH. ${
              Math.abs(diff) < 1e-9
                ? "No difference yet: nothing has been unwound."
                : diff > 0
                  ? `Soft Landing has kept ${fmt(diff)} mETH more.`
                  : `The ghost holds ${fmt(-diff)} mETH more because gliding sold small slices to repay debt; the cliff pool hasn't liquidated it yet.`
            }`
          : `You hold ${fmt(last.soft)} mETH. Open a ghost position to compare against a normal protocol.`}
      </figcaption>
    </figure>
  );
}

// Recharts passes x/y/index to custom labels; only draw at the last point.
function EndLabel(props: { x?: number; y?: number; index?: number; total: number; text: string; color: string; dy?: number }) {
  const { x, y, index, total, text, color, dy = 4 } = props;
  if (index !== total - 1 || x === undefined || y === undefined) return null;
  return (
    <text x={x + 8} y={y + dy} fill={color} fontSize={12} fontWeight={600}>
      {text}
    </text>
  );
}
