"use client";

import { useQuery } from "@tanstack/react-query";
import { INDEXER_URL, indexerGet, type PricesResponse } from "@/lib/indexer";

export type PriceHistory = { prices: number[]; intervalS: number; source: string };

/** Recent oracle prices from the indexer, for measuring volatility. Undefined when unavailable. */
export function usePriceHistory() {
  return useQuery({
    queryKey: ["price-history"],
    enabled: !!INDEXER_URL,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<PriceHistory | undefined> => {
      const r = await indexerGet<PricesResponse>("/prices?limit=500");
      if (r.ticks.length < 12) return undefined;
      const times = r.ticks.map((t) => Number(t.timestamp));
      const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0).sort((a, b) => a - b);
      const intervalS = gaps[Math.floor(gaps.length / 2)] ?? 0;
      if (!intervalS) return undefined;
      return { prices: r.ticks.map((t) => Number(t.oracle) / 1e18), intervalS, source: `last ${r.ticks.length} oracle prices from the indexer` };
    },
  });
}
