import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrumSepolia, baseSepolia, foundry } from "wagmi/chains";

export const isOffline = process.env.NEXT_PUBLIC_MODE === "offline";

const chains = { [foundry.id]: foundry, [baseSepolia.id]: baseSepolia, [arbitrumSepolia.id]: arbitrumSepolia };
const chainId = isOffline ? foundry.id : Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? baseSepolia.id);

/** The one chain this build talks to. */
export const appChain = chains[chainId as keyof typeof chains] ?? baseSepolia;

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || undefined;
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// WalletConnect needs internet and a project id. Offline, or without an id, offer injected wallets only.
const wallets =
  !isOffline && projectId
    ? [metaMaskWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
    : [injectedWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "Soft Landing",
  projectId: projectId || "offline",
});

export const config = createConfig({
  chains: [appChain],
  connectors,
  // only appChain is used; the others are listed so every possible appChain has a transport
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [baseSepolia.id]: http(appChain.id === baseSepolia.id ? rpcUrl : undefined),
    [arbitrumSepolia.id]: http(appChain.id === arbitrumSepolia.id ? rpcUrl : undefined),
  },
  ssr: true,
});

/** Explorer link, or undefined on anvil. */
export function explorerUrl(kind: "tx" | "address", value: string) {
  const base = appChain.blockExplorers?.default.url;
  return base ? `${base}/${kind}/${value}` : undefined;
}

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
