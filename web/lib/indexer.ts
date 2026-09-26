// Client for the indexer's REST API (indexer/src/api). Every call has a short timeout so the site can
// fall back to reading the chain directly when the indexer is down (06 §7).

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL?.replace(/\/$/, "");

export async function indexerGet<T>(path: string, timeoutMs = 4_000): Promise<T> {
  if (!INDEXER_URL) throw new Error("no indexer configured");
  const res = await fetch(`${INDEXER_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  return (await res.json()) as T;
}

/** GET /stats/losses-avoided. Big numbers arrive as decimal strings. */
export type LossesAvoidedResponse = {
  totalMeth: string;
  totalWei: string;
  pairedUsers: number;
  usersBetter: number;
  usersWorse: number;
  usersEqual: number;
  seededUsers: number;
  price: string;
  priceBlock: string;
  asOfBlock: string;
  definition: string;
};

/** GET /activity/:user */
export type ActivityResponse = {
  user: string;
  positions: { pool: "soft" | "cliff"; collateral: string; debt: string }[];
  items: ({ type: string; pool: "soft" | "cliff"; block: string; txHash: `0x${string}`; id: string } & Record<string, string>)[];
  asOfBlock: string;
};
