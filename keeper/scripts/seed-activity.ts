// Seed testnet activity (06 §8) on an EXISTING deployment: opens paired positions (Soft Landing + cliff
// ghost, same amounts) from generated burner wallets with varied health, and records those wallets in
// contracts/deployments/seeded.json so the site labels them as the team's test positions.
// It deploys nothing. --crash then walks the MOCK oracle down in steps (demo deployments only).
//
//   SEED_PRIVATE_KEY=0x… (owner of the mock tokens/oracle) RPC_URL=… CHAIN_ID=… npm run seed [-- --crash]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { cliffPoolAbi, mockOracleAbi, mockTokenAbi, softLandingPoolAbi } from "../src/abis";
import { loadDeployments } from "../src/deployments";

const env = process.env;
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const rpc = need("RPC_URL");
const chainId = Number(need("CHAIN_ID"));
const d = loadDeployments(env.DEPLOYMENTS_PATH ?? "../contracts/deployments/active.json");
const count = Number(env.SEED_COUNT ?? 40);
const gas = parseEther(env.SEED_GAS_ETH ?? "0.002");
const seededPath = resolve(env.SEEDED_PATH ?? "../contracts/deployments/seeded.json");
const keysPath = resolve(env.SEED_KEYS_PATH ?? ".seed-keys.json"); // gitignored; lets reruns reuse wallets
const crash = process.argv.includes("--crash");

if (d.chainId !== chainId) throw new Error(`CHAIN_ID ${chainId} does not match the deployment (${d.chainId})`);
const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpc) });
const funder = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(need("SEED_PRIVATE_KEY") as Hex) });
const WAD = 10n ** 18n;
const LT = 850_000_000_000_000_000n;

async function send(w: typeof funder, p: Parameters<typeof funder.writeContract>[0] | { to: Address; value: bigint }) {
  const hash = "to" in p ? await w.sendTransaction({ ...p, chain }) : await w.writeContract(p);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
}

// Burner wallets: reuse the saved ones, generate the rest.
const keys: Hex[] = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : [];
while (keys.length < count) keys.push(generatePrivateKey());
writeFileSync(keysPath, JSON.stringify(keys, null, 2));
const wallets = keys.slice(0, count).map((k) => createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(k) }));

const [price] = await pub.readContract({ address: d.softLandingPool, abi: softLandingPoolAbi, functionName: "oracle" }).then((o) =>
  pub.readContract({ address: o, abi: mockOracleAbi, functionName: "getPrice" }),
);
console.log(`seeding ${count} paired positions at price ${formatEther(price)} from ${funder.account.address}`);

for (const [i, w] of wallets.entries()) {
  const user = w.account.address;
  const [existing] = await pub.readContract({ address: d.softLandingPool, abi: softLandingPoolAbi, functionName: "positions", args: [user] });
  if (existing > 0n) {
    console.log(`  ${i + 1}/${count} ${user} already open, skipping`);
    continue;
  }
  // deterministic spread: 1–10 mETH, opening health 1.40–1.90 (riskier ones first)
  const collateral = parseEther(String(1 + ((i * 7) % 10)));
  const health = 1_400_000_000_000_000_000n + (500_000_000_000_000_000n * BigInt(i)) / BigInt(Math.max(1, count - 1));
  const debt = (((collateral * price) / WAD) * LT) / health;

  if ((await pub.getBalance({ address: user })) < gas) await send(funder, { to: user, value: gas });
  await send(funder, { address: d.mETH, abi: mockTokenAbi, functionName: "mint", args: [user, collateral * 2n] });
  for (const [poolAddr, abi] of [[d.softLandingPool, softLandingPoolAbi], [d.cliffPool, cliffPoolAbi]] as const) {
    await send(w, { address: d.mETH, abi: mockTokenAbi, functionName: "approve", args: [poolAddr, collateral] });
    await send(w, { address: poolAddr, abi, functionName: "deposit", args: [collateral] });
    await send(w, { address: poolAddr, abi, functionName: "borrow", args: [debt] });
  }
  console.log(`  ${i + 1}/${count} ${user} ${formatEther(collateral)} mETH, health ${(Number(health) / 1e18).toFixed(2)}`);
}

writeFileSync(
  seededPath,
  JSON.stringify(
    {
      note: "Positions opened by the team's seed script for testing. The site labels these; they are not real users.",
      chainId,
      createdAt: new Date().toISOString(),
      wallets: wallets.map((w) => w.account.address),
    },
    null,
    2,
  ),
);
console.log(`wrote ${seededPath}`);

if (crash) {
  if (d.oracleMode !== "mock") throw new Error("--crash only works on a mock-oracle (demo) deployment");
  const steps = Number(env.CRASH_STEPS ?? 10);
  const stepBps = BigInt(env.CRASH_STEP_BPS ?? 200); // −2% per step
  const waitBlocks = BigInt(env.CRASH_WAIT_BLOCKS ?? 5); // let the keeper glide, arbitrage and liquidate between steps
  let p = price;
  for (let s = 1; s <= steps; s++) {
    p = (p * (10_000n - stepBps)) / 10_000n;
    await send(funder, { address: d.mockOracle, abi: mockOracleAbi, functionName: "setPrice", args: [p] });
    const at = await pub.getBlockNumber();
    console.log(`crash step ${s}/${steps}: price ${formatEther(p)} at block ${at}`);
    while ((await pub.getBlockNumber()) < at + waitBlocks) await new Promise((r) => setTimeout(r, 1_000));
  }
}
