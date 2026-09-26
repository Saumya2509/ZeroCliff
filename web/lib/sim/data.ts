// Server-side loaders for /simulate: crash metadata from public/crashes and experiment results from
// public/results (written by `npm run sim` in sim/). Only compact summaries are passed to the client.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Crash } from "./run";

const pub = join(process.cwd(), "public");
const readJson = <T>(...p: string[]): T | undefined => {
  const f = join(pub, ...p);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined;
};

export const CRASH_IDS = ["mar-2020", "may-2021", "jun-2022", "aug-2024", "whipsaw"] as const;
export type CrashId = (typeof CRASH_IDS)[number];

export type CrashMeta = { id: CrashId; label: string; source: string; interval_seconds: number; steps: number; lowPct: number };

export function crashMeta(): CrashMeta[] {
  return CRASH_IDS.flatMap((id) => {
    const c = readJson<Crash>("crashes", `${id}.json`);
    if (!c) return [];
    const low = Math.min(...c.prices);
    return [{ id, label: c.label, source: c.source, interval_seconds: c.interval_seconds, steps: c.prices.length, lowPct: ((c.prices[0] - low) / c.prices[0]) * 100 }];
  });
}

type Brief = {
  valueKeptPerUser: number;
  valueKeptPct: number;
  collateralLostPerUserEth: number;
  collateralLostPerUserUsd: number;
  cascadeDepthPct: number;
  slippageUsd: number;
  events: number;
  backstops: number;
  skips: number;
  badDebtUsd: number;
  wiped: number;
};
type Row = { crash: string; label: string; marketLowPct: number; soft: Brief; cliff: Brief };
type Series = { t: number; market: number; oracleSoft: number; oracleCliff: number; softEquity: number; cliffEquity: number }[];
type File<T> = { id: string; title: string; question: string; generatedAt: string; data: T };

export type ExperimentData = {
  generatedAt: string;
  e1: File<Row[]>;
  e2: File<Row[]>;
  e3: File<{ crash: string; points: (Row & { beta: number })[] }[]>;
  e4: File<{ crash: string; points: (Row & { liquidity: number })[] }[]>;
  e5: File<{ crash: string; points: (Row & { rMaxPct: number })[] }[]>;
  e6: File<(Row & { beta: number; series: Series })[]>;
  e7: File<{
    oraclePrice: number;
    poolDepthMeth: number;
    totalSoldMeth: number;
    slices: number;
    cliff: { avgPrice: number; slippageBps: number; finalPrice: number };
    glide: { avgPrice: number; slippageBps: number; finalPrice: number };
  }>;
};

/** Drop the bulky per-run fields the page does not use. */
const strip = (r: object) => {
  const { series: _s, params: _p, runtimeMs: _r, ...rest } = r as Record<string, unknown>;
  void [_s, _p, _r];
  return rest;
};

/** All seven experiment files, or undefined if `npm run sim` has not been run. Series are dropped except E6's. */
export function experiments(): ExperimentData | undefined {
  const ids = ["e1", "e2", "e3", "e4", "e5", "e6", "e7"] as const;
  const files = Object.fromEntries(ids.map((id) => [id, readJson<File<unknown>>("results", `${id}.json`)]));
  if (ids.some((id) => !files[id])) return undefined;
  const f = files as unknown as ExperimentData;
  const sweep = (x: { crash: string; points: Row[] }[]) => x.map((c) => ({ ...c, points: c.points.map(strip) }));
  return {
    generatedAt: f.e1.generatedAt,
    e1: { ...f.e1, data: f.e1.data.map(strip) as unknown as Row[] },
    e2: { ...f.e2, data: f.e2.data.map(strip) as unknown as Row[] },
    e3: { ...f.e3, data: sweep(f.e3.data) as unknown as ExperimentData["e3"]["data"] },
    e4: { ...f.e4, data: sweep(f.e4.data) as unknown as ExperimentData["e4"]["data"] },
    e5: { ...f.e5, data: sweep(f.e5.data) as unknown as ExperimentData["e5"]["data"] },
    e6: {
      ...f.e6,
      data: f.e6.data.map((r) => ({
        ...(strip(r) as unknown as Row & { beta: number }),
        series: r.series.map(({ t, market, oracleSoft, oracleCliff, softEquity, cliffEquity }) => ({ t, market, oracleSoft, oracleCliff, softEquity, cliffEquity })),
      })),
    },
    e7: f.e7,
  };
}

export type HeroRun = {
  crash: string;
  label: string;
  source: string;
  beta: number;
  users: number;
  marketLowPct: number;
  soft: Brief;
  cliff: Brief;
  series: { t: number; market: number; softEquity: number; cliffEquity: number }[];
  intervalSeconds: number;
};

/** The real-crash run shown on the home page: E2 (β = 0.3) on the 19 May 2021 crash. */
export function heroRun(crash = "may-2021"): HeroRun | undefined {
  const e2 = readJson<File<(Row & { params: { beta: number; users: number }; series: (Series[number] & { t: number })[] })[]>>("results", "e2.json");
  const meta = readJson<Crash>("crashes", `${crash}.json`);
  const r = e2?.data.find((x) => x.crash === crash);
  if (!r || !meta) return undefined;
  return {
    crash,
    label: r.label,
    source: meta.source,
    beta: r.params.beta,
    users: r.params.users,
    marketLowPct: r.marketLowPct,
    soft: r.soft,
    cliff: r.cliff,
    series: r.series.map(({ t, market, softEquity, cliffEquity }) => ({ t, market, softEquity, cliffEquity })),
    intervalSeconds: meta.interval_seconds,
  };
}
