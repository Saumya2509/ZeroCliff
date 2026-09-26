import type { ActivityItem } from "@/hooks/useHistory";
import { formatHealth, formatToken, shortAddress } from "@/lib/format";
import { explorerUrl } from "@/lib/wagmi";
import { Skeleton } from "./ui";

const abs = (x: bigint) => (x < 0n ? -x : x);

function describe(it: ActivityItem): string {
  const col = formatToken(abs(it.collateralDelta), "mETH", 4);
  const debt = formatToken(abs(it.debtDelta), "mUSD");
  switch (it.kind) {
    case "deposit":
      return `Deposited ${col}`;
    case "withdraw":
      return `Withdrew ${col}`;
    case "glide":
      return `Glided ${col} · repaid ${debt} · health ${formatHealth(it.detail!.healthBefore!)} → ${formatHealth(it.detail!.healthAfter!)}`;
    case "backstop":
      return `Backstop sold ${col} · repaid ${debt}${it.detail?.shortfall ? ` · bad debt ${formatToken(it.detail.shortfall, "mUSD")}` : ""}`;
    case "liquidated":
      return `Liquidated: ${col} seized for ${debt} of debt (8% bonus to the liquidator)`;
  }
}

export function ActivityFeed({ items, loading }: { items?: ActivityItem[]; loading?: boolean }) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!items || items.length === 0)
    return <p className="text-sm text-muted">No activity yet. Deposits, glides and ghost liquidations will appear here as they happen.</p>;
  return (
    <ul className="divide-y divide-border text-sm" aria-live="polite" aria-relevant="additions">
      {items.slice(0, 30).map((it) => {
        const url = explorerUrl("tx", it.hash);
        return (
          <li key={it.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
            <span
              className={`rounded-full border px-2 text-xs font-medium ${
                it.pool === "soft" ? "border-safe text-safe" : "border-cliff text-cliff"
              }`}
            >
              {it.pool === "soft" ? "Soft Landing" : "Ghost"}
            </span>
            <span className="num min-w-0 flex-1 [overflow-wrap:anywhere]">{describe(it)}</span>
            <span className="num text-muted">
              block {it.block.toLocaleString("en-US")}{" "}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-text">
                  {shortAddress(it.hash)}
                  <span className="sr-only"> (opens block explorer)</span>
                </a>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
