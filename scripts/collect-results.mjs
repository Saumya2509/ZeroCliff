// Collects test, attack, invariant, gas and slippage results from contracts/results into web/lib/results.json,
// so every number on /transparency comes from a script. Run after the contract test commands in
// contracts/README.md (test-output.txt must be produced with -vv).
// Usage: node scripts/collect-results.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = join(root, "contracts", "results");
const read = (f) => (existsSync(join(results, f)) ? readFileSync(join(results, f), "utf8") : undefined);
const json = (f) => (read(f) ? JSON.parse(read(f)) : undefined);

// forge output: "Ran N test suites ...: X tests passed, Y failed"
function tests(text) {
  const m = text?.match(/(\d+) tests passed, (\d+) failed/);
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : undefined;
}

// invariant lines: "[PASS] invariant_I1_solvency() (runs: 256, calls: 25600, reverts: 0)"
function invariants(text) {
  if (!text) return undefined;
  const rows = [...text.matchAll(/\[(PASS|FAIL)[^\]]*\] (invariant_\w+)\(\) \(runs: (\d+), calls: (\d+)/g)].map((m) => ({
    name: m[2],
    passed: m[1] === "PASS",
    runs: Number(m[3]),
    calls: Number(m[4]),
  }));
  return rows.length ? rows : undefined;
}

const long = invariants(read("invariants-long-output.txt"));
const std = invariants(read("invariants-output.txt"));
const inv = long && long.length === 7 ? long : std;
const depth = inv === long ? Number(process.env.LONG_DEPTH ?? 200) : 100;

// A1 before/after, printed by AttackScenarios with -vv
function attackA1(text) {
  const naive = text?.match(/A1 victim loss, naive router \(mUSD\)\s+(\d+)/);
  const guarded = text?.match(/A1 victim loss, slice router \(mUSD\)\s+(\d+)/);
  return naive && guarded ? { naiveLossMusd: Number(naive[1]), guardedLossMusd: Number(guarded[1]) } : undefined;
}

const slip = json("slippage.json");

// Parity vectors exported from the real contracts; web/lib/sim/{glide,engine}.test.ts assert every one matches.
const vectorDir = join(root, "contracts", "vectors");
const vectors = existsSync(vectorDir)
  ? (() => {
      const glide = readdirSync(vectorDir).filter((f) => /^glide_\d+\.json$/.test(f)).length;
      const e = existsSync(join(vectorDir, "engine.json")) ? JSON.parse(readFileSync(join(vectorDir, "engine.json"), "utf8")) : {};
      const engine = Object.fromEntries(["amm", "router", "cliff", "poke"].map((k) => [k, e[k]?.length ?? 0]));
      return { glide, engine, engineTotal: Object.values(engine).reduce((a, b) => a + b, 0) };
    })()
  : undefined;
const out = {
  generatedAt: new Date().toISOString(),
  tests: tests(read("test-output.txt")),
  invariants: inv ? { depth, rows: inv } : undefined,
  gas: json("gas.json"),
  attackA1: attackA1(read("test-output.txt")),
  vectors,
  slippage: slip && {
    totalSoldMeth: Number(BigInt(slip.totalSoldMeth) / 10n ** 18n),
    slices: slip.slices,
    cliffSlippageBps: slip.cliffSlippageBps,
    glideSlippageBps: slip.glideSlippageBps,
    cliffPriceImpactBps: slip.cliffPriceImpactBps,
    glidePriceImpactBps: slip.glidePriceImpactBps,
  },
  slither: (() => {
    const m = read("slither.txt")?.match(/(\d+) contracts with (\d+) detectors\), (\d+) result/);
    return m ? { detectors: Number(m[2]), results: Number(m[3]) } : undefined;
  })(),
};

writeFileSync(join(root, "web", "lib", "results.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote web/lib/results.json");
console.log(JSON.stringify({ tests: out.tests, invariants: out.invariants?.rows.length, depth: out.invariants?.depth }, null, 0));
