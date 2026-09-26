// Addresses written when the contracts were deployed (contracts/deployments/active.json). Read-only.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zeroAddress, type Address } from "viem";

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

export function loadDeployments(path: string): Deployments {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`No deployments at ${file}. Deploy the contracts first, or set DEPLOYMENTS_PATH.`);
  const d = JSON.parse(readFileSync(file, "utf8")) as Deployments;
  for (const k of ["softLandingPool", "cliffPool", "amm", "mETH", "mUSD"] as const) {
    if (!d[k] || d[k] === zeroAddress) throw new Error(`${file}: ${k} is not set`);
  }
  return d;
}
