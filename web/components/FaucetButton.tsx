"use client";

import { useAccount } from "wagmi";
import { useBalances } from "@/hooks/usePosition";
import { useTxSequence } from "@/hooks/useTxSequence";
import { mETH, mUSD } from "@/lib/contracts";
import { send } from "@/lib/tx";
import { TxProgress } from "./TxProgress";
import { Button } from "./ui";

/** Calls faucet() on mETH (10) and mUSD (10,000). Rate-limited to once an hour per token. */
export function FaucetButton() {
  const { address } = useAccount();
  const { meth, musd } = useBalances(address);
  const tx = useTxSequence();

  const claim = () =>
    tx.run([
      { label: "Claim 10 mETH", run: () => send({ ...mETH, functionName: "faucet", args: [], account: address! }) },
      { label: "Claim 10,000 mUSD", run: () => send({ ...mUSD, functionName: "faucet", args: [], account: address! }) },
    ]);

  return (
    <div>
      <Button
        onClick={claim}
        disabled={!address || tx.running}
        className="flex items-center gap-1.5 py-1 px-2.5 text-xs font-semibold bg-surface border border-border/80 hover:border-safe active:scale-95 transition-all"
      >
        <span>💧</span>
        <span>{tx.running ? "Minting…" : "+ Faucet"}</span>
      </Button>
      {tx.running && (
        <div className="absolute right-4 top-16 z-50 w-72 rounded-lg border border-border bg-bg/95 p-3 shadow-xl backdrop-blur">
          <TxProgress steps={tx.steps} error={tx.error} onRetry={claim} />
        </div>
      )}
    </div>
  );
}
