"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const m = window.matchMedia(query);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** true = reduce motion. Undefined on the server so callers can hold motion until the client knows. */
export function useReducedMotion(): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => undefined,
  );
}
