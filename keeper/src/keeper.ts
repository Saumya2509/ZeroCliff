// Start-up, block loop and job scheduler (07 §1–§9). The keeper is a convenience, not a trust
// assumption: anyone can poke, and every user action glides on its own.

import { createServer, type Server } from "node:http";
import pino, { type Logger } from "pino";
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther, type Chain, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia, foundry, sepolia } from "viem/chains";
import type { Config } from "./config";
import type { Ctx } from "./context";
import { loadDeployments, type Deployments } from "./deployments";
import { runArbitrageur } from "./jobs/arbitrageur";
import { runGhostLiquidator } from "./jobs/ghostLiquidator";
import { runGlider } from "./jobs/glider";
import { oraclePushDue, pushOracle } from "./jobs/oraclePusher";
import { Metrics } from "./lib/metrics";
import { NonceManager } from "./lib/nonce";
import { Registry } from "./registry";

function chainFor(id: number, rpc: string): Chain {
  const known = [foundry, baseSepolia, arbitrumSepolia, sepolia].find((c) => c.id === id);
  if (known) return { ...known, rpcUrls: { default: { http: [rpc] } } };
  return defineChain({ id, name: `chain-${id}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
}

export type KeeperStatus = { lastBlock: string | null; startedAt: string; jobs: Record<string, boolean>; pending: number; metrics: Record<string, number> };

export type Keeper = { ctx: Ctx; status: () => KeeperStatus; stop: () => Promise<void> };

export async function startKeeper(cfg: Config, opts: { logger?: Logger; deployments?: Deployments } = {}): Promise<Keeper> {
  const log = opts.logger ?? pino({ base: { service: "keeper" } });
  const d = opts.deployments ?? loadDeployments(cfg.DEPLOYMENTS_PATH);
  if (d.chainId !== cfg.CHAIN_ID) throw new Error(`CHAIN_ID ${cfg.CHAIN_ID} does not match the deployment (${d.chainId})`);

  const chain = chainFor(cfg.CHAIN_ID, cfg.RPC_URL);
  const transport = http(cfg.RPC_URL, { batch: true });
  const pub = createPublicClient({ chain, transport, pollingInterval: cfg.POLL_MS });
  const account = privateKeyToAccount(cfg.KEEPER_PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ chain, transport, account });
  const rpcChain = await pub.getChainId();
  if (rpcChain !== cfg.CHAIN_ID) throw new Error(`RPC is on chain ${rpcChain}, expected ${cfg.CHAIN_ID}`);

  const metrics = new Metrics();
  const registry = new Registry(pub, d, cfg.LOG_RANGE, cfg.POLL_MS);
  const ctx: Ctx = { cfg, d, pub, wallet, account, nonce: new NonceManager(pub, account.address), registry, metrics, log, pending: new Set<Hash>() };

  const jobs = {
    glider: cfg.ENABLE_GLIDER,
    oraclePusher: cfg.ENABLE_ORACLE_PUSHER && cfg.MODE === "live" && d.oracleMode === "pyth",
    ghostLiquidator: cfg.ENABLE_GHOST_LIQUIDATOR,
    arbitrageur: cfg.ENABLE_ARBITRAGEUR,
  };
  log.info({ keeper: account.address, chainId: cfg.CHAIN_ID, mode: cfg.MODE, oracle: d.oracleMode, jobs }, "starting");
  if (jobs.oraclePusher && !cfg.PYTH_API_KEY) {
    log.warn(
      { hermes: cfg.HERMES_URL },
      "PYTH_API_KEY is not set: Hermes refuses price updates without one (Pyth Core upgrade, Aug 2026), so pushes will fail with 401. Get a key from Pyth Terminal.",
    );
  }

  const head = await registry.backfill();
  registry.watch(head + 1n);
  log.info({ block: head, soft: registry.users.soft.size, cliff: registry.users.cliff.size }, "registry loaded");

  const lowGas = parseEther(cfg.LOW_GAS_ETH);
  const checkGas = async () => {
    const bal = await pub.getBalance({ address: account.address });
    if (bal < lowGas) log.warn({ balance: formatEther(bal), threshold: cfg.LOW_GAS_ETH }, "keeper gas balance low; top it up");
    return bal;
  };
  await checkGas();

  let lastBlock: bigint | null = null;
  let busy = false;
  const startedAt = new Date().toISOString();

  const onBlock = async (block: bigint) => {
    metrics.inc("blocksSeen");
    // One tick at a time, and not while earlier transactions are unmined (no nonce pile-ups on slow chains).
    if (busy || ctx.pending.size > 0) {
      metrics.inc("blocksSkipped");
      return;
    }
    busy = true;
    try {
      if (jobs.oraclePusher && oraclePushDue(ctx)) await pushOracle(ctx, block);
      if (jobs.glider) await runGlider(ctx, block);
      if (jobs.ghostLiquidator) await runGhostLiquidator(ctx, block);
      if (jobs.arbitrageur && block % BigInt(cfg.ARB_EVERY_BLOCKS) === 0n) await runArbitrageur(ctx, block);
    } catch (e) {
      log.error({ block, err: e instanceof Error ? e.message : String(e) }, "tick failed");
    } finally {
      lastBlock = block;
      busy = false;
    }
  };

  const unwatchBlocks = pub.watchBlockNumber({
    emitMissed: false,
    emitOnBegin: true,
    pollingInterval: cfg.POLL_MS,
    onBlockNumber: (b) => void onBlock(b),
    onError: (e) => log.warn({ err: e.message }, "block watch error; retrying"),
  });

  const summary = setInterval(async () => {
    const balance = await checkGas().catch(() => undefined);
    log.info(
      { summary: true, lastBlock, ...metrics.snapshot(), softUsers: registry.users.soft.size, cliffUsers: registry.users.cliff.size, gas: balance === undefined ? null : formatEther(balance) },
      "summary",
    );
  }, cfg.SUMMARY_EVERY_S * 1000);

  const status = (): KeeperStatus => ({ lastBlock: lastBlock?.toString() ?? null, startedAt, jobs, pending: ctx.pending.size, metrics: metrics.snapshot() });

  let server: Server | undefined;
  if (cfg.HEALTH_PORT > 0) {
    server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(lastBlock === null ? 503 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(status()));
      } else {
        res.writeHead(404).end();
      }
    }).listen(cfg.HEALTH_PORT, () => log.info({ port: cfg.HEALTH_PORT }, "GET /health"));
  }

  return {
    ctx,
    status,
    stop: async () => {
      unwatchBlocks();
      registry.stop();
      clearInterval(summary);
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      while (busy) await new Promise((r) => setTimeout(r, 20));
    },
  };
}
