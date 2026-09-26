// Reads the addresses written when the contracts are deployed (contracts/deployments/active.json).
// Shared by ponder.config.ts and the API. Nothing here deploys anything.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, zeroAddress, type Address } from "viem";

export type Deployments = {
  chainId: number;
  startBlock: number;
  oracleMode: "mock" | "pyth";
  mETH: Address;
  mUSD: Address;
  mockOracle: Address;
  pythAdapter: Address;
  amm: Address;
  sliceRouter: Address;
  cliffPool: Address;
  softLandingPool: Address;
};

export const deploymentsPath = resolve(process.env.DEPLOYMENTS_PATH ?? "../contracts/deployments/active.json");

export function loadDeployments(path = deploymentsPath): Deployments {
  if (!existsSync(path)) {
    throw new Error(`No deployments at ${path}. Deploy the contracts first, or set DEPLOYMENTS_PATH.`);
  }
  const d = JSON.parse(readFileSync(path, "utf8")) as Deployments;
  for (const k of ["softLandingPool", "cliffPool", "amm"] as const) {
    if (!d[k] || d[k] === zeroAddress) throw new Error(`${path}: ${k} is not set`);
  }
  return d;
}

/** Wallets opened by the team's seed script (06 §8), so the site can label them honestly. */
export function loadSeeded(): Set<string> {
  const path = resolve(process.env.SEEDED_PATH ?? "../contracts/deployments/seeded.json");
  if (!existsSync(path)) return new Set();
  const list = JSON.parse(readFileSync(path, "utf8")) as { wallets: string[] };
  return new Set(list.wallets.map((w) => getAddress(w)));
}
