import { createConfig } from "ponder";
import { cliffPoolAbi, mockAmmAbi, mockOracleAbi, softLandingPoolAbi } from "./abis";
import { loadDeployments } from "./deployments";

// One chain: anvil for the offline finale, or the public testnet. Addresses and startBlock come from
// the deployment record, so the indexer never scans from block 0.
const d = loadDeployments();
const rpc = process.env.RPC_URL ?? (d.chainId === 31337 ? "http://127.0.0.1:8545" : undefined);
if (!rpc) throw new Error("Set RPC_URL for the chain the contracts are deployed on.");

export default createConfig({
  // PGlite (embedded) by default, so it runs offline with no database server; DATABASE_URL switches to Postgres.
  database: process.env.DATABASE_URL ? { kind: "postgres", connectionString: process.env.DATABASE_URL } : { kind: "pglite" },
  chains: {
    app: { id: d.chainId, rpc, pollingInterval: d.chainId === 31337 ? 500 : 2_000 },
  },
  contracts: {
    SoftLandingPool: { chain: "app", abi: softLandingPoolAbi, address: d.softLandingPool, startBlock: d.startBlock },
    CliffPool: { chain: "app", abi: cliffPoolAbi, address: d.cliffPool, startBlock: d.startBlock },
    MockAMM: { chain: "app", abi: mockAmmAbi, address: d.amm, startBlock: d.startBlock },
    // In Pyth mode there are no PriceSet events; the price ticks below read the adapter instead.
    MockOracle: { chain: "app", abi: mockOracleAbi, address: d.mockOracle, startBlock: d.startBlock },
  },
  blocks: {
    // Oracle and AMM price every N blocks, for charts and for valuing positions in /stats/losses-avoided.
    PriceTick: { chain: "app", startBlock: d.startBlock, interval: Number(process.env.PRICE_TICK_EVERY ?? 5) },
  },
});
