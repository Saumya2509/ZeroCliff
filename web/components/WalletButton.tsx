"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AlertTriangle, Wallet } from "lucide-react";
import { Button } from "./ui";

// Headless RainbowKit so the button uses our type and tokens. Secondary style: the page's own
// call to action stays the one primary button on screen.
export function WalletButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        if (!ready) return <span aria-hidden="true" className="inline-block h-11 w-36" />;
        if (!account || !chain)
          return (
            <Button variant={variant} onClick={openConnectModal}>
              <Wallet size={16} aria-hidden="true" />
              Connect wallet
            </Button>
          );
        if (chain.unsupported)
          return (
            <Button variant="secondary" onClick={openChainModal} className="border-glide text-glide">
              <AlertTriangle size={16} aria-hidden="true" />
              Wrong network
            </Button>
          );
        return (
          <Button variant="secondary" onClick={openAccountModal} aria-label={`Wallet ${account.displayName}, open account menu`}>
            <span className="h-2 w-2 rounded-full bg-safe" aria-hidden="true" />
            <span className="num">{account.displayName}</span>
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
