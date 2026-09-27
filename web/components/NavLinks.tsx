"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { isDeployed, mockOracle } from "@/lib/contracts";
import { ShieldCheck } from "lucide-react";

type NavItem = { href: string; label: string; isAdmin?: boolean };

const links: NavItem[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/simulate", label: "Simulate" },
  { href: "/transparency", label: "Transparency" },
  { href: "/app", label: "Launch app" },
];

export function NavLinks() {
  const pathname = usePathname();
  const { address } = useAccount();
  const { data: owner } = useReadContract({
    ...mockOracle,
    functionName: "owner",
    query: { enabled: isDeployed },
  });

  const isAdmin = !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase();

  const activeLinks = isAdmin
    ? [
        ...links.slice(0, 3),
        { href: "/admin", label: "Admin", isAdmin: true },
        ...links.slice(3),
      ]
    : links;

  return (
    <nav aria-label="Main" className="order-last w-full sm:order-none sm:w-auto">
      <ul className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
        {activeLinks.map(({ href, label, isAdmin: isLinkAdmin }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 transition-colors duration-150 hover:bg-sunken ${
                  active ? "font-medium text-text underline decoration-safe decoration-2 underline-offset-8" : "text-muted"
                } ${isLinkAdmin ? "text-safe/90 font-medium" : ""}`}
              >
                {isLinkAdmin && <ShieldCheck className="h-3.5 w-3.5 text-safe" />}
                {label}
                {isLinkAdmin && (
                  <span className="ml-0.5 rounded bg-safe/15 border border-safe/30 px-1 py-0.2 text-[9px] font-mono text-safe">
                    Owner
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
