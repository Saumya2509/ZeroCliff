import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="night border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Testnet only. Test tokens have no value. Not financial advice.</p>
        <p>
          Hack in Hills ’26 · Track 3 ·{" "}
          <Link href="/how-it-works#limits" className="underline underline-offset-4 hover:text-text">
            Known limits
          </Link>
        </p>
      </div>
    </footer>
  );
}
