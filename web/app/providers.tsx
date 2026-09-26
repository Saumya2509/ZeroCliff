"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { appChain, config } from "@/lib/wagmi";

const shared = { borderRadius: "medium", fontStack: "system" } as const;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000 } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
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
