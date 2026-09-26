import { formatHealth, formatPercent, healthLabel, healthState, wadToNumber } from "@/lib/format";
import { glideRate, MAX_UINT } from "@/lib/sim/glide";

// Vertical gauge styled like an altimeter. The scale is stretched so the glide zone
// (1.02–1.25) gets ~40% of the height: that's where everything interesting happens.

const MIN = 0.9;
const MAX = 2.0;
const KNOTS: [number, number][] = [
  [0.9, 0],
  [1.02, 0.12],
  [1.25, 0.55],
  [1.4, 0.72],
  [2.0, 1],
];

/** Health → 0..1 height fraction (piecewise linear through the knots). */
export function scaleHealth(h: number): number {
  const x = Math.min(MAX, Math.max(MIN, h));
  for (let i = 1; i < KNOTS.length; i++) {
    const [x0, y0] = KNOTS[i - 1];
    const [x1, y1] = KNOTS[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

const H = 260;
const TOP = 12;
const BOTTOM = 12;
const TRACK_X = 18;
const TRACK_W = 16;
const yOf = (h: number) => TOP + (1 - scaleHealth(h)) * (H - TOP - BOTTOM);

const levels = [
  { h: 1.4, label: "1.40", note: "open limit" },
  { h: 1.25, label: "1.25", note: "glide starts" },
  { h: 1.02, label: "1.02", note: "backstop" },
];

export function HealthAltimeter({ health }: { health: bigint }) {
  const state = healthState(health);
  const noDebt = health >= MAX_UINT / 2n;
  const h = noDebt ? MAX : wadToNumber(health);
  const shown = noDebt ? "No debt" : formatHealth(health);
  const rate = noDebt ? 0n : glideRate(health);
  const markerY = yOf(h);
  const valueText = noDebt ? "No debt" : `Health ${shown}, ${healthLabel[state].toLowerCase()}`;

  return (
    <div
      role="meter"
      aria-label="Position health"
      aria-valuenow={Number(Math.min(MAX, Math.max(MIN, h)).toFixed(2))}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuetext={valueText}
      className="night flex flex-wrap items-stretch gap-x-6 gap-y-3 rounded-lg border border-border p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),inset_0_0_0_1px_rgb(0_0_0/0.3)]"
    >
      <svg viewBox={`0 0 200 ${H}`} className="h-[260px] w-[200px] shrink-0" aria-hidden="true">
        {/* zones */}
        <rect x={TRACK_X} y={yOf(MAX)} width={TRACK_W} height={yOf(1.25) - yOf(MAX)} rx="3" fill="var(--safe-fill)" opacity="0.28" />
        <rect x={TRACK_X} y={yOf(1.25)} width={TRACK_W} height={yOf(1.02) - yOf(1.25)} fill="var(--glide-fill)" opacity="0.55" />
        <rect x={TRACK_X} y={yOf(1.02)} width={TRACK_W} height={yOf(MIN) - yOf(1.02)} rx="3" fill="var(--cliff-fill)" opacity="0.4" />
        {/* minor ticks */}
        {[0.95, 1.1, 1.15, 1.2, 1.3, 1.35, 1.5, 1.6, 1.7, 1.8, 1.9].map((t) => (
          <line key={t} x1={TRACK_X + TRACK_W} x2={TRACK_X + TRACK_W + 5} y1={yOf(t)} y2={yOf(t)} stroke="var(--text-muted)" strokeWidth="1" />
        ))}
        {/* marked levels */}
        {levels.map((l) => (
          <g key={l.h}>
            <line x1={TRACK_X - 4} x2={TRACK_X + TRACK_W + 10} y1={yOf(l.h)} y2={yOf(l.h)} stroke="var(--text)" strokeWidth="1.5" />
            <text x={TRACK_X + TRACK_W + 14} y={yOf(l.h) + 4} fontSize="12" fill="var(--text)" className="num">
              {l.label}
              <tspan fill="var(--text-muted)"> {l.note}</tspan>
            </text>
          </g>
        ))}
        {/* marker */}
        <g style={{ transform: `translateY(${markerY}px)`, transition: "transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          <path d={`M${TRACK_X - 12} -7 L${TRACK_X - 2} 0 L${TRACK_X - 12} 7 Z`} fill="var(--text)" />
          <line x1={TRACK_X - 2} x2={TRACK_X + TRACK_W + 2} y1="0" y2="0" stroke="var(--text)" strokeWidth="2.5" />
        </g>
      </svg>

      <div className="flex min-w-0 flex-col justify-center gap-1">
        <p className="eyebrow">Health</p>
        <p className="num font-mono text-5xl font-medium leading-none">{shown}</p>
        <p
          className={`text-sm font-medium ${
            state === "safe" ? "text-safe" : state === "gliding" ? "text-glide" : state === "backstop" ? "text-cliff" : "text-muted"
          }`}
        >
          {healthLabel[state]}
        </p>
        {state === "gliding" && (
          <p className="num flex items-center gap-1 text-sm text-glide">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 3l4 4 4-4M2 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {formatPercent(rate)} per block
          </p>
        )}
        {state === "backstop" && <p className="text-sm text-muted">Selling enough to get back to 1.25</p>}
      </div>
    </div>
  );
}
