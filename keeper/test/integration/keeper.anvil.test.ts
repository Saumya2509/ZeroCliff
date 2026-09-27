// 07 §10 integration test, run against YOUR local anvil deployment (it deploys nothing).
// It snapshots anvil first and reverts at the end, so the chain is left exactly as it was.
//
//   ANVIL_TEST=1 OWNER_PRIVATE_KEY=0x…(owner of the mocks) npm run test:anvil
//
// Opens 30 paired positions, drops the price 20%, runs the keeper for 50 blocks and checks that every
// position that fell below comfort glided, with no reverted keeper transaction.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { cliffPoolAbi, mockOracleAbi, mockTokenAbi, softLandingPoolAbi } from "../../src/abis";
import { loadConfig } from "../../src/config";
import { loadDeployments, type Deployments } from "../../src/deployments";
import { startKeeper, type Keeper } from "../../src/keeper";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const PATH = resolve(process.env.DEPLOYMENTS_PATH ?? "../contracts/deployments/active.json");
const deployment = existsSync(PATH) ? loadDeployments(PATH) : undefined;
const enabled = process.env.ANVIL_TEST === "1" && deployment?.chainId === 31337 && deployment.oracleMode === "mock" && !!process.env.OWNER_PRIVATE_KEY;

const WAD = 10n ** 18n;
const LT = 850_000_000_000_000_000n;

describe.skipIf(!enabled)("keeper on anvil (existing local deployment)", () => {
  const d = deployment as Deployments;
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const wallet = (key: Hex) => createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(key) });
  let owner: ReturnType<typeof wallet>;
  const keeperKey = generatePrivateKey();
  const users: Address[] = [];
  let snapshot: Hex;
  let wasAutomine = true;
  let keeper: Keeper;
  let crashBlock: bigint;

  const send = async (w: typeof owner, p: Parameters<typeof owner.writeContract>[0]) => {
    const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract(p) });
    if (r.status !== "success") throw new Error(`${String(p.functionName)} reverted`);
  };
  /** Wait until the chain has advanced `n` blocks past `from` and the keeper has processed them. */
  const runBlocks = async (from: bigint, n: bigint) => {
    for (let i = 0; i < 600; i++) {
      const s = keeper.status();
      if (s.lastBlock !== null && BigInt(s.lastBlock) >= from + n && s.pending === 0) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`keeper did not process ${n} blocks: ${JSON.stringify(keeper.status())}`);
  };

  beforeAll(async () => {
    owner = wallet(process.env.OWNER_PRIVATE_KEY as Hex);
    snapshot = await test.snapshot();
    // Instant mining for the ~200 setup transactions (a 2 s block-time chain would take minutes);
    // blocks are then mined one at a time below. Mining mode is not part of the snapshot, so it is restored.
    wasAutomine = await test.getAutomine();
    await test.setAutomine(true);
    const [price] = await pub.readContract({ address: d.mockOracle, abi: mockOracleAbi, functionName: "getPrice" });

    // 30 burner users, each with the same position in both pools, opening health 1.40–1.55
    for (let i = 0; i < 30; i++) {
      const w = wallet(generatePrivateKey());
      const user = w.account.address;
      users.push(user);
      await test.setBalance({ address: user, value: parseEther("1") });
      const c = parseEther("5");
      const h = 1_400_000_000_000_000_000n + (150_000_000_000_000_000n * BigInt(i)) / 29n;
      const debt = (((c * price) / WAD) * LT) / h;
      await send(owner, { address: d.mETH, abi: mockTokenAbi, functionName: "mint", args: [user, c * 2n] });
      for (const [pool, abi] of [[d.softLandingPool, softLandingPoolAbi], [d.cliffPool, cliffPoolAbi]] as const) {
        await send(w, { address: d.mETH, abi: mockTokenAbi, functionName: "approve", args: [pool, c] });
        await send(w, { address: pool, abi, functionName: "deposit", args: [c] });
        await send(w, { address: pool, abi, functionName: "borrow", args: [debt] });
      }
    }

    // keeper wallet: gas plus inventory for arbitrage and liquidations
    const k = privateKeyToAccount(keeperKey).address;
    await test.setBalance({ address: k, value: parseEther("10") });
    await send(owner, { address: d.mETH, abi: mockTokenAbi, functionName: "mint", args: [k, parseEther("500")] });
    await send(owner, { address: d.mUSD, abi: mockTokenAbi, functionName: "mint", args: [k, parseEther("2000000")] });

    keeper = await startKeeper(
      loadConfig({ RPC_URL: RPC, CHAIN_ID: "31337", KEEPER_PRIVATE_KEY: keeperKey, MODE: "offline", DEPLOYMENTS_PATH: PATH, POLL_MS: "100", HEALTH_PORT: "0", ARB_EVERY_BLOCKS: "1" }),
      { deployments: d, logger: (await import("pino")).default({ level: "warn" }) },
    );

    // the crash: −20% on the oracle; the keeper's arbitrageur drags the AMM after it
    await send(owner, { address: d.mockOracle, abi: mockOracleAbi, functionName: "setPrice", args: [(price * 80n) / 100n] });
    crashBlock = await pub.getBlockNumber();
    // Real 1 s blocks from here, as on a live chain. (With instant mining every keeper transaction mines a
    // block, which triggers the next tick, so a keeper with at-risk users never goes quiet.)
    await test.setAutomine(false);
    await test.setIntervalMining({ interval: 1 });
    await runBlocks(crashBlock, 50n);
  }, 600_000);

  afterAll(async () => {
    await keeper?.stop();
    if (snapshot) await test.revert({ id: snapshot }); // leave the chain as we found it
    if (!wasAutomine) {
      await test.setAutomine(false);
      await test.setIntervalMining({ interval: 2 }); // the offline demo's block time
    }
  });

  it("glided every position that fell below comfort", async () => {
    const glided = await pub.getContractEvents({ address: d.softLandingPool, abi: softLandingPoolAbi, eventName: "Glided", fromBlock: crashBlock });
    const glidedUsers = new Set(glided.map((l) => l.args.user));
    // at −20%, every position opened at ≤ 1.55 sits at ≤ 1.24: below comfort
    for (const u of users) expect(glidedUsers.has(u), `${u} glided`).toBe(true);
  });

  it("sent no transaction that reverted", () => {
    expect(keeper.status().metrics.txReverted).toBe(0);
  });
});
