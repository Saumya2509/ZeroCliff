"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { usePrice } from "@/hooks/usePosition";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { deployment, isDeployed, mockOracle } from "@/lib/contracts";
import { formatPrice, parseAmount } from "@/lib/format";
import { send } from "@/lib/tx";
import { NotDeployed } from "./NotDeployed";
import { TxProgress } from "./TxProgress";
import { Button, Card, Notice } from "./ui";

// Admin demo route for MockOracle price control and liquidations demonstration.

const RESET = 3_500n * 10n ** 18n;
// The crash script: stepwise −45% so the glide is visible block by block, like the stylised replay.
const CRASH_STEPS = [0.97, 0.95, 0.94, 0.93, 0.92, 0.9];

export function AdminPanel() {
  const { address } = useAccount();
  const owner = useReadContract({ ...mockOracle, functionName: "owner", query: { enabled: isDeployed } });
  const { price } = usePrice();
  const tx = useTxSequence();
  const [delaySec, setDelaySec] = useState(15);
  const [customPrice, setCustomPrice] = useState("");

  if (!isDeployed) return <NotDeployed />;
  if (deployment.oracleMode !== "mock")
    return <Notice title="This deployment uses the live Pyth price">Demo price controls only work on deployments that use MockOracle.</Notice>;
  if (!address) return <Notice title="Connect the demo admin wallet">Controls appear for the MockOracle owner only.</Notice>;
  if (owner.data && owner.data.toLowerCase() !== address.toLowerCase())
    return (
      <Notice title="Not the demo admin">
        This wallet ({address.slice(0, 6)}…{address.slice(-4)}) does not own the MockOracle contract. Owner is {owner.data.slice(0, 6)}…{owner.data.slice(-4)}.
      </Notice>
    );

  const setTo = (p: bigint, label: string): TxStep => ({
    label,
    run: () => send({ ...mockOracle, functionName: "setPrice", args: [p], account: address }),
  });

  const move = (bps: number) => {
    if (!price) return;
    const p = (price * BigInt(10_000 + bps)) / 10_000n;
    tx.run([setTo(p, `Set price to ${formatPrice(p)} (${bps > 0 ? "+" : ""}${bps / 100}%)`)]);
  };

  const setCustom = () => {
    const p = parseAmount(customPrice);
    if (!p || p === 0n) return;
    tx.run([setTo(p, `Set price to ${formatPrice(p)}`)]);
  };

  const crash = async () => {
    if (!price) return;
    let p = price;
    const steps: TxStep[] = CRASH_STEPS.map((f, i) => {
      p = (p * BigInt(Math.round(f * 10_000))) / 10_000n;
      const target = p;
      return {
        label: `Step ${i + 1}: ${formatPrice(target)}`,
        run: async () => {
          if (i > 0) await new Promise((r) => setTimeout(r, delaySec * 1000));
          return send({ ...mockOracle, functionName: "setPrice", args: [target], account: address });
        },
      };
    });
    tx.run(steps);
  };

  return (
    <div className="space-y-6">
      <Card title="Oracle Price Control" description={price ? `Current Pyth / Mock Feed: ${formatPrice(price)}` : "Loading…"}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Set Exact Price (USD)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="e.g. 2000"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                className="num min-h-10 w-48 rounded-lg border border-border bg-surface px-3 text-sm font-mono text-text outline-none focus:border-safe"
              />
              <Button onClick={setCustom} disabled={tx.running || !customPrice} variant="primary">
                Set Custom Price
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Quick Price Adjustments
            </span>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => move(-500)} disabled={tx.running}>−5% Shock</Button>
              <Button onClick={() => move(-1500)} disabled={tx.running}>−15% Shock</Button>
              <Button onClick={() => move(-2500)} disabled={tx.running}>−25% Crash</Button>
              <Button onClick={() => move(1000)} disabled={tx.running}>+10% Rally</Button>
              <Button onClick={() => tx.run([setTo(RESET, "Reset to 3,500.00 mUSD")])} disabled={tx.running}>
                Reset to $3,500
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <p className="text-sm font-medium text-text">Simulated Cascading Flash Crash</p>
          <p className="mt-1 text-xs text-muted">
            Executes 6 consecutive price drops totalling ~45% drawdown with block delays, demonstrating Soft Landing liquidation glides vs classic cliff liquidations live.
          </p>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-muted">
              Delay between drops:
              <input
                type="number"
                min={2}
                max={120}
                value={delaySec}
                onChange={(e) => setDelaySec(Number(e.target.value) || 15)}
                className="num h-8 w-16 rounded border border-border bg-surface px-2 text-center text-xs"
              />
              seconds
            </label>
            <Button variant="primary" onClick={crash} disabled={tx.running || !price}>
              Trigger Crash Script
            </Button>
          </div>
        </div>

        <TxProgress steps={tx.steps} error={tx.error} />
      </Card>
    </div>
  );
}
