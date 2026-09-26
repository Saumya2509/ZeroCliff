import { zeroAddress, type Address } from "viem";
import deployments from "./deployments.json";
import {
  cliffPoolAbi,
  mockAmmAbi,
  mockOracleAbi,
  mockTokenAbi,
  softLandingPoolAbi,
} from "./abis";

// Addresses come from web/lib/deployments.json, copied from contracts/deployments/active.json by
// `npm run abis`. Until the contracts are deployed it holds zero addresses and `isDeployed` is false.

const addr = (a: string) => a as Address;

export const deployment = {
  chainId: deployments.chainId,
  startBlock: BigInt(deployments.startBlock),
  oracleMode: deployments.oracleMode as "mock" | "pyth",
};

export const isDeployed = deployments.softLandingPool !== zeroAddress;

export const pool = { address: addr(deployments.softLandingPool), abi: softLandingPoolAbi } as const;
export const cliff = { address: addr(deployments.cliffPool), abi: cliffPoolAbi } as const;
export const mETH = { address: addr(deployments.mETH), abi: mockTokenAbi } as const;
export const mUSD = { address: addr(deployments.mUSD), abi: mockTokenAbi } as const;
export const mockOracle = { address: addr(deployments.mockOracle), abi: mockOracleAbi } as const;
export const amm = { address: addr(deployments.amm), abi: mockAmmAbi } as const;

/** Listed on /transparency. */
export const contractList = [
  { name: "SoftLandingPool", address: addr(deployments.softLandingPool) },
  { name: "CliffPool (ghost baseline)", address: addr(deployments.cliffPool) },
  { name: "SliceRouter", address: addr(deployments.sliceRouter) },
  { name: "MockAMM (mETH/mUSD)", address: addr(deployments.amm) },
  { name: "MockOracle", address: addr(deployments.mockOracle) },
  { name: "PythOracleAdapter", address: addr(deployments.pythAdapter) },
  { name: "mETH", address: addr(deployments.mETH) },
  { name: "mUSD", address: addr(deployments.mUSD) },
].filter((c) => c.address !== zeroAddress);
