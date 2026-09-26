import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { glideRate, WAD } from "@/lib/sim/glide";

export const metadata: Metadata = { title: "How it works" };

// Glide curve drawn from the same glideRate() the contract uses (verified by parity tests).
function GlideCurve() {
  const W = 560;
  const H = 220;
  const pad = { l: 48, r: 16, t: 16, b: 36 };
  const hMin = 0.95;
  const hMax = 1.45;
  const rMax = 0.55; // % per block, axis top
  const x = (h: number) => pad.l + ((h - hMin) / (hMax - hMin)) * (W - pad.l - pad.r);
  const y = (r: number) => H - pad.b - (r / rMax) * (H - pad.t - pad.b);
  const pts: string[] = [];
  for (let h = 1.02; h <= 1.4001; h += 0.005) {
    const r = (Number(glideRate(BigInt(Math.round(h * 1e6)) * 10n ** 12n)) / Number(WAD)) * 100;
    pts.push(`${x(h).toFixed(1)},${y(r).toFixed(1)}`);
  }
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[560px]" role="img" aria-labelledby="curve-title curve-desc">
        <title id="curve-title">Glide rate by health</title>
        <desc id="curve-desc">
          Zero at health 1.25 and above, rising in a straight line to 0.5% of collateral per block at 1.02. Below 1.02 the backstop takes over.
        </desc>
        <rect x={x(hMin)} y={pad.t} width={x(1.02) - x(hMin)} height={H - pad.t - pad.b} fill="var(--cliff-fill)" opacity="0.12" />
        <rect x={x(1.02)} y={pad.t} width={x(1.25) - x(1.02)} height={H - pad.t - pad.b} fill="var(--glide-fill)" opacity="0.14" />
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((r) => (
          <g key={r}>
            <line x1={pad.l} x2={W - pad.r} y1={y(r)} y2={y(r)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(r) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{r.toFixed(1)}%</text>
          </g>
        ))}
        {[1.02, 1.1, 1.2, 1.25, 1.3, 1.4].map((h) => (
          <text key={h} x={x(h)} y={H - pad.b + 16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{h.toFixed(2)}</text>
        ))}
        <text x={(W + pad.l) / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="var(--text-muted)">Health</text>
        <polyline points={pts.join(" ")} fill="none" stroke="var(--safe)" strokeWidth="2.5" />
        <text x={x(1.035)} y={pad.t + 14} fontSize="11" fill="var(--cliff)">backstop</text>
        <text x={x(1.13)} y={pad.t + 14} fontSize="11" fill="var(--glide-text)">glide zone</text>
        <text x={x(1.3)} y={pad.t + 14} fontSize="11" fill="var(--safe)">safe: nothing sold</text>
      </svg>
      <figcaption className="mt-2 text-sm text-muted">
        Share of collateral sold per block. Zero at 1.25 and above; rises to 0.5% at 1.02. Below 1.02 the backstop takes over.
      </figcaption>
    </figure>
  );
}

const params = [
  ["LT", "Liquidation threshold", "0.85"],
  ["H", "Health = collateral × price × LT ÷ debt", "—"],
  ["H_open", "Minimum health to borrow or withdraw", "1.40"],
  ["H_comfort", "Glide starts below this", "1.25"],
  ["H_floor", "Backstop below this", "1.02"],
  ["r_max", "Most collateral sold in one block", "0.5%"],
  ["N_max", "Most blocks caught up in one poke", "100"],
  ["fee", "Protocol fee on each slice", "0.1%"],
  ["tip", "Flat reward to whoever pokes (no percentage bonus)", "0.5 mUSD"],
];

const threats = [
  ["Attacker pushes the AMM price down, then pokes to force a cheap sale", "Sale skipped unless AMM is within 2% of the oracle; minimum output set from the oracle", "Tested: victim loses 0"],
  ["Stale or fake price", "Pyth signatures, 60 s max age, confidence ≤ 1%", "Tested"],
  ["Withdraw to escape a pending glide", "Every action settles the glide first", "Tested"],
  ["Spam pokes for tips", "Flat tip, only when a poke did something", "Tested"],
  ["Reentrancy through a token", "Every entry point is non-reentrant", "Tested"],
  ["Price gap bigger than the glide can absorb", "Backstop restores health to 1.25; anything unrecoverable is recorded as bad debt", "Tested; known limit"],
  ["Sandwiching a slice", "Slices are tiny and priced from the oracle, so profit is capped", "Partly mitigated"],
  ["Keeper goes offline", "Anyone can poke; every user action glides; up to 100 blocks catch up at once", "Documented"],
  ["Owner swaps the oracle", "Two-step ownership; every change emits an event", "Known limit (timelock on roadmap)"],
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 pb-20 pt-10 sm:px-6">
      <PageHeader title="How the glide works" />
      <div className="max-w-[70ch]">
        <p className="text-muted">
          Most lending protocols work on a cliff. A loan is safe until, in one block, it crosses a threshold and a bot seizes a
          large chunk of collateral plus a 5–10% bonus. In a crash, bots race each other for that bonus, the forced sales push
          the price down further, and users lose far more than their actual shortfall.
        </p>
        <p className="mt-3 text-muted">
          Soft Landing removes the liquidation event. Below a comfort level it sells a small slice of collateral every block and
          repays debt with it. The slice grows as health falls. If the price recovers, the selling stops by itself.
        </p>
      </div>

      <Card title="The glide curve">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,560px)_1fr]">
          <GlideCurve />
          <dl className="space-y-4 text-sm">
            <Zone swatch="var(--safe-fill)" name="Above 1.25 · safe">Nothing is sold. The loan behaves like any other.</Zone>
            <Zone swatch="var(--glide-fill)" name="1.02 to 1.25 · glide">
              A slice sells every block, growing as health falls, and stops once health is back at 1.25.
            </Zone>
            <Zone swatch="var(--cliff-fill)" name="Below 1.02 · backstop">
              Only after a sudden gap: sells what restores 1.25 in one step. Anything unrecoverable is recorded as bad debt.
            </Zone>
          </dl>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="The maths" description="All values are 18-decimal fixed point in the contract.">
          <div className="space-y-4 text-sm">
            <Formula label="Glide rate below comfort">r(H) = r_max × (H_comfort − H) ÷ (H_comfort − H_floor)</Formula>
            <Formula label="Share sold after n blocks without a poke">share = 1 − (1 − r)ⁿ, with n capped at 100</Formula>
            <Formula label="Never sell more than needed to get back to 1.25">
              s_needed = (H_comfort × D − C × P × LT) ÷ (P × (H_comfort × (1 − fee) − LT))
            </Formula>
            <Formula label="Slice sold">slice = min(C × share, s_needed)</Formula>
            <p className="text-muted">
              The user only ever loses what is needed to get back to safety. A normal protocol takes a fixed 50% of the debt plus a
              bonus, whatever the shortfall.
            </p>
          </div>
        </Card>
        <Card title="Parameters">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {params.map(([sym, meaning, value]) => (
                <tr key={sym}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-mono text-xs font-normal">{sym}</th>
                  <td className="py-1.5 pr-3 text-muted">{meaning}</td>
                  <td className="num py-1.5 text-right font-medium">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="What each step needs from the chain">
        <ul className="grid gap-4 text-sm sm:grid-cols-3">
          <li><strong>Every block.</strong> <span className="text-muted">Anyone can call poke(); a keeper bot does it every block while a loan is below 1.25.</span></li>
          <li><strong>One atomic step.</strong> <span className="text-muted">The slice is sold through an AMM and the debt repaid in the same transaction.</span></li>
          <li><strong>Price guard.</strong> <span className="text-muted">A slice is only sold if the AMM agrees with the oracle within 2%, so a manipulated pool can’t be used against you.</span></li>
        </ul>
      </Card>

      <Card title="Threat model">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Threat</th>
                <th scope="col" className="py-2 pr-3 font-medium">What stops it</th>
                <th scope="col" className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {threats.map(([t, m, s]) => (
                <tr key={t}>
                  <td className="py-2 pr-3">{t}</td>
                  <td className="py-2 pr-3 text-muted">{m}</td>
                  <td className="py-2">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section id="limits" aria-labelledby="limits-h" className="scroll-mt-24">
        <Card title={<span id="limits-h">Known limits</span>}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Two big price gaps in back-to-back blocks can make the backstop cost about as much as a normal liquidation.</li>
            <li>The Landing Forecast ignores AMM slippage; real slices execute up to 1.5% below the oracle price.</li>
            <li>The owner can change the oracle and the sale router. Changes are public events; a timelock is on the roadmap.</li>
            <li>No interest and no lender withdrawals in this version.</li>
            <li>Mock tokens use 18 decimals; real USDC uses 6 and would be scaled at the token boundary.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Testnet only. Test tokens have no value. Not financial advice.</p>
        </Card>
      </section>
    </div>
  );
}

function Formula({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="mt-1 overflow-x-auto rounded-sm bg-sunken px-3 py-2 font-mono text-[13px]">{children}</p>
    </div>
  );
}

function Zone({ swatch, name, children }: { swatch: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: swatch }} aria-hidden="true" />
      <div>
        <dt className="font-medium">{name}</dt>
        <dd className="text-muted">{children}</dd>
      </div>
    </div>
  );
}
