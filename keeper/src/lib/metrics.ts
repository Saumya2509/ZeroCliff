// Counters for the once-a-minute summary log.

export const COUNTERS = [
  "blocksSeen",
  "blocksSkipped",
  "pokesSent",
  "usersPoked",
  "pokeFailures",
  "glideSkipsSeen",
  "liquidations",
  "liquidationFailures",
  "collateralDumps",
  "arbSwaps",
  "arbFailures",
  "oraclePushes",
  "oraclePushFailures",
  "txReverted",
] as const;
export type Counter = (typeof COUNTERS)[number];

export class Metrics {
  private c = Object.fromEntries(COUNTERS.map((k) => [k, 0])) as Record<Counter, number>;
  inc(k: Counter, by = 1) {
    this.c[k] += by;
  }
  get(k: Counter) {
    return this.c[k];
  }
  snapshot() {
    return { ...this.c };
  }
}
