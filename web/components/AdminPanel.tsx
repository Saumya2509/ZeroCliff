"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { usePrice } from "@/hooks/usePosition";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { deployment, isDeployed, mockOracle } from "@/lib/contracts";
import { formatPrice } from "@/lib/format";
import { send } from "@/lib/tx";
import { NotDeployed } from "./NotDeployed";
import { TxProgress } from "./TxProgress";
import { Button, Card, Notice } from "./ui";

// Hidden demo route. Controls render only for the MockOracle owner; the contract enforces it anyway.

const RESET = 3_500n * 10n ** 18n;
// The crash script: stepwise −45% so the glide is visible block by block, like the stylised replay.
const CRASH_STEPS = [0.97, 0.95, 0.94, 0.93, 0.92, 0.9];

export function AdminPanel() {
  const { address } = useAccount();
  const owner = useReadContract({ ...mockOracle, functionName: "owner", query: { enabled: isDeployed } });
  const { price } = usePrice();
  const tx = useTxSequence();
  const [delaySec, setDelaySec] = useState(20);

  if (!isDeployed) return <NotDeployed />;
  if (deployment.oracleMode !== "mock")
    return <Notice title="This deployment uses the live Pyth price">Demo price controls only work on deployments that use MockOracle.</Notice>;
  if (!address) return <Notice title="Connect the demo admin wallet">Controls appear for the MockOracle owner only.</Notice>;
  if (owner.data && owner.data.toLowerCase() !== address.toLowerCase())
    return <Notice title="Not the demo admin">This wallet doesn’t own the MockOracle, so there is nothing to show here.</Notice>;

  const setTo = (p: bigint, label: string): TxStep => ({
    label,
    run: () => send({ ...mockOracle, functionName: "setPrice", args: [p], account: address }),
  });
  const move = (bps: number) => {
    if (!price) return;
    const p = (price * BigInt(10_000 + bps)) / 10_000n;
    tx.run([setTo(p, `Set price to ${formatPrice(p)} (${bps > 0 ? "+" : ""}${bps / 100}%)`)]);
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
    <Card title="Oracle price" description={price ? `Now ${formatPrice(price)}` : "Loading…"}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => move(-500)} disabled={tx.running}>Price −5%</Button>
        <Button onClick={() => move(-2500)} disabled={tx.running}>Price −25%</Button>
        <Button onClick={() => move(1000)} disabled={tx.running}>Price +10%</Button>
        <Button onClick={() => tx.run([setTo(RESET, "Reset to 3,500.00 mUSD")])} disabled={tx.running}>Reset to 3,500</Button>
      </div>
      <div className="mt-6 border-t border-border pt-4">
        <p className="text-sm font-medium">Crash script</p>
        <p className="mt-1 text-sm text-muted">Six drops totalling about −45%, spaced out so the glide shows block by block.</p>
        <label className="mt-3 flex items-center gap-3 text-sm">
          Seconds between steps
          <input type="number" min={2} max={120} value={delaySec} onChange={(e) => setDelaySec(Number(e.target.value) || 20)}
            className="num min-h-11 w-20 rounded-sm border border-border bg-surface px-2" />
        </label>
        <Button variant="primary" className="mt-3" onClick={crash} disabled={tx.running || !price}>Roll crash script</Button>
      </div>
      <TxProgress steps={tx.steps} error={tx.error} />
    </Card>
  );
}
