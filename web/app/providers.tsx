"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, WagmiProvider } from "wagmi";
import { appChain, config } from "@/lib/wagmi";

const shared = { borderRadius: "medium", fontStack: "system" } as const;

/** Wipes all cached queries and stops background activity when wallet disconnects or switches accounts */
function AccountWatcher() {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();
  const prevAddress = useRef(address);
  const prevConnected = useRef(isConnected);

  useEffect(() => {
    if (!isConnected || (prevAddress.current && address !== prevAddress.current)) {
      qc.clear(); // Wipes all cached balances, positions, and history immediately
    }
    prevAddress.current = address;
    prevConnected.current = isConnected;
  }, [address, isConnected, qc]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1_000,
            gcTime: 0,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AccountWatcher />
        <RainbowKitProvider
          initialChain={appChain}
          theme={{
            lightMode: lightTheme({ ...shared, accentColor: "#2f5d50" }),
            darkMode: darkTheme({ ...shared, accentColor: "#3f7a68" }),
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
