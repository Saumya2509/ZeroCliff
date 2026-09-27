"use client";

import { useState } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import { useBalances, usePosition, usePrice } from "@/hooks/usePosition";
import { useHistory } from "@/hooks/useHistory";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { isDeployed } from "@/lib/contracts";
import { formatPrice, formatToken, healthState } from "@/lib/format";
import { MAX_UINT, health } from "@/lib/sim/glide";
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
import { PositionCard } from "./PositionCard";
import { Bot, Sparkles } from "lucide-react";
import { Card, Notice } from "./ui";
import { WalletButton } from "./WalletButton";

type TelemetryTab = "ghost" | "forecast" | "activity";

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const pos = usePosition(address);
  const { price } = usePrice();
  const { meth, musd } = useBalances(address);
  const history = useHistory(address);
  const priceHistory = usePriceHistory();
  const { data: block } = useBlockNumber({ watch: isConnected && isDeployed, query: { enabled: isConnected && isDeployed } });
  const [draft, setDraft] = useState({ collateral: 1n * 10n ** 18n, debt: 1_450n * 10n ** 18n });
  const [activeTab, setActiveTab] = useState<TelemetryTab>("ghost");

  if (!isDeployed)
    return (
      <div className="space-y-4">
        <NotDeployed />
        <DemoDashboard />
      </div>
    );

  if (!isConnected || !address)
    return (
      <Card title="Connect a wallet to start" description="Claim test tokens, open a paired position, and watch the glide path.">
        <div className="my-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 01</span>
            <p className="mt-1 font-medium text-text">Connect Wallet</p>
            <p className="mt-1 text-xs text-muted">Join the local Anvil or testnet chain.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 02</span>
            <p className="mt-1 font-medium text-text">Claim Faucet</p>
            <p className="mt-1 text-xs text-muted">Get 10 mETH & 10,000 mUSD instant liquidity.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 03</span>
            <p className="mt-1 font-medium text-text">Launch Position</p>
            <p className="mt-1 text-xs text-muted">Test the per-block glide vs classic cliff pool.</p>
          </div>
        </div>
        <WalletButton />
      </Card>
    );

  const soft = pos.soft;
  const state = soft ? healthState(soft.health) : "safe";
  const shownHealth = pos.hasPosition ? (soft?.health ?? MAX_UINT) : price ? health(draft.collateral, draft.debt, price) : MAX_UINT;
  const forecastInput = pos.hasPosition && soft ? { collateral: soft.collateral, debt: soft.debt } : draft;

  return (
    <div className="space-y-4">
      <NetworkGuard />

      {/* Cockpit Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-3 backdrop-blur sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className={`h-2.5 w-2.5 rounded-full ${
            state === "safe" ? "bg-safe shadow-[0_0_8px_var(--safe)] animate-pulse" : state === "gliding" ? "bg-glide shadow-[0_0_8px_var(--glide)] animate-pulse" : "bg-cliff shadow-[0_0_8px_var(--cliff)] animate-pulse"
          }`} />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-text">
            {pos.hasPosition ? `Position: ${state.toUpperCase()}` : "Ready to Launch"}
          </span>
          <span className="text-muted">·</span>
          <span className="font-mono text-xs text-muted">
            ETH Price: <strong className="text-text">{price ? formatPrice(price) : "—"}</strong>
          </span>
          <span className="text-muted">·</span>
          <div className="flex items-center gap-1.5 rounded-full border border-safe/30 bg-safe/10 px-2 py-0.5 font-mono text-[10px] font-bold text-safe">
            <Bot className="h-3 w-3" />
            <span>100% LOCAL QUANT AI ACTIVE</span>
          </div>
        </div>

        {/* Sleek Faucet Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-bg px-3 py-1 text-xs">
            <span className="text-muted">Wallet:</span>
            <span className="font-mono font-medium text-text">{formatToken(meth, "mETH")}</span>
            <span className="text-muted">·</span>
            <span className="font-mono font-medium text-text">{formatToken(musd, "mUSD")}</span>
          </div>
          <FaucetButton />
        </div>
      </div>

      {/* Main Cockpit Deck: 2 Columns */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Column: Actions & Position Command (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          {pos.hasPosition && (
            <Card title="Loan Summary & Safety" description="Real-time status of your collateral, borrowed debt, and protection mode">
              <PositionCard soft={soft} ghost={pos.ghost} price={price} loading={pos.isLoading} />
            </Card>
          )}

          <Card title={pos.hasPosition ? "Manage Your Loan" : "Open Position (AI Autopilot)"} description={pos.hasPosition ? "Deposit, borrow, repay, or withdraw with instant safety impact" : "Set up your loan with automated safe parameters"}>
            <ActionPanel
              user={address}
              soft={soft}
              hasPosition={pos.hasPosition}
              hasGhost={pos.hasGhost}
              price={price}
              onDraftChange={setDraft}
            />
          </Card>
        </div>

        {/* Right Column: Avionics Telemetry & Deep-Dive HUD (7 cols) */}
        <div className="space-y-4 lg:col-span-7">
          {/* Signature Health Altimeter / Safety Runway */}
          <Card title="Loan Safety Runway" description={pos.hasPosition ? "Live onchain crash cushion · Gentle micro-sales replace 100% cliff liquidations" : "Real-time safety runway based on your configured parameters"}>
            <HealthAltimeter health={shownHealth} />
          </Card>

            {/* Dedicated AI Flight Director (100% Local Quant Engine · 10.md) - ALWAYS VISIBLE */}
            <FlightDirector
              collateral={pos.hasPosition && soft ? soft.collateral : forecastInput.collateral}
              debt={pos.hasPosition && soft ? soft.debt : forecastInput.debt}
              price={price}
              history={priceHistory.data}
            />

            {/* Deep-Dive Simulation & Onchain Event Telemetry */}
            <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
              {/* Tab navigation */}
              <div className="mb-4 flex flex-wrap gap-1.5 border-b border-border/80 pb-3">
                {[
                  { id: "ghost" as const, label: "✦ Ghost Twin", hint: "Compare vs classic cliff" },
                  { id: "forecast" as const, label: "⚡ Price Shock Simulator", hint: "Landing forecast" },
                  { id: "activity" as const, label: "📜 Activity Log", hint: "Recent onchain events" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      activeTab === t.id
                        ? "bg-bg text-text shadow-sm border border-border font-semibold text-safe"
                        : "text-muted hover:bg-bg/50 hover:text-text"
                    }`}
                  >
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Panes */}
              <div>
                {activeTab === "ghost" && (
                  <div>
                    <p className="mb-2 text-xs text-muted">
                      Solid line: your Soft Landing position. Dashed line: your mirrored ghost loan in a classic cliff liquidation pool.
                    </p>
                    <GhostChart
                      points={history.data?.points ?? []}
                      loading={history.isLoading}
                      current={
                        block && pos.soft && pos.ghost ? { block: Number(block), soft: pos.soft.collateral, ghost: pos.ghost.collateral } : undefined
                      }
                    />
                    {history.error && (
                      <div className="mt-3">
                        <Notice title="History unavailable">The RPC refused the event query. Live values above are still current.</Notice>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "forecast" && (
                  <LandingForecast
                    user={address}
                    collateral={forecastInput.collateral}
                    debt={forecastInput.debt}
                    price={price}
                    hasPosition={pos.hasPosition}
                  />
                )}

                {activeTab === "activity" && (
                  <ActivityFeed items={history.data?.items} loading={history.isLoading} />
                )}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
