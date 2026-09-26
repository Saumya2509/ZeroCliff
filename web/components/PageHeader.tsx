import type { ReactNode } from "react";

/** Page header: a plain title and an optional lede, ruled off from the content. */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 border-b border-border pb-6">
      <h1 className="display text-4xl sm:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-[65ch] text-muted">{children}</div>}
    </header>
  );
}
