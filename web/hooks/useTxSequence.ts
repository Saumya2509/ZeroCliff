"use client";

import { useQueryClient } from "@tanstack/react-query";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useCallback, useState } from "react";
import type { Hash } from "viem";
import { toPlainMessage } from "@/lib/errors";
import { config } from "@/lib/wagmi";

// One place for all transaction UX: idle → confirm in wallet → pending (hash) → confirmed (block) → error.
// Multi-step flows (approve → deposit → borrow → ghost) run as a sequence with per-step status.
// Each step simulates before asking the wallet, so reverts are caught before the popup.

export type StepStatus = "idle" | "skipped" | "wallet" | "pending" | "done" | "error";

export type TxStep = {
  label: string;
  /** Return a hash, or undefined to skip (e.g. allowance already sufficient). */
  run: () => Promise<Hash | undefined>;
};

export type StepState = { label: string; status: StepStatus; hash?: Hash; block?: bigint };

export function useTxSequence() {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<StepState[]>([]);
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (seq: TxStep[]) => {
      setError(undefined);
      setRunning(true);
      const state: StepState[] = seq.map((s) => ({ label: s.label, status: "idle" }));
      const update = (i: number, patch: Partial<StepState>) => {
        state[i] = { ...state[i], ...patch };
        setSteps([...state]);
      };
      setSteps([...state]);
      try {
        for (let i = 0; i < seq.length; i++) {
          update(i, { status: "wallet" });
          const hash = await seq[i].run();
          if (!hash) {
            update(i, { status: "skipped" });
            continue;
          }
          update(i, { status: "pending", hash });
          const receipt = await waitForTransactionReceipt(config, { hash });
          if (receipt.status !== "success") throw new Error("Transaction reverted");
          update(i, { status: "done", block: receipt.blockNumber });
          await qc.invalidateQueries();
          if (i < seq.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        return true;
      } catch (e) {
        const i = state.findIndex((s) => s.status === "wallet" || s.status === "pending");
        if (i >= 0) update(i, { status: "error" });
        setError(toPlainMessage(e));
        return false;
      } finally {
        setRunning(false);
        await qc.invalidateQueries();
      }
    },
    [qc],
  );

  const reset = useCallback(() => {
    setSteps([]);
    setError(undefined);
  }, []);

  return { steps, error, running, run, reset };
}
