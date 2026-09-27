"use client";

import { useState } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import { useHistory } from "@/hooks/useHistory";
import { usePosition, usePrice } from "@/hooks/usePosition";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { isDeployed } from "@/lib/contracts";
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
import { Card, Notice } from "./ui";
import { WalletButton } from "./WalletButton";

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const pos = usePosition(address);
  const { price } = usePrice();
  const history = useHistory(address);
  const priceHistory = usePriceHistory();
  const { data: block } = useBlockNumber({ watch: isConnected && isDeployed, query: { enabled: isConnected && isDeployed } });
  const [draft, setDraft] = useState({ collateral: 4n * 10n ** 18n, debt: 8_000n * 10n ** 18n });

  if (!isDeployed)
    return (
      <div className="space-y-4">
        <NotDeployed />
        <DemoDashboard />
      </div>
    );
  if (!isConnected || !address)
    return (
      <Card title="Connect a wallet to start" description="You’ll get free test tokens, open a position and watch it glide.">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Connect a wallet and switch to the test network.</li>
          <li>Get test tokens (10 mETH and 10,000 mUSD).</li>
          <li>Open a position, with a ghost in a normal protocol for comparison.</li>
        </ol>
        <WalletButton />
      </Card>
    );

  const soft = pos.soft;
  const shownHealth = pos.hasPosition ? (soft?.health ?? MAX_UINT) : price ? health(draft.collateral, draft.debt, price) : MAX_UINT;
  const forecastInput = pos.hasPosition && soft ? { collateral: soft.collateral, debt: soft.debt } : draft;

  return (
    <div className="space-y-4">
      <NetworkGuard />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Your position" description={pos.hasPosition ? undefined : "Nothing open yet. Start below."}>
          {pos.hasPosition ? (
            <PositionCard soft={soft} ghost={pos.ghost} price={price} loading={pos.isLoading} />
          ) : (
            <FaucetButton />
          )}
        </Card>
        <Card title="Health altimeter" description={pos.hasPosition ? "Live, refreshed every few seconds." : "Preview for the amounts in the form."}>
          <HealthAltimeter health={shownHealth} />
        </Card>
      </div>

      <Card title={pos.hasPosition ? "Manage position" : "Open a position"}>
        <ActionPanel
          user={address}
          soft={soft}
          hasPosition={pos.hasPosition}
          hasGhost={pos.hasGhost}
          price={price}
          onDraftChange={setDraft}
        />
        {pos.hasPosition && (
          <div className="mt-6 border-t border-border pt-4">
            <FaucetButton />
          </div>
        )}
      </Card>

      <Card title="You vs a normal protocol" description="Same deposit, same price. Solid: your Soft Landing collateral. Dashed: your ghost in a classic cliff pool.">
        <GhostChart
          points={history.data?.points ?? []}
          loading={history.isLoading}
          current={
            block && pos.soft && pos.ghost ? { block: Number(block), soft: pos.soft.collateral, ghost: pos.ghost.collateral } : undefined
          }
        />
        {history.data?.partialFrom !== undefined && (
          <p className="mt-2 text-xs text-muted">
            Showing history from block {history.data.partialFrom.toString()}; older events are outside the{" "}
            {history.data.source === "chain" ? "direct-read window while the indexer is unavailable" : "indexer's page size"}.
          </p>
        )}
        {history.error && (
          <div className="mt-3">
            <Notice title="History unavailable">The RPC refused the event query. Live values above are still current.</Notice>
          </div>
        )}
      </Card>

      <Card title="Landing forecast" description="What happens to this position if the price drops now.">
        <LandingForecast
          user={address}
          collateral={forecastInput.collateral}
          debt={forecastInput.debt}
          price={price}
          hasPosition={pos.hasPosition}
        />
      </Card>

      <Card title="Flight Director" description="Ask about this loan in plain words. Runs in your browser: no network calls, no language model.">
        <FlightDirector
          collateral={pos.hasPosition && soft ? soft.collateral : 0n}
          debt={pos.hasPosition && soft ? soft.debt : 0n}
          price={price}
          history={priceHistory.data}
        />
      </Card>

      <Card title="Activity">
        <ActivityFeed items={history.data?.items} loading={history.isLoading} />
      </Card>
    </div>
  );
}
