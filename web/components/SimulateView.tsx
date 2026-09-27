"use client";

import { useAccount } from "wagmi";
import { Suspense } from "react";
import { CascadeLab } from "@/components/CascadeLab";
import { Experiments } from "@/components/Experiments";
import type { CrashMeta, ExperimentData } from "@/lib/sim/data";
import { Card } from "./ui";
import { WalletButton } from "./WalletButton";

const LIMITS = [
  "Borrowers are passive: nobody tops up or repays during the crash. Real users would, so both designs lose less in practice.",
  "One collateral type, one AMM per design, and a simplified arbitrageur that closes a fixed share of the gap each step with a capped budget.",
  "Gas costs are not included in user losses. They are reported separately on the Transparency page.",
  "β is a modelling assumption, not an estimate of any real market. That is why results are shown across a sweep.",
  "Historical data is 1-minute closes (5-minute for June 2022), not tick data. Within a candle the price is treated as flat.",
  "The keeper pokes every position every step, at most 100 blocks apart. A slower keeper would glide in bigger slices.",
];

export function SimulateView({
  crashes,
  experimentsData,
}: {
  crashes: CrashMeta[];
  experimentsData?: ExperimentData | null;
}) {
  const { isConnected, address } = useAccount();

  if (!isConnected || !address) {
    return (
      <Card
        title="Connect a wallet to access Cascade Lab"
        description="Connect your Web3 wallet to run crash simulations, configure AMM liquidity, and inspect liquidation benchmarks."
      >
        <div className="my-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 01</span>
            <p className="mt-1 font-medium text-text">Connect Wallet</p>
            <p className="mt-1 text-xs text-muted">Join with your personal Web3 account.</p>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 02</span>
            <p className="mt-1 font-medium text-text">Select Crash Scenario</p>
            <p className="mt-1 text-xs text-muted">Replay real ETH crashes (May 2021, June 2022, Aug 2024).</p>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <span className="font-mono text-xs text-safe">STEP 03</span>
            <p className="mt-1 font-medium text-text">Compare Glide vs Cliff</p>
            <p className="mt-1 text-xs text-muted">Inspect live AMM slippage and preserved collateral.</p>
          </div>
        </div>
        <WalletButton />
      </Card>
    );
  }

  return (
    <>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg border border-border bg-surface" />}>
        <CascadeLab crashes={crashes} />
      </Suspense>

      <section aria-labelledby="limits" className="mt-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
        <h2 id="limits" className="text-base font-semibold">Known limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="experiments" className="mt-14">
        <h2 id="experiments" className="display text-3xl sm:text-4xl">Experiments E1–E7</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Run with <code className="num text-sm">npm run sim</code> in <code className="num text-sm">sim/</code>, using the same engine as the
          lab above, default parameters unless noted. E4 and E6 are where Soft Landing could look worse. They are here anyway.
        </p>
        <div className="mt-6">
          {experimentsData ? (
            <Experiments data={experimentsData} />
          ) : (
            <p className="text-sm text-muted">
              No results yet. Run <code className="num">npm run sim</code> in <code className="num">sim/</code>.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
