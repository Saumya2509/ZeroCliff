import { ponder, type Context } from "ponder:registry";
import { action, glide, liquidation, poolStats, position, priceTick } from "ponder:schema";
import type { Address } from "viem";
import { mockOracleAbi } from "../abis";

type Pool = "soft" | "cliff";
type Delta = { c?: bigint; d?: bigint; refunded?: bigint; lost?: bigint };
type Stats = Partial<Record<"glideCount" | "backstopCount" | "skipCount" | "liquidationCount", number>> & { badDebt?: bigint };

/** Apply signed deltas to a position; creates it on the first event. Order-independent. */
async function applyPosition(context: Context, pool: Pool, user: Address, block: bigint, x: Delta) {
  const c = x.c ?? 0n;
  const d = x.d ?? 0n;
  const refunded = x.refunded ?? 0n;
  const lost = x.lost ?? 0n;
  await context.db
    .insert(position)
    .values({ id: `${pool}:${user}`, pool, user, collateral: c, debt: d, refunded, collateralLost: lost, openedAt: block, updatedAt: block })
    .onConflictDoUpdate((row) => ({
      collateral: row.collateral + c,
      debt: row.debt + d,
      refunded: row.refunded + refunded,
      collateralLost: row.collateralLost + lost,
      updatedAt: block,
    }));
  if (c !== 0n || d !== 0n) await applyStats(context, pool, block, {}, c, d);
}

async function applyStats(context: Context, pool: Pool, block: bigint, s: Stats, c = 0n, d = 0n) {
  await context.db
    .insert(poolStats)
    .values({
      id: pool,
      totalCollateral: c,
      totalDebt: d,
      glideCount: s.glideCount ?? 0,
      backstopCount: s.backstopCount ?? 0,
      skipCount: s.skipCount ?? 0,
      liquidationCount: s.liquidationCount ?? 0,
      badDebt: s.badDebt ?? 0n,
      updatedAt: block,
    })
    .onConflictDoUpdate((row) => ({
      totalCollateral: row.totalCollateral + c,
      totalDebt: row.totalDebt + d,
      glideCount: row.glideCount + (s.glideCount ?? 0),
      backstopCount: row.backstopCount + (s.backstopCount ?? 0),
      skipCount: row.skipCount + (s.skipCount ?? 0),
      liquidationCount: row.liquidationCount + (s.liquidationCount ?? 0),
      badDebt: row.badDebt + (s.badDebt ?? 0n),
      updatedAt: block,
    }));
}

// ---------- shared lending events, both pools ----------

const SIGN = { deposit: { c: 1n, d: 0n }, withdraw: { c: -1n, d: 0n }, borrow: { c: 0n, d: 1n }, repay: { c: 0n, d: -1n } } as const;
type Kind = keyof typeof SIGN;

async function onAction(context: Context, pool: Pool, kind: Kind, e: { args: { user: Address; amount: bigint }; block: { number: bigint; timestamp: bigint }; transaction: { hash: `0x${string}` }; log: { logIndex: number } }) {
  const { user, amount } = e.args;
  await context.db.insert(action).values({
    id: `${e.transaction.hash}:${e.log.logIndex}`,
    pool,
    user,
    kind,
    amount,
    block: e.block.number,
    timestamp: e.block.timestamp,
    txHash: e.transaction.hash,
  });
  await applyPosition(context, pool, user, e.block.number, { c: SIGN[kind].c * amount, d: SIGN[kind].d * amount });
}

for (const [contract, pool] of [["SoftLandingPool", "soft"], ["CliffPool", "cliff"]] as const) {
  ponder.on(`${contract}:Deposited`, ({ event, context }) => onAction(context, pool, "deposit", event));
  ponder.on(`${contract}:Withdrawn`, ({ event, context }) => onAction(context, pool, "withdraw", event));
  ponder.on(`${contract}:Borrowed`, ({ event, context }) => onAction(context, pool, "borrow", event));
  ponder.on(`${contract}:Repaid`, ({ event, context }) => onAction(context, pool, "repay", event));
}

// ---------- Soft Landing unwinds ----------

ponder.on("SoftLandingPool:Glided", async ({ event, context }) => {
  const { user, collateralSold, debtRepaid, healthBefore, healthAfter, blocksAccrued } = event.args;
  await context.db.insert(glide).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    user,
    kind: "glide",
    collateralSold,
    debtRepaid,
    healthBefore,
    healthAfter,
    blocksAccrued,
    shortfall: 0n,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  await applyPosition(context, "soft", user, event.block.number, { c: -collateralSold, d: -debtRepaid, lost: collateralSold });
  await applyStats(context, "soft", event.block.number, { glideCount: 1 });
});

ponder.on("SoftLandingPool:BackstopLiquidated", async ({ event, context }) => {
  const { user, collateralSold, debtRepaid, shortfall } = event.args;
  await context.db.insert(glide).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    user,
    kind: "backstop",
    collateralSold,
    debtRepaid,
    shortfall,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  // the shortfall is written off, so it leaves the user's debt too
  await applyPosition(context, "soft", user, event.block.number, { c: -collateralSold, d: -(debtRepaid + shortfall), lost: collateralSold });
  await applyStats(context, "soft", event.block.number, { backstopCount: 1, badDebt: shortfall });
});

ponder.on("SoftLandingPool:Refunded", async ({ event, context }) => {
  await applyPosition(context, "soft", event.args.user, event.block.number, { refunded: event.args.amount });
});

ponder.on("SoftLandingPool:GlideSkipped", async ({ event, context }) => {
  await applyStats(context, "soft", event.block.number, { skipCount: 1 });
});

// ---------- cliff (ghost) unwinds ----------

ponder.on("CliffPool:Liquidated", async ({ event, context }) => {
  const { user, liquidator, debtRepaid, collateralSeized, health } = event.args;
  await context.db.insert(liquidation).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    user,
    liquidator,
    repaid: debtRepaid,
    seized: collateralSeized,
    health,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  await applyPosition(context, "cliff", user, event.block.number, { c: -collateralSeized, d: -debtRepaid, lost: collateralSeized });
  await applyStats(context, "cliff", event.block.number, { liquidationCount: 1 });
});

ponder.on("CliffPool:BadDebtRecorded", async ({ event, context }) => {
  await applyPosition(context, "cliff", event.args.user, event.block.number, { d: -event.args.amount });
  await applyStats(context, "cliff", event.block.number, { badDebt: event.args.amount });
});

// ---------- prices ----------

async function tick(context: Context, block: bigint, timestamp: bigint) {
  const amm = await context.client.readContract({ ...context.contracts.MockAMM, functionName: "spotPrice", blockNumber: block });
  // Whatever oracle the pool reads (mock or Pyth adapter); null while it is stale or unset.
  let oracle: bigint | null = null;
  try {
    const addr = await context.client.readContract({ ...context.contracts.SoftLandingPool, functionName: "oracle", blockNumber: block });
    [oracle] = await context.client.readContract({ abi: mockOracleAbi, address: addr, functionName: "getPrice", blockNumber: block });
  } catch {
    oracle = null;
  }
  await context.db
    .insert(priceTick)
    .values({ id: block.toString(), oracle, amm, block, timestamp })
    .onConflictDoUpdate({ oracle, amm });
}

ponder.on("PriceTick:block", async ({ event, context }) => {
  await tick(context, event.block.number, event.block.timestamp);
});

// A price change is exactly when a fresh tick matters, so record one then as well.
ponder.on("MockOracle:PriceSet", async ({ event, context }) => {
  await tick(context, event.block.number, event.block.timestamp);
});
