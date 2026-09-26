import { db } from "ponder:api";
import schema, { action, glide, liquidation, poolStats, position, priceTick } from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { desc, eq, graphql, isNotNull, replaceBigInts } from "ponder";
import { getAddress, isAddress } from "viem";
import { loadSeeded } from "../../deployments";
import { formatWad, lossesAvoided } from "../lib/lossesAvoided";

const app = new Hono();
app.use("/*", cors());
app.use("/graphql", graphql({ db, schema }));

const json = <T>(x: T) => replaceBigInts(x, (v) => v.toString());

/** Latest block the indexer has written anything for: every number is reported "as of" this. */
async function asOfBlock() {
  const [tick] = await db.select({ block: priceTick.block }).from(priceTick).orderBy(desc(priceTick.block)).limit(1);
  const stats = await db.select({ block: poolStats.updatedAt }).from(poolStats);
  return [tick?.block ?? 0n, ...stats.map((s) => s.block)].reduce((a, b) => (b > a ? b : a), 0n);
}

app.get("/stats/losses-avoided", async (c) => {
  const [tick] = await db.select().from(priceTick).where(isNotNull(priceTick.oracle)).orderBy(desc(priceTick.block)).limit(1);
  if (!tick?.oracle) return c.json({ error: "no oracle price indexed yet" }, 503);
  const rows = await db.select().from(position);
  const r = lossesAvoided(
    rows.filter((p) => p.pool === "soft"),
    rows.filter((p) => p.pool === "cliff"),
    tick.oracle,
    loadSeeded(),
  );
  return c.json(
    json({
      totalMeth: formatWad(r.totalWei),
      totalWei: r.totalWei,
      pairedUsers: r.pairedUsers,
      usersBetter: r.usersBetter,
      usersWorse: r.usersWorse,
      usersEqual: r.usersEqual,
      seededUsers: r.seededUsers,
      price: tick.oracle,
      priceBlock: tick.block,
      asOfBlock: await asOfBlock(),
      definition: "Σ over users with both positions of (soft net equity − cliff ghost net equity) in mETH at the oracle price; signed.",
    }),
  );
});

app.get("/stats/pool", async (c) => {
  const rows = await db.select().from(poolStats);
  return c.json(json({ pools: rows, asOfBlock: await asOfBlock() }));
});

app.get("/activity/:user", async (c) => {
  const raw = c.req.param("user");
  if (!isAddress(raw)) return c.json({ error: "not an address" }, 400);
  const user = getAddress(raw);
  const limit = Math.min(1_000, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
  const [actions, glides, liqs, positions] = await Promise.all([
    db.select().from(action).where(eq(action.user, user)).orderBy(desc(action.block)).limit(limit),
    db.select().from(glide).where(eq(glide.user, user)).orderBy(desc(glide.block)).limit(limit),
    db.select().from(liquidation).where(eq(liquidation.user, user)).orderBy(desc(liquidation.block)).limit(limit),
    db.select().from(position).where(eq(position.user, user)),
  ]);
  const items = [
    ...actions.map((a) => ({ type: a.kind, ...a })),
    ...glides.map((g) => ({ type: g.kind, pool: "soft", ...g })),
    ...liqs.map((l) => ({ type: "liquidation", pool: "cliff", ...l })),
  ]
    .sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    .slice(0, limit);
  return c.json(json({ user, positions, items, asOfBlock: await asOfBlock() }));
});

export default app;
