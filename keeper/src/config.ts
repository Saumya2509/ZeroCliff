import { z } from "zod";

// z.coerce.boolean() turns the string "false" into true, so flags are parsed explicitly.
const flag = (dflt: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : v === "true" || v === "1"));

export const configSchema = z.object({
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  KEEPER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "a 32-byte hex key (burner only)"),
  DEPLOYMENTS_PATH: z.string().default("../contracts/deployments/active.json"),
  MODE: z.enum(["live", "offline"]),

  ENABLE_GLIDER: flag(true),
  ENABLE_ORACLE_PUSHER: flag(true), // only acts in live mode with a Pyth adapter
  ENABLE_GHOST_LIQUIDATOR: flag(true),
  ENABLE_ARBITRAGEUR: flag(true),

  BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(20), // SoftLandingPool.MAX_BATCH
  // Arbitrage uses the Cascade Lab defaults (sim/README.md): close α of the gap, spend ≤ 2% of the mUSD reserve.
  ARB_EVERY_BLOCKS: z.coerce.number().int().min(1).default(3),
  ARB_ALPHA_BPS: z.coerce.number().int().min(1).max(10_000).default(3_000),
  ARB_BUDGET_BPS: z.coerce.number().int().min(1).max(10_000).default(200),
  ARB_THRESHOLD_BPS: z.coerce.number().int().min(0).default(30),

  // Since the Pyth Core upgrade (26 Aug 2026) Hermes serves price updates only with an API key (Pyth Terminal).
  HERMES_URL: z.url().default("https://pyth.dourolabs.app/hermes"),
  PYTH_API_KEY: z.string().optional(),
  ORACLE_PUSH_EVERY_S: z.coerce.number().int().min(1).default(30),

  LOG_RANGE: z.coerce.number().int().min(100).default(5_000), // getLogs block range for the registry backfill
  POLL_MS: z.coerce.number().int().min(100).default(1_000),
  HEALTH_PORT: z.coerce.number().int().min(0).default(8081), // 0 = no HTTP server
  LOW_GAS_ETH: z.string().default("0.01"),
  SUMMARY_EVERY_S: z.coerce.number().int().min(1).default(60),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = configSchema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid keeper config:\n${lines.join("\n")}`);
  }
  return r.data;
}
