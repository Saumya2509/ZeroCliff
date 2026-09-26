import { index, onchainTable } from "ponder";

// Positions are rebuilt from events. Every state change in the contracts emits one:
// Deposited / Withdrawn (collateral), Borrowed / Repaid (debt), Glided and BackstopLiquidated (soft
// unwinds), Liquidated and BadDebtRecorded (cliff unwinds). Refunded tracks surplus mUSD paid to the user.

export const position = onchainTable(
  "position",
  (t) => ({
    id: t.text().primaryKey(), // `${pool}:${user}`
    pool: t.text().notNull(), // "soft" | "cliff"
    user: t.hex().notNull(),
    collateral: t.bigint().notNull(),
    debt: t.bigint().notNull(),
    refunded: t.bigint().notNull(), // mUSD returned to the user from sales (soft only)
    collateralLost: t.bigint().notNull(), // sold by glides/backstops or seized by liquidations
    openedAt: t.bigint().notNull(), // block of the first deposit
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

/** Plain lending actions (deposit / withdraw / borrow / repay), so /activity can rebuild full history. */
export const action = onchainTable(
  "action",
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex
    pool: t.text().notNull(),
    user: t.hex().notNull(),
    kind: t.text().notNull(), // "deposit" | "withdraw" | "borrow" | "repay"
    amount: t.bigint().notNull(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

export const glide = onchainTable(
  "glide",
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex
    user: t.hex().notNull(),
    kind: t.text().notNull(), // "glide" | "backstop"
    collateralSold: t.bigint().notNull(),
    debtRepaid: t.bigint().notNull(),
    healthBefore: t.bigint(), // glides only
    healthAfter: t.bigint(),
    blocksAccrued: t.bigint(),
    shortfall: t.bigint().notNull(), // backstops only; written off as bad debt
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

export const liquidation = onchainTable(
  "liquidation",
  (t) => ({
    id: t.text().primaryKey(),
    user: t.hex().notNull(),
    liquidator: t.hex().notNull(),
    repaid: t.bigint().notNull(),
    seized: t.bigint().notNull(),
    health: t.bigint().notNull(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

export const poolStats = onchainTable("pool_stats", (t) => ({
  id: t.text().primaryKey(), // "soft" | "cliff"
  totalCollateral: t.bigint().notNull(),
  totalDebt: t.bigint().notNull(),
  glideCount: t.integer().notNull(),
  backstopCount: t.integer().notNull(),
  skipCount: t.integer().notNull(),
  liquidationCount: t.integer().notNull(),
  badDebt: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

export const priceTick = onchainTable("price_tick", (t) => ({
  id: t.text().primaryKey(), // block number
  oracle: t.bigint(), // null if the oracle reverted (stale / not set)
  amm: t.bigint().notNull(),
  block: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));
