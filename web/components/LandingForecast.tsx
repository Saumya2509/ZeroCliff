"use client";

import { useId, useMemo, useState } from "react";
import type { Address } from "viem";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useReadContract } from "wagmi";
import { isDeployed, pool } from "@/lib/contracts";
import { formatHealth, formatToken, wadToNumber } from "@/lib/format";
import { forecastLanding } from "@/lib/sim/forecast";
import { shockPrice } from "@/lib/sim/glide";

// Landing Forecast: what happens if the price drops now. With a position, the path comes from the
// contract's own previewGlide (the same maths that will execute it). Before one exists, the same maths
// runs locally in lib/sim with the form values, labelled as an estimate.

const BLOCKS = 120;
const PRESETS = [-10, -20, -30];
const BLOCK_SECONDS = 2;

export function LandingForecast({
  user,
  collateral,
  debt,
  price,
  hasPosition,
}: {
  user?: Address;
  collateral: bigint;
  debt: bigint;
  price?: bigint;
  hasPosition: boolean;
}) {
  const [shock, setShock] = useState(-20);
  const sliderId = useId();

  const onchain = useReadContract({
    ...pool,
    functionName: "previewGlide",
    args: [user!, BigInt(shock * 100), BigInt(BLOCKS)],
    query: { enabled: hasPosition && !!user && isDeployed },
  });

  const forecast = useMemo(() => {
    if (!price || collateral === 0n) return undefined;
    const p = shockPrice(price, shock * 100);
    const fromChain = hasPosition && onchain.data ? { healthPath: [...onchain.data[0]], collateralPath: [...onchain.data[1]] } : undefined;
    return forecastLanding(collateral, debt, p, BLOCKS, fromChain);
  }, [price, collateral, debt, shock, hasPosition, onchain.data]);

  const data = forecast
    ? forecast.path.collateralPath.map((c, i) => ({
        block: i + 1,
        soft: wadToNumber(c),
        cliff: wadToNumber(forecast.cliff.collateralAfter),
      }))
    : [];

  return (
    <div>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="mb-2 text-sm text-muted">Price shock</legend>
        <div className="flex gap-2" role="group" aria-label="Preset shocks">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShock(s)}
              aria-pressed={shock === s}
              className={`num min-h-11 min-w-16 cursor-pointer rounded-sm border px-3 text-sm transition-colors duration-150 ${
                shock === s ? "border-text bg-text text-bg" : "border-border bg-surface hover:bg-sunken"
              }`}
            >
              {s}%
            </button>
          ))}
        </div>
        <label htmlFor={sliderId} className="sr-only">
          Custom price shock in percent
        </label>
        <input
          id={sliderId}
          type="range"
          min={-50}
          max={0}
          step={1}
          value={shock}
          onChange={(e) => setShock(Number(e.target.value))}
          className="min-h-11 w-40 accent-[var(--safe)]"
          aria-valuetext={`${shock} percent`}
        />
        <span className="num w-12 text-sm font-medium">{shock}%</span>
      </fieldset>

      {!forecast ? (
        <p className="mt-4 text-sm text-muted">Enter an amount to deposit to see how your position would land.</p>
      ) : (
        <figure className="mt-4">
          <div className="h-48 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 12, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis
                  dataKey="block"
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  stroke="var(--border)"
                  minTickGap={32}
                  label={{ value: "Blocks from now", position: "insideBottomRight", offset: -2, fill: "var(--text-muted)", fontSize: 12 }}
                />
                <YAxis
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  stroke="var(--border)"
                  width={56}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <ReferenceLine y={wadToNumber(collateral)} stroke="var(--border)" strokeDasharray="2 3" />
                <Line type="monotone" dataKey="soft" stroke="var(--safe)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="cliff" stroke="var(--cliff)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="mt-3 space-y-1 text-sm">
            <p>
              If the price drops {Math.abs(shock)}%, you’d{" "}
              {forecast.kind === "safe" ? (
                <>
                  keep all <span className="num font-medium">{formatToken(collateral, "mETH")}</span>: health would be{" "}
                  <span className="num">{formatHealth(forecast.shockedHealth)}</span>, still above the 1.25 glide level.
                </>
              ) : forecast.kind === "glide" ? (
                <>
                  glide from <span className="num font-medium">{formatToken(collateral, "mETH")}</span> to{" "}
                  <span className="num font-medium">{formatToken(forecast.final, "mETH")}</span> over ~
                  <span className="num">{forecast.settleBlocks}</span> blocks (about{" "}
                  <span className="num">{Math.ceil((forecast.settleBlocks * BLOCK_SECONDS) / 60)}</span> min), ending at health{" "}
                  <span className="num">{formatHealth(forecast.path.healthPath[forecast.path.healthPath.length - 1])}</span>.
                </>
              ) : forecast.closeOut ? (
                <>
                  jump to health <span className="num">{formatHealth(forecast.shockedHealth)}</span>, too far to recover: the backstop
                  would sell all <span className="num font-medium">{formatToken(collateral, "mETH")}</span> to repay what it can, and
                  record the rest as bad debt.
                </>
              ) : (
                <>
                  jump to health <span className="num">{formatHealth(forecast.shockedHealth)}</span>, below the 1.02 floor. The backstop
                  would sell up to <span className="num font-medium">{formatToken(forecast.sold, "mETH")}</span> in one step to get back
                  to 1.25, with no bonus, leaving you at least{" "}
                  <span className="num font-medium">{formatToken(forecast.final, "mETH")}</span>.
                </>
              )}
            </p>
            <p className="text-muted">
              {forecast.cliff.liquidated ? (
                <>
                  A normal protocol would take <span className="num font-medium text-cliff">{formatToken(forecast.cliff.seized, "mETH")}</span> at
                  once (50% of the debt plus an 8% bonus).
                </>
              ) : (
                <>A normal protocol wouldn’t act yet; it waits until health falls below 1.00, then takes a large slice at once.</>
              )}
            </p>
            {(forecast.cost.soft > 0n || forecast.cost.cliff > 0n) && (
              <p>
                Cost of the unwind (value that doesn’t go toward your debt): Soft Landing{" "}
                <span className="num font-medium text-safe">
                  {forecast.kind === "backstop" ? "up to " : ""}
                  {formatToken(forecast.cost.soft, "mUSD")}
                </span>
                , normal protocol <span className="num font-medium text-cliff">{formatToken(forecast.cost.cliff, "mUSD")}</span>.
              </p>
            )}
            <p className="text-xs text-muted">
              {forecast.kind === "backstop"
                ? "Backstop sized for worst-case execution (5% below the oracle), so the real sale is usually smaller."
                : forecast.source === "contract"
                ? "Computed by the contract’s previewGlide, the same maths that will execute it. Ignores AMM slippage."
                : "Estimate until you open a position, using the same maths as the contract. Ignores AMM slippage."}
            </p>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
