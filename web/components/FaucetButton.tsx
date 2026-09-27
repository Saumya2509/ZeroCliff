"use client";

import { useAccount } from "wagmi";
import { useBalances } from "@/hooks/usePosition";
import { useTxSequence } from "@/hooks/useTxSequence";
import { mETH, mUSD } from "@/lib/contracts";
import { formatToken } from "@/lib/format";
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
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={claim} disabled={!address || tx.running}>
          {tx.running ? "Claiming…" : "Get test tokens"}
        </Button>
        {address && (
          <p className="num text-sm text-muted">
            Wallet: {formatToken(meth, "mETH")} · {formatToken(musd, "mUSD")}
          </p>
        )}
      </div>
      <TxProgress steps={tx.steps} error={tx.error} onRetry={claim} />
    </div>
  );
}
