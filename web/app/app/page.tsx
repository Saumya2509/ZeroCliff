import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "App" };

export default function AppPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
      <PageHeader title="Your loan">
        Open a position with a ghost twin in a normal protocol, then watch both through the next price move.
      </PageHeader>
      <Dashboard />
    </div>
  );
}
