// Web Worker for /simulate: runs the Cascade Lab engine off the main thread so the page stays smooth.
// Protocol: { crash, params } in → { type: "progress", done } … then { type: "result", result } out.

import { simulate, type Crash, type SimParams, type SimResult } from "./run";

export type WorkerRequest = { id: number; crash: Crash; params: Partial<SimParams> };
export type WorkerResponse =
  | { id: number; type: "progress"; done: number }
  | { id: number; type: "result"; result: SimResult }
  | { id: number; type: "error"; message: string };

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, crash, params } = e.data;
  try {
    let last = 0;
    const result = simulate(crash, params, (s, steps) => {
      const done = (s.t + 1) / steps;
      if (done - last >= 0.02) {
        last = done;
        post({ id, type: "progress", done });
      }
    });
    post({ id, type: "result", result });
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
