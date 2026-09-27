"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import { health, WAD } from "@/lib/sim/glide";
import { CANONICAL, canonicalRun } from "@/lib/sim/replay";
import { FlightDirector } from "./FlightDirector";
import { GhostChart } from "./GhostChart";
import { HealthAltimeter } from "./HealthAltimeter";
import { LandingForecast } from "./LandingForecast";
import { PositionCard } from "./PositionCard";
import { Button, Card } from "./ui";

// Preview of the /app dashboard before the contracts are deployed. The same components as the live
// dashboard, fed by the contract-verified replay engine instead of the chain. Clearly labelled.

const START_BLOCK = 1_000_000;
const STEP_MS = 160;

export function DemoDashboard() {
  const run = useMemo(() => canonicalRun(), []);
  const last = run.points.length - 1;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const sliderId = useId();

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setI((x) => {
        if (x >= last) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer.current);
  }, [playing, last]);

  const play = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(last);
      return;
    }
    if (i >= last) setI(0);
    setPlaying(true);
  };

  const pt = run.points[i];
  const { price, softC, softD, cliffC, cliffD } = pt.raw;
  const soft = { collateral: softC, debt: softD, health: health(softC, softD, price) };
  const ghost = { collateral: cliffC, debt: cliffD, health: health(cliffC, cliffD, price) };
  const history = [
    { block: START_BLOCK, soft: 10n * WAD, ghost: 10n * WAD },
    ...run.points.slice(0, i + 1).map((p) => ({ block: START_BLOCK + p.block, soft: p.raw.softC, ghost: p.raw.cliffC })),
  ];
  const minute = Math.round((pt.block * 2) / 60);
  // the Flight Director measures volatility from the demo price path up to the current moment
  const prices = run.points.slice(0, i + 1).map((p) => p.price);
  const priceHistory = prices.length >= 12 ? { prices, intervalS: CANONICAL.blocksPerStep * 2, source: "demo price path so far" } : undefined;

  return (
    <div className="space-y-4">
      <Card
        title="Preview with simulated data"
        description="The real dashboard, driven by the verified replay engine instead of the chain: 10 mETH with 20,000 mUSD borrowed, through a stylised −45% crash. Nothing here is onchain."
      >
        <div className="flex flex-wrap items-center gap-3">
          {playing ? (
            <Button onClick={() => setPlaying(false)}>
              <Pause size={16} aria-hidden="true" /> Pause
            </Button>
          ) : (
            <Button variant="primary" onClick={play}>
              {i >= last ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {i >= last ? "Replay" : i === 0 ? "Play the crash" : "Resume"}
            </Button>
          )}
          <label htmlFor={sliderId} className="sr-only">
            Time in the crash
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={last}
            value={i}
            onChange={(e) => {
              setPlaying(false);
              setI(Number(e.target.value));
            }}
            aria-valuetext={`Minute ${minute}, price ${formatPrice(price)}`}
            className="min-h-11 min-w-0 flex-1 accent-[var(--safe)]"
          />
          <p className="num w-full text-sm text-muted sm:w-auto" aria-live="off">
            Minute {minute} · ETH {formatPrice(price)}
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your position">
          <PositionCard soft={soft} ghost={ghost} price={price} />
        </Card>
        <Card title="Health altimeter">
          <HealthAltimeter health={soft.health} />
        </Card>
      </div>

      <Card title="You vs a normal protocol" description="Solid: Soft Landing collateral. Dashed: the same loan in a classic cliff pool.">
        <GhostChart points={history} />
      </Card>

      <Card title="Landing forecast" description="What would happen from this moment if the price dropped further.">
        <LandingForecast collateral={softC} debt={softD} price={price} hasPosition={false} />
      </Card>

      <Card title="Flight Director" description="Ask about this demo loan in plain words. Runs in your browser: no network calls, no language model.">
        <FlightDirector collateral={softC} debt={softD} price={price} history={priceHistory} />
      </Card>
    </div>
  );
}
