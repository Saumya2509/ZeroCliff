import { Check } from "lucide-react";
import Link from "next/link";
import results from "@/lib/results.json";

// Evidence as a results table: what was claimed, what was measured, how, and where to check it.
// Every figure comes from lib/results.json (scripts/collect-results.mjs, from the contract test output).

type Row = { claim: string; result: string; how: string; source: string };

export function ProofStrip() {
  const inv = results.invariants;
  const s = results.slippage;
  const a = results.attackA1;
  const v = results.vectors;
  const rows: Row[] = [
    results.tests && {
      claim: "Contracts behave as specified",
      result: `${results.tests.passed} passed, ${results.tests.failed} failed`,
      how: "Unit, fuzz, attack and crash-replay tests",
      source: "forge test",
    },
    inv && {
      claim: "Pool stays solvent; glide never overshoots",
      result: `${inv.rows.filter((r) => r.passed).length} of ${inv.rows.length} invariants hold`,
      how: `${inv.rows[0].calls.toLocaleString("en-US")} random calls each`,
      source: "test/invariant",
    },
    s && {
      claim: `Selling ${s.totalSoldMeth} mETH in slices costs less`,
      result: `${(s.glideSlippageBps / 100).toFixed(2)}% vs ${(s.cliffSlippageBps / 100).toFixed(2)}%`,
      how: `${s.slices} slices vs one dump, same pool`,
      source: "SlippageExperiment.t.sol",
    },
    a && {
      claim: "Pool manipulation can't force a cheap sale",
      result: `${a.guardedLossMusd} mUSD lost (${a.naiveLossMusd} unguarded)`,
      how: "Attack A1: push the AMM, then poke",
      source: "AttackScenarios.t.sol",
    },
    v && {
      claim: "Simulator matches the contracts",
      result: `${v.glide + v.engineTotal} of ${v.glide + v.engineTotal} vectors identical`,
      how: "Glide, AMM, router, cliff and poke outputs",
      source: "lib/sim/*.test.ts",
    },
  ].filter((x): x is Row => !!x);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-text text-xs text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Claim</th>
            <th scope="col" className="py-2 pr-4 font-medium">Measured</th>
            <th scope="col" className="py-2 pr-4 font-medium">How</th>
            <th scope="col" className="py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.claim} className="align-baseline">
              <th scope="row" className="py-3 pr-4 font-medium">{r.claim}</th>
              <td className="num py-3 pr-4 font-mono">
                <Check size={14} strokeWidth={2.5} className="mr-1.5 inline-block -translate-y-px text-safe" aria-hidden="true" />
                {r.result}
              </td>
              <td className="py-3 pr-4 text-muted">{r.how}</td>
              <td className="py-3 font-mono text-xs text-muted">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted">
        Raw outputs, gas and the static-analysis report are on{" "}
        <Link href="/transparency" className="text-text underline underline-offset-2">Transparency</Link>.
      </p>
    </div>
  );
}
