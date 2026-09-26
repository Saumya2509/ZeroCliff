"use client";

import type { StepState, StepStatus } from "@/hooks/useTxSequence";
import { explorerUrl } from "@/lib/wagmi";
import { shortAddress } from "@/lib/format";
import { Button } from "./ui";

const statusText: Record<StepStatus, string> = {
  idle: "Waiting",
  skipped: "Not needed",
  wallet: "Confirm in wallet",
  pending: "Pending",
  done: "Confirmed",
  error: "Failed",
};

/** Step list for multi-transaction flows. Announced politely to screen readers. */
export function TxProgress({
  steps,
  error,
  onRetry,
}: {
  steps: StepState[];
  error?: string;
  onRetry?: () => void;
}) {
  if (steps.length === 0 && !error) return null;
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      {steps.length > 0 && (
        <ol className="space-y-1.5 text-sm">
          {steps.map((s, i) => {
            const url = s.hash ? explorerUrl("tx", s.hash) : undefined;
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <StepIcon status={s.status} />
                <span className={s.status === "skipped" ? "text-muted line-through" : ""}>{s.label}</span>
                <span className="num text-muted">
                  {statusText[s.status]}
                  {s.status === "done" && s.block !== undefined && ` · block ${s.block.toLocaleString("en-US")}`}
                </span>
                {s.hash &&
                  (url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="num text-muted underline underline-offset-4 hover:text-text">
                      {shortAddress(s.hash)}
                    </a>
                  ) : (
                    <span className="num text-muted">{shortAddress(s.hash)}</span>
                  ))}
              </li>
            );
          })}
        </ol>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-sm border border-glide bg-glide-fill/10 px-3 py-2 text-sm">
          <span>{error}</span>
          {onRetry && (
            <Button variant="quiet" onClick={onRetry} className="min-h-9 px-2 underline underline-offset-4">
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const cls = "h-4 w-4 shrink-0";
  if (status === "done")
    return (
      <svg className={`${cls} text-safe`} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  if (status === "error")
    return (
      <svg className={`${cls} text-glide`} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  if (status === "wallet" || status === "pending")
    return (
      <svg className={`${cls} animate-spin text-text`} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2a6 6 0 1 1-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg className={`${cls} text-muted`} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
