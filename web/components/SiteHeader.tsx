import Link from "next/link";
import { NavLinks } from "./NavLinks";
import { WalletButton } from "./WalletButton";

export function SiteHeader() {
  return (
    <header className="night sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">Soft Landing</span>
        </Link>
        <NavLinks />
        <div className="ml-auto">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

/** A descending staircase: the glide, in one glyph. */
function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="text-safe">
      <path
        d="M2 4h5v4h4v4h4v4h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
