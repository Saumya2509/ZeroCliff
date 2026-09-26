import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { CascadeLab } from "@/components/CascadeLab";
import { Experiments } from "@/components/Experiments";
import { crashMeta, experiments } from "@/lib/sim/data";

export const metadata: Metadata = { title: "Cascade Lab" };

const LIMITS = [
  "Borrowers are passive: nobody tops up or repays during the crash. Real users would, so both designs lose less in practice.",
  "One collateral type, one AMM per design, and a simplified arbitrageur that closes a fixed share of the gap each step with a capped budget.",
  "Gas costs are not included in user losses. They are reported separately on the Transparency page.",
  "β is a modelling assumption, not an estimate of any real market. That is why results are shown across a sweep.",
  "Historical data is 1-minute closes (5-minute for June 2022), not tick data. Within a candle the price is treated as flat.",
  "The keeper pokes every position every step, at most 100 blocks apart. A slower keeper would glide in bigger slices.",
];

export default function SimulatePage() {
  const crashes = crashMeta();
  const exp = experiments();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
      <PageHeader title="Cascade Lab: replay a real crash">
        Real ETH crashes, a population of borrowers (200 by default), two lending pools. One liquidates at the cliff, the other glides. Each sells into its
        own AMM, so you can watch liquidations push the price down further. Runs in your browser, no wallet needed.
      </PageHeader>

      {/* Parameters come from the URL, which is only known in the browser. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg border border-border bg-surface" />}>
        <CascadeLab crashes={crashes} />
      </Suspense>

      <section aria-labelledby="limits" className="mt-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
        <h2 id="limits" className="text-base font-semibold">Known limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>

      <section aria-labelledby="experiments" className="mt-14">
        <h2 id="experiments" className="display text-3xl sm:text-4xl">Experiments E1–E7</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Run with <code className="num text-sm">npm run sim</code> in <code className="num text-sm">sim/</code>, using the same engine as the
          lab above, default parameters unless noted. E4 and E6 are where Soft Landing could look worse. They are here anyway.
        </p>
        <div className="mt-6">
          {exp ? (
            <Experiments data={exp} />
          ) : (
            <p className="text-sm text-muted">No results yet. Run <code className="num">npm run sim</code> in <code className="num">sim/</code>.</p>
          )}
        </div>
      </section>
    </div>
  );
}
