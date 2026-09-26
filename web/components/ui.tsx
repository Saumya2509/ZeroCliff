import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";
import type { HealthState } from "@/lib/format";
import { healthLabel } from "@/lib/format";

// Small shared primitives on the semantic tokens. One primary action per screen.

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 cursor-pointer";
const variants: Record<Variant, string> = {
  primary: "bg-safe-fill text-on-safe hover:brightness-110",
  secondary: "border border-border bg-surface text-text hover:bg-sunken",
  quiet: "text-text hover:bg-sunken",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  as: As = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <As className={`rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </As>
  );
}

const stateStyles: Record<HealthState, string> = {
  safe: "border-safe text-safe",
  gliding: "border-glide text-glide",
  backstop: "border-cliff text-cliff",
  none: "border-border text-muted",
};

/** Status is always text + shape, never colour alone. */
export function StatusBadge({ state }: { state: HealthState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateStyles[state]}`}
    >
      <StateGlyph state={state} />
      {healthLabel[state]}
    </span>
  );
}

function StateGlyph({ state }: { state: HealthState }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  if (state === "safe") return <svg {...common}><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>;
  if (state === "gliding")
    return (
      <svg {...common}>
        <path d="M1 2l4 6 4-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  if (state === "backstop") return <svg {...common}><rect x="1" y="1" width="8" height="8" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-sunken ${className}`} />;
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn";
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${
        tone === "warn" ? "border-glide bg-glide-fill/10" : "border-border bg-sunken"
      }`}
    >
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-muted">{children}</div>}
    </div>
  );
}

/** Label + value row for stat lists. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="num text-right font-medium">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
