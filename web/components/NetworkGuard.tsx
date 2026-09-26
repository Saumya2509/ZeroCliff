"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { appChain } from "@/lib/wagmi";
import { Button } from "./ui";

/** Banner when the wallet is on the wrong chain, with a one-click switch. */
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!isConnected || chainId === appChain.id) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-glide bg-glide-fill/10 px-4 py-3 text-sm">
      <p>
        Your wallet is on another network. Soft Landing runs on <strong>{appChain.name}</strong>.
        {error && <span className="block text-muted">Switch manually in your wallet if this keeps failing.</span>}
      </p>
      <Button variant="primary" onClick={() => switchChain({ chainId: appChain.id })} disabled={isPending}>
        {isPending ? "Check your wallet…" : `Switch to ${appChain.name}`}
      </Button>
    </div>
  );
}
