#!/usr/bin/env node
// One-command workflows from md/manali/08 §6, cross-platform (Windows has no `make`; the Makefile just calls this).
//
//   node scripts/ops.mjs <task>
//
//   install          npm ci in web, indexer, keeper, sim; Foundry submodules
//   test             contracts + web + keeper + indexer (parity vectors run in web)
//   abis             forge build, export ABIs and addresses to web / indexer / keeper
//   deploy-local     deploy to the anvil on 127.0.0.1:8545 (mock oracle, public anvil keys)
//   seed-local       40 paired test positions on that anvil
//   offline-state    fresh anvil → deploy-local → seed-local → offline/state.json (the frozen demo chain)
//   offline-build    build the web app in offline mode against offline/state.json's addresses
//   demo-offline     start anvil (from offline/state.json, 2 s blocks), indexer, keeper and web
//   demo-stop        stop everything demo-offline started
//   demo-status      show what is running
//   deploy-testnet   deploy + verify on the chain in .env (Pyth oracle). Uses YOUR keys; never run by CI.
//   sim / charts     run experiments E1–E7 / export their PNGs (needs the web app on :3100)
//   results-to-docs  copy experiment charts and the gas table into docs/results
//   hooks            install the pre-commit secret scan

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const offline = join(root, "offline");
const win = process.platform === "win32";
const foundryBin = join(homedir(), ".foundry", "bin");
const PATH = `${foundryBin}${win ? ";" : ":"}${process.env.PATH}`;
const npm = win ? "npm.cmd" : "npm";
const npx = win ? "npx.cmd" : "npx";

// Anvil's built-in accounts. These keys are public test keys printed by every anvil; never use them elsewhere.
export const ANVIL = {
  rpc: "http://127.0.0.1:8545",
  chainId: 31337,
  admin: { key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  keeper: { key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  borrower: { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
};
const PORTS = { indexer: 42069, keeper: 8081, web: 3000 };

// ---------- helpers ----------

/** One command line for the Windows shell (npm/npx are .cmd files). Passing an args array with
 *  shell: true is deprecated (DEP0190) because Node would concatenate it unquoted. */
const commandLine = (cmd, args) => [cmd, ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

function loadDotEnv() {
  const f = join(root, ".env");
  if (!existsSync(f)) return {};
  const out = {};
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && m[2] !== "") out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${[cmd, ...args].join(" ")}${opts.cwd ? `   (in ${opts.cwd.replace(root, ".")})` : ""}`);
  const shell = win && !cmd.includes("\\");
  const r = shell
    ? spawnSync(commandLine(cmd, args), { stdio: "inherit", shell: true, ...opts, env: { ...process.env, PATH, ...opts.env } })
    : spawnSync(cmd, args, { stdio: "inherit", ...opts, env: { ...process.env, PATH, ...opts.env } });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args[0] ?? ""} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

async function rpcUp(url = ANVIL.rpc, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function httpUp(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Wait until the indexer has indexed up to the chain head, so its numbers are complete, not partial. */
async function indexerCaughtUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const [status, head] = await Promise.all([
        fetch(`http://localhost:${PORTS.indexer}/status`).then((r) => r.json()),
        fetch(ANVIL.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })
          .then((r) => r.json())
          .then((j) => Number(j.result)),
      ]);
      const indexed = Math.max(...Object.values(status).map((c) => c?.block?.number ?? 0));
      if (indexed >= head - 1) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Start a detached background process with its output in offline/<name>.log; remembered in offline/pids.json. */
function background(name, cmd, args, opts = {}) {
  mkdirSync(offline, { recursive: true });
  const log = openSync(join(offline, `${name}.log`), "w");
  const p = spawn(win ? commandLine(cmd, args) : cmd, win ? [] : args, {
    // Own process group on macOS/Linux so demo-stop can end the whole tree. Not on Windows: a detached
    // shell there loses its output, and taskkill /T already ends the tree.
    detached: !win,
    stdio: ["ignore", log, log],
    windowsHide: true,
    shell: win, // npm/npx are .cmd files on Windows
    ...opts,
    env: { ...process.env, PATH, ...opts.env },
  });
  p.unref();
  const pids = readPids();
  pids[name] = p.pid;
  writeFileSync(join(offline, "pids.json"), JSON.stringify(pids, null, 2));
  console.log(`started ${name} (pid ${p.pid}), log: offline/${name}.log`);
  return p;
}

function readPids() {
  const f = join(offline, "pids.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
}

/** PIDs listening on a TCP port. */
function listeners(port) {
  if (win) {
    const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
    const lines = (r.stdout ?? "").split(/\r?\n/).filter((l) => l.includes("LISTENING") && new RegExp(`:${port}\\s`).test(l));
    return [...new Set(lines.map((l) => Number(l.trim().split(/\s+/).pop())))].filter(Boolean);
  }
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return (r.stdout ?? "").split(/\s+/).map(Number).filter(Boolean);
}

/**
 * Stop the stack by port, not by remembered PID: Windows reuses PIDs, so a stale PID can point at an
 * unrelated process (even the one running this script). Each service owns a fixed port, so whatever
 * listens there is ours. Killing the listener also ends the npm/npx wrapper shells above it.
 */
function stopAll() {
  const services = { chain: 8545, indexer: PORTS.indexer, keeper: PORTS.keeper, web: PORTS.web };
  for (const [name, port] of Object.entries(services)) {
    for (const pid of listeners(port)) {
      if (win) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
      console.log(`stopped ${name} on :${port} (pid ${pid})`);
    }
  }
  rmSync(join(offline, "pids.json"), { force: true });
}

const localEnv = { RPC_URL: ANVIL.rpc, CHAIN_ID: String(ANVIL.chainId) };
const webDeployments = join(root, "web", "lib", "deployments.json");
const offlineDeployments = join(offline, "deployments.json");
const offlineSeeded = join(offline, "seeded.json");
const offlineMarker = join(root, "web", ".next", "OFFLINE_BUILD");
const offlinePaths = { DEPLOYMENTS_PATH: offlineDeployments, SEEDED_PATH: offlineSeeded };
/** Identifies an offline build: which addresses it was built against. */
const offlineFingerprint = () => readFileSync(offlineDeployments, "utf8").replace(/\s+/g, "");

// ---------- tasks ----------

const tasks = {
  install() {
    run("git", ["submodule", "update", "--init", "--recursive"], { cwd: root });
    for (const pkg of ["web", "indexer", "keeper", "sim"]) run(npm, ["ci"], { cwd: join(root, pkg) });
  },

  test() {
    run("forge", ["test"], { cwd: join(root, "contracts") });
    run(npm, ["test"], { cwd: join(root, "web") });
    run(npm, ["test"], { cwd: join(root, "keeper") });
    run(npm, ["test"], { cwd: join(root, "indexer") });
  },

  abis() {
    run("forge", ["build"], { cwd: join(root, "contracts") });
    run(process.execPath, [join(root, "scripts", "export-abis.mjs")], { cwd: root });
  },

  async "deploy-local"() {
    if (!(await rpcUp(ANVIL.rpc, 4))) {
      console.error("No anvil on 127.0.0.1:8545. Start one (`anvil`) or use `offline-state`.");
      process.exit(1);
    }
    run("forge", ["script", "script/Deploy.s.sol", "--rpc-url", ANVIL.rpc, "--private-key", ANVIL.admin.key, "--broadcast", "--slow"], {
      cwd: join(root, "contracts"),
      env: { ORACLE_MODE: "mock", KEEPER_ADDRESS: ANVIL.keeper.address },
    });
    tasks.abis();
  },

  "seed-local"() {
    run(npm, ["run", "seed"], {
      cwd: join(root, "keeper"),
      env: { ...localEnv, SEED_PRIVATE_KEY: ANVIL.admin.key, SEED_COUNT: process.env.SEED_COUNT ?? "40", SEED_KEYS_PATH: join(offline, "seed-keys.json") },
    });
  },

  // The offline stack is self-contained in offline/: its chain (state.json), addresses (deployments.json)
  // and test wallets (seeded.json). The shared deployment files stay free for the live testnet deployment.
  async "offline-state"() {
    stopAll();
    mkdirSync(offline, { recursive: true });
    const state = join(offline, "state.json");
    rmSync(state, { force: true });
    const shared = [join(root, "contracts", "deployments", "active.json"), join(root, "contracts", "deployments", "seeded.json"), webDeployments];
    const saved = shared.map((f) => (existsSync(f) ? readFileSync(f) : null));
    try {
      // Dump every second while we deploy and seed: a killed process on Windows can't dump on exit.
      background("anvil", "anvil", ["--dump-state", state, "--state-interval", "1", "--silent"]);
      if (!(await rpcUp())) throw new Error("anvil did not start");
      await tasks["deploy-local"]();
      tasks["seed-local"]();
      await new Promise((r) => setTimeout(r, 2500)); // let the last periodic dump land
      stopAll();
      cpSync(shared[0], offlineDeployments);
      cpSync(shared[1], offlineSeeded);
    } finally {
      shared.forEach((f, i) => (saved[i] ? writeFileSync(f, saved[i]) : rmSync(f, { force: true })));
    }
    if (!existsSync(state)) throw new Error("offline/state.json was not written");
    console.log("\n✓ offline/state.json, offline/deployments.json and offline/seeded.json written. Next: node scripts/ops.mjs offline-build");
  },

  /** Build the site against the offline addresses, then put web/lib/deployments.json back as it was. */
  "offline-build"() {
    if (!existsSync(offlineDeployments)) {
      console.error("offline/deployments.json is missing. Run offline-state first.");
      process.exit(1);
    }
    run("forge", ["build"], { cwd: join(root, "contracts") });
    run(process.execPath, [join(root, "scripts", "export-abis.mjs")], { cwd: root });
    const original = readFileSync(webDeployments);
    try {
      cpSync(offlineDeployments, webDeployments);
      run(npm, ["run", "build"], {
        cwd: join(root, "web"),
        env: { NEXT_PUBLIC_MODE: "offline", NEXT_PUBLIC_CHAIN_ID: String(ANVIL.chainId), NEXT_PUBLIC_RPC_URL: ANVIL.rpc, NEXT_PUBLIC_INDEXER_URL: `http://localhost:${PORTS.indexer}` },
      });
      writeFileSync(offlineMarker, offlineFingerprint());
    } finally {
      writeFileSync(webDeployments, original);
    }
  },

  async "demo-offline"() {
    const state = join(offline, "state.json");
    if (!existsSync(state) || !existsSync(offlineDeployments)) {
      console.error("offline/state.json is missing. Run `node scripts/ops.mjs offline-state` first (needs no internet).");
      process.exit(1);
    }
    // A plain `npm run build` in web/ replaces the offline build, so check it is still the right one.
    if (!existsSync(offlineMarker) || readFileSync(offlineMarker, "utf8") !== offlineFingerprint()) tasks["offline-build"]();
    stopAll();
    const t0 = Date.now();
    background("anvil", "anvil", ["--load-state", state, "--block-time", "2", "--silent"]);
    if (!(await rpcUp())) throw new Error("anvil did not start; see offline/anvil.log");

    // The loaded chain grows new blocks each run, so the indexer re-indexes from a clean database.
    rmSync(join(root, "indexer", ".ponder"), { recursive: true, force: true });
    const startIndexer = () =>
      background("indexer", npm, ["run", "start", "--", "--port", String(PORTS.indexer)], { cwd: join(root, "indexer"), env: { ...localEnv, ...offlinePaths } });
    startIndexer();
    background("keeper", npx, ["tsx", "src/index.ts"], {
      cwd: join(root, "keeper"),
      // On a real market, arbitrage against the oracle happens every block; every 3 blocks lets a stepped
      // crash outrun the pool, so the router refuses every slice and the demo shows no glide.
      env: { ...localEnv, ...offlinePaths, MODE: "offline", KEEPER_PRIVATE_KEY: ANVIL.keeper.key, HEALTH_PORT: String(PORTS.keeper), ARB_EVERY_BLOCKS: "1" },
    });
    background("web", npx, ["next", "start", "-p", String(PORTS.web)], { cwd: join(root, "web"), env: { NEXT_PUBLIC_MODE: "offline" } });

    // Wait for the indexer, restarting it only if it actually crashed. Its embedded database (PGlite)
    // occasionally aborts on Windows while creating its files (typically antivirus scanning them
    // mid-rename); a slow start on a busy machine is not a crash and must not be killed.
    const indexerLog = join(offline, "indexer.log");
    const crashed = () => existsSync(indexerLog) && /RuntimeError: Aborted|uncaughtException/.test(readFileSync(indexerLog, "utf8"));
    const waitIndexer = async (seconds) => {
      for (let i = 0; i < seconds; i++) {
        if (await httpUp(`http://localhost:${PORTS.indexer}/ready`, 1)) return "up";
        if (crashed()) return "crashed";
      }
      return "slow";
    };
    let [web, kpr, indexerState] = await Promise.all([
      httpUp(`http://localhost:${PORTS.web}`),
      httpUp(`http://localhost:${PORTS.keeper}/health`),
      waitIndexer(180),
    ]);
    if (indexerState === "crashed") {
      console.log("indexer crashed while starting; retrying once with a clean database (see offline/indexer.log)");
      for (const pid of listeners(PORTS.indexer)) spawnSync(win ? "taskkill" : "kill", win ? ["/PID", String(pid), "/T", "/F"] : [String(pid)], { stdio: "ignore" });
      rmSync(join(root, "indexer", ".ponder"), { recursive: true, force: true });
      startIndexer();
      indexerState = await waitIndexer(180);
    }
    let idx = indexerState === "up";
    // /ready means the backfill is done; the last few blocks are still being indexed. Report "up" only once
    // the indexer has reached the chain head, so the Losses Avoided counter is complete from the first second.
    if (idx) idx = await indexerCaughtUp();
    console.log(`\n${web && idx && kpr ? "✓" : "!"} offline stack in ${Math.round((Date.now() - t0) / 1000)} s`);
    console.log(`  site     http://localhost:${PORTS.web}        ${web ? "up" : "NOT UP, see offline/web.log"}`);
    console.log(`  indexer  http://localhost:${PORTS.indexer}       ${idx ? "up" : "NOT UP, see offline/indexer.log"}`);
    console.log(`  keeper   http://localhost:${PORTS.keeper}/health ${kpr ? "up" : "NOT UP, see offline/keeper.log"}`);
    console.log(`  chain    ${ANVIL.rpc} (chain 31337, 2 s blocks)`);
    console.log("  MetaMask: import anvil account #0 as Demo Admin and #2 as Demo Borrower (public test keys).");
    console.log("  Stop with: node scripts/ops.mjs demo-stop");
  },

  "demo-stop"() {
    stopAll();
  },

  async "demo-status"() {
    const pids = readPids();
    console.log(Object.keys(pids).length ? pids : "nothing started by demo-offline");
    console.log({
      chain: await rpcUp(ANVIL.rpc, 1),
      web: await httpUp(`http://localhost:${PORTS.web}`, 1),
      indexer: await httpUp(`http://localhost:${PORTS.indexer}/ready`, 1),
      keeper: await httpUp(`http://localhost:${PORTS.keeper}/health`, 1),
    });
  },

  "deploy-testnet"() {
    const env = { ...loadDotEnv(), ...process.env };
    const need = ["RPC_URL", "DEPLOYER_PRIVATE_KEY", "PYTH_ADDRESS", "PYTH_ETH_USD_FEED_ID"];
    const missing = need.filter((k) => !env[k]);
    if (missing.length) {
      console.error(`Set ${missing.join(", ")} in .env (see .env.example).`);
      process.exit(1);
    }
    const verify = env.EXPLORER_API_KEY
      ? env.VERIFIER_URL
        ? ["--verify", "--verifier", "blockscout", "--verifier-url", env.VERIFIER_URL]
        : ["--verify", "--etherscan-api-key", env.EXPLORER_API_KEY]
      : [];
    if (!verify.length) console.warn("EXPLORER_API_KEY not set: deploying without source verification.");
    run("forge", ["script", "script/Deploy.s.sol", "--rpc-url", env.RPC_URL, "--private-key", env.DEPLOYER_PRIVATE_KEY, "--broadcast", "--slow", ...verify, "-vvv"], {
      cwd: join(root, "contracts"),
      env: {
        ORACLE_MODE: "pyth",
        PYTH_ADDRESS: env.PYTH_ADDRESS,
        PYTH_ETH_USD_FEED_ID: env.PYTH_ETH_USD_FEED_ID,
        ...(env.KEEPER_ADDRESS ? { KEEPER_ADDRESS: env.KEEPER_ADDRESS } : {}),
        ...(env.START_PRICE ? { START_PRICE: env.START_PRICE } : {}),
      },
    });
    tasks.abis();
  },

  sim() {
    run(npm, ["run", "sim"], { cwd: join(root, "sim") });
  },

  charts() {
    run(npm, ["run", "charts"], { cwd: join(root, "web") });
  },

  "results-to-docs"() {
    const dest = join(root, "docs", "results");
    mkdirSync(dest, { recursive: true });
    const charts = join(root, "web", "public", "results", "charts");
    if (existsSync(charts)) cpSync(charts, join(dest, "charts"), { recursive: true });
    for (const f of ["gas.json", "slippage.json"]) {
      const src = join(root, "contracts", "results", f);
      if (existsSync(src)) cpSync(src, join(dest, f));
    }
    console.log(`copied experiment charts and contract results to docs/results`);
  },

  hooks() {
    run("git", ["config", "core.hooksPath", "scripts/hooks"], { cwd: root });
    console.log("pre-commit secret scan installed (scripts/hooks/pre-commit)");
  },
};

const task = process.argv[2];
if (!task || !tasks[task]) {
  console.log(`usage: node scripts/ops.mjs <task>\ntasks: ${Object.keys(tasks).join(", ")}`);
  process.exit(task ? 1 : 0);
}
await tasks[task]();
