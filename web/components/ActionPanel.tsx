"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Address } from "viem";
import { useBalances, type Position } from "@/hooks/usePosition";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { thresholds } from "@/lib/ai/flightDirector";
import { cliff, mETH, mUSD, pool } from "@/lib/contracts";
import { formatHealth, formatPrice, formatToken, healthState, parseAmount } from "@/lib/format";
import { H_OPEN, health, LT, WAD } from "@/lib/sim/glide";
import { approveIfNeeded, send } from "@/lib/tx";
import { TxProgress } from "./TxProgress";
import { Button, StatusBadge } from "./ui";

type Tab = "deposit" | "borrow" | "repay" | "withdraw";
const TABS: { id: Tab; label: string; hint: string; cta: string }[] = [
  { id: "deposit", label: "Deposit", hint: "Add mETH collateral. Raises health.", cta: "Deposit" },
  { id: "borrow", label: "Borrow", hint: "Borrow more mUSD. Health must stay at or above 1.40.", cta: "Borrow" },
  { id: "repay", label: "Repay", hint: "Pay back mUSD. Raises health.", cta: "Repay" },
  { id: "withdraw", label: "Withdraw", hint: "Take mETH back. Health must stay at or above 1.40.", cta: "Withdraw" },
];

/** Opening health the suggestion aims for: comfortably above the 1.40 limit. */
const SUGGESTED_HEALTH = 1_600_000_000_000_000_000n;

/** Max debt that keeps health ≥ H_OPEN, minus existing debt. */
function maxBorrow(c: bigint, d: bigint, price: bigint) {
  const cap = (((c * price) / WAD) * LT) / H_OPEN;
  return cap > d ? cap - d : 0n;
}

export function ActionPanel({
  user,
  soft,
  hasPosition,
  hasGhost,
  price,
  onDraftChange,
}: {
  user: Address;
  soft?: Position;
  hasPosition: boolean;
  hasGhost: boolean;
  price?: bigint;
  onDraftChange: (draft: { collateral: bigint; debt: bigint }) => void;
}) {
  if (!hasPosition) return <OpenPositionForm user={user} price={price} onDraftChange={onDraftChange} />;
  return <ManageTabs user={user} soft={soft!} hasGhost={hasGhost} price={price} />;
}

// ---------- first-time flow ----------

/** A comfortable starting loan for this wallet: up to 1 mETH (per pool), borrowing to health 1.60. */
function suggestion(meth: bigint, price: bigint, withGhost: boolean) {
  const perPool = withGhost ? meth / 2n : meth;
  let c = perPool > 0n && perPool < WAD ? perPool : WAD;
  c -= c % 10n ** 14n; // 4 decimals
  const raw = (((c * price) / WAD) * LT) / SUGGESTED_HEALTH;
  const d = raw - (raw % (10n * WAD)); // whole tens of mUSD
  return { c, d };
}

function OpenPositionForm({
  user,
  price,
  onDraftChange,
}: {
  user: Address;
  price?: bigint;
  onDraftChange: (draft: { collateral: bigint; debt: bigint }) => void;
}) {
  const { meth } = useBalances(user);
  const tx = useTxSequence();
  const ids = { col: useId(), debt: useId(), colHelp: useId(), debtHelp: useId(), ghost: useId() };
  const [withGhost, setWithGhost] = useState(true);
  // Until the user types, the form shows the suggestion (kept current as price and balance load);
  // after that it shows exactly what they typed.
  const [edited, setEdited] = useState(false);
  const [colUser, setColUser] = useState("");
  const [debtUser, setDebtUser] = useState("");

  const suggested = price ? suggestion(meth, price, withGhost) : undefined;
  const colIn = edited ? colUser : suggested ? formatInput(suggested.c) : "";
  const debtIn = edited ? debtUser : suggested ? formatInput(suggested.d) : "";

  const update = (col: string, debt: string) => {
    setEdited(true);
    setColUser(col);
    setDebtUser(debt);
  };

  // The dashboard previews health and forecasts from these amounts.
  useEffect(() => {
    onDraftChange({ collateral: parseAmount(colIn) ?? 0n, debt: parseAmount(debtIn) ?? 0n });
  }, [colIn, debtIn, onDraftChange]);

  const c = parseAmount(colIn);
  const d = parseAmount(debtIn) ?? 0n;
  const need = c ? (withGhost ? c * 2n : c) : 0n;
  const h = c && price ? health(c, d, price) : undefined;
  const limit = c && price ? maxBorrow(c, 0n, price) : undefined;
  const t = c && d > 0n && price ? thresholds({ collateral: c, debt: d, price }) : undefined;

  const colError = !c || c === 0n ? "Enter an amount." : need > meth ? `Needs ${formatToken(need, "mETH")}${withGhost ? " (half for the ghost)" : ""}. Get test tokens first.` : undefined;
  const debtError = h !== undefined && d > 0n && h < H_OPEN ? `Health would be ${formatHealth(h)}; the pool needs at least 1.40 (borrow up to ${formatToken(limit ?? 0n, "mUSD")}).` : undefined;
  const invalid = !!colError || !!debtError || !price;
  const txCount = (d > 0n ? 3 : 2) * (withGhost ? 2 : 1);

  const colChips = meth > 0n
    ? [
        { label: "25%", onClick: () => update(formatInput((withGhost ? meth / 2n : meth) / 4n), debtIn) },
        { label: "50%", onClick: () => update(formatInput((withGhost ? meth / 2n : meth) / 2n), debtIn) },
        { label: "Max", onClick: () => update(formatInput(withGhost ? meth / 2n : meth), debtIn) },
      ]
    : undefined;
  const debtChips = limit && limit > 0n
    ? [
        { label: "25%", onClick: () => update(colIn, formatInput(limit / 4n)) },
        { label: "50%", onClick: () => update(colIn, formatInput(limit / 2n)) },
        { label: "Max", onClick: () => update(colIn, formatInput(limit)) },
      ]
    : undefined;

  const submit = () => {
    if (invalid || !c) return;
    const steps: TxStep[] = [
      { label: "Approve mETH", run: () => approveIfNeeded(mETH.address, pool.address, c, user) },
      { label: `Deposit ${formatToken(c, "mETH")}`, run: () => send({ ...pool, functionName: "deposit", args: [c], account: user }) },
    ];
    if (d > 0n) steps.push({ label: `Borrow ${formatToken(d, "mUSD")}`, run: () => send({ ...pool, functionName: "borrow", args: [d], account: user }) });
    if (withGhost) {
      steps.push(
        { label: "Ghost: approve mETH", run: () => approveIfNeeded(mETH.address, cliff.address, c, user) },
        { label: "Ghost: deposit", run: () => send({ ...cliff, functionName: "deposit", args: [c], account: user }) },
      );
      if (d > 0n) steps.push({ label: "Ghost: borrow", run: () => send({ ...cliff, functionName: "borrow", args: [d], account: user }) });
    }
    tx.run(steps);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
      className="space-y-5"
    >
      <AmountField
        id={ids.col}
        helpId={ids.colHelp}
        label="Collateral"
        unit="mETH"
        value={colIn}
        onChange={(v) => update(v, debtIn)}
        error={colError}
        help={`In wallet: ${formatToken(meth, "mETH")}`}
        chips={colChips}
      />
      <AmountField
        id={ids.debt}
        helpId={ids.debtHelp}
        label="Borrow"
        unit="mUSD"
        value={debtIn}
        onChange={(v) => update(colIn, v)}
        error={debtError}
        help={limit ? `Up to ${formatToken(limit, "mUSD")} at the 1.40 limit` : "Optional"}
        chips={debtChips}
      />

      {suggested && edited && (suggested.c !== c || suggested.d !== d) && (
        <p className="text-sm text-muted">
          A comfortable start for this wallet: {formatToken(suggested.c, "mETH", 4)} and {formatToken(suggested.d, "mUSD", 0)} (health 1.60).{" "}
          <button
            type="button"
            onClick={() => {
              setEdited(false);
            }}
            className="cursor-pointer text-text underline underline-offset-2"
          >
            Use it
          </button>
        </p>
      )}

      {h !== undefined && d > 0n && (
        <dl className="grid grid-cols-3 divide-x divide-border rounded-sm border border-border text-sm">
          <Preview label="Health" value={formatHealth(h)} />
          <Preview label="Glide starts at" value={t ? formatPrice(toWad(t.glidePrice)) : "–"} sub={t ? `ETH −${t.glideDropPct.toFixed(1)}%` : undefined} />
          <Preview label="Normal pool liquidates at" value={t ? formatPrice(toWad(t.cliffPrice)) : "–"} sub={t ? `ETH −${t.cliffDropPct.toFixed(1)}%` : undefined} />
        </dl>
      )}

      <label htmlFor={ids.ghost} className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          id={ids.ghost}
          type="checkbox"
          checked={withGhost}
          onChange={(e) => setWithGhost(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--safe)]"
        />
        <span>
          <span className="font-medium">Open a ghost in the normal pool too</span>
          <span className="block text-muted">
            The same loan under classic liquidation rules, so you can compare the two through the next price move.
          </span>
        </span>
      </label>

      <div>
        <Button type="submit" variant="primary" className="w-full" disabled={invalid || tx.running}>
          {tx.running ? "Confirm in your wallet…" : "Open loan"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">
          Your wallet will ask you to confirm {txCount} transactions{withGhost ? ", half of them for the ghost" : ""}.
        </p>
      </div>

      <TxProgress steps={tx.steps} error={tx.error} onRetry={submit} />
    </form>
  );
}

function Preview({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-mono">{value}</dd>
      {sub && <dd className="num text-xs text-muted">{sub}</dd>}
    </div>
  );
}

// ---------- manage an open position ----------

function ManageTabs({ user, soft, hasGhost, price }: { user: Address; soft: Position; hasGhost: boolean; price?: bigint }) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const { meth, musd } = useBalances(user);
  const tx = useTxSequence();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = { input: useId(), help: useId(), panel: useId() };
  void hasGhost;

  const amt = parseAmount(amount);
  const c = soft.collateral;
  const d = soft.debt;
  const h = soft.health;
  const state = healthState(h);

  // What gets health back to the 1.40 opening limit at today's price (so borrowing and withdrawing work again).
  const restore = (() => {
    if (!price || d === 0n || h >= H_OPEN) return undefined;
    const colNeeded = (d * H_OPEN * WAD) / (price * LT) + 1n;
    const debtAllowed = (((c * price) / WAD) * LT) / H_OPEN;
    return { addEth: colNeeded > c ? colNeeded - c : 0n, repayUsd: d > debtAllowed ? d - debtAllowed : 0n };
  })();

  const after = (() => {
    if (!amt || !price) return undefined;
    if (tab === "deposit") return health(c + amt, d, price);
    if (tab === "borrow") return health(c, d + amt, price);
    if (tab === "repay") return health(c, amt >= d ? 0n : d - amt, price);
    return amt > c ? undefined : health(c - amt, d, price);
  })();

  const max = tab === "deposit" ? meth : tab === "borrow" ? (price ? maxBorrow(c, d, price) : 0n) : tab === "repay" ? (musd < d ? musd : d) : c;
  const unit = tab === "deposit" || tab === "withdraw" ? "mETH" : "mUSD";
  const current = TABS.find((x) => x.id === tab)!;

  const error = (() => {
    if (!amount) return undefined;
    if (!amt || amt === 0n) return "Enter an amount above zero.";
    if (tab === "deposit" && amt > meth) return "More than your wallet holds.";
    if (tab === "repay" && amt > musd) return "More than your wallet holds.";
    if (tab === "repay" && d === 0n) return "Nothing to repay.";
    if (tab === "withdraw" && amt > c) return "More than your collateral.";
    if ((tab === "borrow" || tab === "withdraw") && d + (tab === "borrow" ? amt : 0n) > 0n && after !== undefined && after < H_OPEN)
      return `Health would be ${formatHealth(after)}; the pool needs at least 1.40.`;
    return undefined;
  })();

  const chips = max > 0n
    ? [
        { label: "25%", onClick: () => setAmount(formatInput(max / 4n)) },
        { label: "50%", onClick: () => setAmount(formatInput(max / 2n)) },
        { label: "Max", onClick: () => setAmount(formatInput(max)) },
      ]
    : undefined;

  const submit = () => {
    if (!amt || error) return;
    const steps: TxStep[] =
      tab === "deposit"
        ? [
            { label: "Approve mETH", run: () => approveIfNeeded(mETH.address, pool.address, amt, user) },
            { label: `Deposit ${formatToken(amt, "mETH")}`, run: () => send({ ...pool, functionName: "deposit", args: [amt], account: user }) },
          ]
        : tab === "borrow"
          ? [{ label: `Borrow ${formatToken(amt, "mUSD")}`, run: () => send({ ...pool, functionName: "borrow", args: [amt], account: user }) }]
          : tab === "repay"
            ? [
                { label: "Approve mUSD", run: () => approveIfNeeded(mUSD.address, pool.address, amt, user) },
                { label: `Repay ${formatToken(amt, "mUSD")}`, run: () => send({ ...pool, functionName: "repay", args: [amt], account: user }) },
              ]
            : [{ label: `Withdraw ${formatToken(amt, "mETH")}`, run: () => send({ ...pool, functionName: "withdraw", args: [amt], account: user }) }];
    tx.run(steps).then((ok) => ok && setAmount(""));
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const closePosition = () => {
    const steps: TxStep[] = [];
    if (d > 0n) {
      steps.push({ label: "Approve mUSD", run: () => approveIfNeeded(mUSD.address, pool.address, d, user) });
      steps.push({ label: `Repay ${formatToken(d, "mUSD")}`, run: () => send({ ...pool, functionName: "repay", args: [d], account: user }) });
    }
    if (c > 0n) {
      steps.push({ label: `Withdraw ${formatToken(c, "mETH")}`, run: () => send({ ...pool, functionName: "withdraw", args: [c], account: user }) });
    }
    tx.run(steps).then((ok) => ok && setAmount(""));
  };

  return (
    <div>
      {restore && (
        <div className={`mb-5 rounded-sm border-l-2 px-3 py-2.5 text-sm ${state === "safe" ? "border-border bg-sunken" : "border-glide-fill bg-sunken"}`}>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <StatusBadge state={state} />
            {state === "safe" ? "Below the 1.40 opening limit" : state === "gliding" ? "Your loan is gliding" : "Backstop range"}
          </p>
          <p className="mt-1 text-muted">
            {state === "safe"
              ? "Nothing is being sold, but you can't borrow more or withdraw until health is back at 1.40."
              : state === "gliding"
                ? "A small slice of collateral sells each block until health is back at 1.25. If the price recovers first, selling stops."
                : "Below 1.02 the next poke sells what restores 1.25 in one step, with no bonus to anyone."}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {restore.repayUsd > 0n && (
              <button type="button" className="cursor-pointer text-text underline underline-offset-2" onClick={() => { setTab("repay"); setAmount(formatInput(restore.repayUsd)); }}>
                Repay {formatToken(restore.repayUsd, "mUSD")} to reach 1.40
              </button>
            )}
            {restore.addEth > 0n && (
              <button type="button" className="cursor-pointer text-text underline underline-offset-2" onClick={() => { setTab("deposit"); setAmount(formatInput(restore.addEth)); }}>
                or add {formatToken(restore.addEth, "mETH", 4)}
              </button>
            )}
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Position actions" className="flex gap-5 border-b border-border">
        {TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={ids.panel}
            tabIndex={tab === x.id ? 0 : -1}
            onKeyDown={(e) => onTabKey(e, i)}
            onClick={() => {
              setTab(x.id);
              setAmount("");
              tx.reset();
            }}
            className={`-mb-px min-h-10 cursor-pointer border-b-2 text-sm transition-colors ${
              tab === x.id ? "border-text font-medium text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <form
        id={ids.panel}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
        className="mt-4 space-y-4"
      >
        <p className="text-sm text-muted">{current.hint}</p>
        <AmountField
          id={ids.input}
          helpId={ids.help}
          label="Amount"
          unit={unit}
          value={amount}
          onChange={setAmount}
          error={error}
          help={`Max ${formatToken(max, unit)}`}
          chips={chips}
        />

        {after !== undefined && (
          <p className="num flex items-center justify-between border-y border-border py-2 text-sm">
            <span className="text-muted">Health after</span>
            <span className="inline-flex items-center gap-2 font-mono">
              {formatHealth(h)} <span className="text-muted">→</span> {formatHealth(after)}
              <StatusBadge state={healthState(after)} />
            </span>
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={!amt || !!error || tx.running}>
          {tx.running ? "Confirm in your wallet…" : amt ? `${current.cta} ${formatToken(amt, unit, unit === "mETH" ? 4 : 2)}` : current.cta}
        </Button>
        <TxProgress steps={tx.steps} error={tx.error} onRetry={submit} />
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3 text-sm">
        <span className="text-muted">Done with this loan?</span>
        <button
          type="button"
          onClick={closePosition}
          disabled={tx.running}
          className="cursor-pointer text-text underline underline-offset-2 disabled:opacity-50"
        >
          Repay everything and withdraw
        </button>
      </div>
    </div>
  );
}

/** A price from thresholds() (a float, 2 decimals) back to WAD for formatPrice. */
const toWad = (x: number) => BigInt(Math.round(x * 100)) * 10n ** 16n;

/** WAD → plain input string (up to 6 decimals, rounded down). */
function formatInput(x: bigint) {
  const whole = x / WAD;
  const frac = ((x % WAD) / 10n ** 12n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function AmountField({
  id,
  helpId,
  label,
  unit,
  value,
  onChange,
  error,
  help,
  chips,
}: {
  id: string;
  helpId: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  help?: string;
  chips?: { label: string; onClick: () => void }[];
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {chips && (
          <div className="flex gap-1">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                className="min-h-7 cursor-pointer rounded-sm px-2 text-xs text-muted transition-colors hover:bg-sunken hover:text-text"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`mt-1.5 flex items-center rounded-sm border bg-surface transition-colors focus-within:border-text ${error ? "border-glide-fill" : "border-border"}`}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={helpId}
          className="num min-h-12 w-full min-w-0 bg-transparent px-3 font-mono text-lg outline-none"
          placeholder="0"
        />
        <span className="px-3 text-sm text-muted">{unit}</span>
      </div>
      <p id={helpId} className={`num mt-1.5 text-xs ${error ? "text-glide" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? help}
      </p>
    </div>
  );
}
