import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AdminPanel } from "@/components/AdminPanel";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6">
      <PageHeader title="Demo controls" />
      <AdminPanel />
    </div>
  );
}
