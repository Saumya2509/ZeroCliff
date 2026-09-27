import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

const base = {
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  KEEPER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  MODE: "offline",
};

describe("config", () => {
  it("applies defaults, including the Cascade Lab arbitrage settings", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ CHAIN_ID: 31337, BATCH_SIZE: 20, ARB_ALPHA_BPS: 3_000, ARB_BUDGET_BPS: 200, ENABLE_GLIDER: true });
  });

  it("points at the authenticated Hermes and takes an optional API key", () => {
    expect(loadConfig(base).HERMES_URL).toBe("https://pyth.dourolabs.app/hermes");
    expect(loadConfig(base).PYTH_API_KEY).toBeUndefined();
    expect(loadConfig({ ...base, PYTH_API_KEY: "k" }).PYTH_API_KEY).toBe("k");
  });

  it('parses "false" as false (z.coerce.boolean would not)', () => {
    const c = loadConfig({ ...base, ENABLE_GHOST_LIQUIDATOR: "false", ENABLE_ARBITRAGEUR: "0", ENABLE_ORACLE_PUSHER: "true" });
    expect(c.ENABLE_GHOST_LIQUIDATOR).toBe(false);
    expect(c.ENABLE_ARBITRAGEUR).toBe(false);
    expect(c.ENABLE_ORACLE_PUSHER).toBe(true);
  });

  it("refuses a batch above the contract limit and a malformed key", () => {
    expect(() => loadConfig({ ...base, BATCH_SIZE: "21" })).toThrow(/BATCH_SIZE/);
    expect(() => loadConfig({ ...base, KEEPER_PRIVATE_KEY: "0x12" })).toThrow(/KEEPER_PRIVATE_KEY/);
    expect(() => loadConfig({ ...base, MODE: "mainnet" })).toThrow(/MODE/);
  });
});
