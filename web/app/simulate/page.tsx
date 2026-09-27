import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { SimulateView } from "@/components/SimulateView";
import { crashMeta, experiments } from "@/lib/sim/data";

export const metadata: Metadata = { title: "Cascade Lab" };

export default function SimulatePage() {
  const crashes = crashMeta();
  const exp = experiments();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
      <PageHeader title="Cascade Lab: replay a real crash">
        Real ETH crashes, a population of borrowers (200 by default), two lending pools. One liquidates at the cliff, the other glides. Each sells into its
        own AMM, so you can watch liquidations push the price down further.
      </PageHeader>

      <SimulateView crashes={crashes} experimentsData={exp} />
    </div>
  );
}
