"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import { useHistory } from "@/hooks/useHistory";
import { useBalances, usePosition, usePrice } from "@/hooks/usePosition";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { thresholds } from "@/lib/ai/flightDirector";
import { isDeployed } from "@/lib/contracts";
import { formatHealth, formatPrice, formatToken, healthState } from "@/lib/format";
import { health, MAX_UINT } from "@/lib/sim/glide";
import { ActionPanel } from "./ActionPanel";
import { ActivityFeed } from "./ActivityFeed";
import { DemoDashboard } from "./DemoDashboard";
import { FaucetButton } from "./FaucetButton";
import { FlightDirector } from "./FlightDirector";
import { GhostChart } from "./GhostChart";
import { HealthAltimeter } from "./HealthAltimeter";
import { LandingForecast } from "./LandingForecast";
import { NetworkGuard } from "./NetworkGuard";
import { NotDeployed } from "./NotDeployed";
import { Card, Notice, StatusBadge } from "./ui";
import { WalletButton } from "./WalletButton";

type DetailTab = "ghost" | "forecast" | "activity";
const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "ghost", label: "You vs a normal pool" },
  { id: "forecast", label: "If the price drops" },
  { id: "activity", label: "Activity" },
];

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const pos = usePosition(address);
  const { price } = usePrice();
  const { meth, musd } = useBalances(address);
  const history = useHistory(address);
  const priceHistory = usePriceHistory();
  const { data: block } = useBlockNumber({ watch: isConnected && isDeployed, query: { enabled: isConnected && isDeployed } });
  const [draft, setDraft] = useState({ collateral: 0n, debt: 0n });
  const [tab, setTab] = useState<DetailTab>("ghost");

  if (!isDeployed)
    return (
      <div className="space-y-4">
        <NotDeployed />
        <DemoDashboard />
      </div>
    );

  if (!isConnected || !address)
    return (
      <Card title="Connect a wallet to start" description="Everything runs on a test network with free test tokens.">
        <ol className="mb-5 list-decimal space-y-1.5 pl-5 text-sm">
          <li>Connect a wallet and switch to the test network.</li>
          <li>Get test tokens: 10 mETH and 10,000 mUSD.</li>
          <li>Open a loan, with a ghost in a normal pool to compare against.</li>
        </ol>
        <WalletButton />
      </Card>
    );

  const soft = pos.soft;
  const has = pos.hasPosition && !!soft;
  const shownHealth = has ? soft!.health : price && draft.debt > 0n ? health(draft.collateral, draft.debt, price) : MAX_UINT;
  const forecastInput = has ? { collateral: soft!.collateral, debt: soft!.debt } : draft;
  const levels = has && price && soft!.debt > 0n ? thresholds({ collateral: soft!.collateral, debt: soft!.debt, price }) : undefined;
  const toWad = (x: number) => BigInt(Math.round(x * 100)) * 10n ** 16n;

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % DETAIL_TABS.length : e.key === "ArrowLeft" ? (i - 1 + DETAIL_TABS.length) % DETAIL_TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(DETAIL_TABS[next].id);
    document.getElementById(`detail-${DETAIL_TABS[next].id}`)?.focus();
  };

  return (
    <div className="space-y-6">
      <NetworkGuard />

      {/* Summary strip: the four numbers that matter, then the wallet. */}
      <section aria-label="Loan summary" className="rounded-lg border border-border bg-surface">
        <div className="grid divide-y divide-border lg:grid-cols-[minmax(0,1fr)_auto] lg:divide-x lg:divide-y-0">
          <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
            <Figure label="Health">
              {has ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl leading-none">{soft!.debt === 0n ? "No debt" : formatHealth(soft!.health)}</span>
                  <StatusBadge state={healthState(soft!.health)} />
                </span>
              ) : (
                <span className="font-sans text-muted">No loan yet</span>
              )}
            </Figure>
            <Figure label="Collateral" sub={has && price ? `≈ ${formatToken((soft!.collateral * price) / 10n ** 18n, "mUSD", 0)}` : undefined}>
              {has ? formatToken(soft!.collateral, "mETH", 4) : "–"}
            </Figure>
            <Figure label="Debt">{has ? formatToken(soft!.debt, "mUSD") : "–"}</Figure>
            <Figure label="Glide starts at" sub={levels ? (levels.glideDropPct > 0 ? `ETH −${levels.glideDropPct.toFixed(1)}%` : "ETH is below it now") : undefined}>
              {levels ? formatPrice(toWad(levels.glidePrice)) : "–"}
            </Figure>
          </dl>
          <div className="flex flex-col justify-center gap-2 px-4 py-3 sm:px-5 lg:w-72">
            <p className="num text-sm">
              <span className="text-muted">ETH </span>
              {price ? formatPrice(price) : "–"}
            </p>
            <FaucetButton />
            <p className="sr-only">
              Wallet {formatToken(meth, "mETH")}, {formatToken(musd, "mUSD")}
            </p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title={has ? "Manage your loan" : "Open a loan"}>
          <ActionPanel user={address} soft={soft} hasPosition={pos.hasPosition} hasGhost={pos.hasGhost} price={price} onDraftChange={setDraft} />
        </Card>

        <div className="space-y-6">
          <div>
            <HealthAltimeter health={shownHealth} />
            {!has && draft.debt > 0n && <p className="mt-2 text-xs text-muted">Preview for the amounts in the form.</p>}
          </div>

          <section aria-label="Loan details" className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div role="tablist" aria-label="Loan details" className="flex flex-wrap gap-x-5 border-b border-border">
              {DETAIL_TABS.map((t, i) => (
                <button
                  key={t.id}
                  id={`detail-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="detail-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  onKeyDown={(e) => onTabKey(e, i)}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px min-h-10 cursor-pointer border-b-2 text-sm transition-colors ${
                    tab === t.id ? "border-text font-medium text-text" : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div id="detail-panel" role="tabpanel" aria-labelledby={`detail-${tab}`} className="pt-4">
              {tab === "ghost" && (
                <div>
                  <p className="mb-3 text-sm text-muted">
                    Solid: your collateral in Soft Landing. Dashed: the same loan in a normal pool, liquidated in one go below health 1.00.
                  </p>
                  <GhostChart
                    points={bothOpen(history.data?.points ?? [])}
                    loading={history.isLoading}
                    current={block && pos.soft && pos.ghost ? { block: Number(block), soft: pos.soft.collateral, ghost: pos.ghost.collateral } : undefined}
                  />
                  {pos.ghost && (pos.ghost.collateral > 0n || pos.ghost.debt > 0n) && (
                    <p className="num mt-3 text-sm text-muted">
                      Ghost: {formatToken(pos.ghost.collateral, "mETH", 4)} · {formatToken(pos.ghost.debt, "mUSD")} debt · health {formatHealth(pos.ghost.health)}
                    </p>
                  )}
                  {history.error && (
                    <div className="mt-3">
                      <Notice title="History unavailable">The RPC refused the event query. The live values above are still current.</Notice>
                    </div>
                  )}
                </div>
              )}
              {tab === "forecast" && (
                <LandingForecast user={address} collateral={forecastInput.collateral} debt={forecastInput.debt} price={price} hasPosition={pos.hasPosition} />
              )}
              {tab === "activity" && <ActivityFeed items={history.data?.items} loading={history.isLoading} />}
            </div>
          </section>

          <Card title="Ask about your loan" description="Answers are computed in your browser from the contract's own maths. No network calls, no language model.">
            <FlightDirector collateral={forecastInput.collateral} debt={forecastInput.debt} price={price} history={priceHistory.data} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The ghost is opened a few blocks after the real loan; start the chart once both exist. */
function bothOpen<T extends { soft: bigint; ghost: bigint }>(points: T[]) {
  const first = points.findIndex((p) => p.soft > 0n && p.ghost > 0n);
  return first > 0 ? points.slice(first) : points;
}

function Figure({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 whitespace-nowrap font-mono text-base">{children}</dd>
      {sub && <dd className="num text-xs text-muted">{sub}</dd>}
    </div>
  );
}
