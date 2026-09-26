"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/simulate", label: "Simulate" },
  { href: "/transparency", label: "Transparency" },
  { href: "/app", label: "Launch app" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="order-last w-full sm:order-none sm:w-auto">
      <ul className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
        {links.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-sm px-3 transition-colors duration-150 hover:bg-sunken ${
                  active ? "font-medium text-text underline decoration-safe decoration-2 underline-offset-8" : "text-muted"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
