"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Address } from "viem";
import { useBalances, type Position } from "@/hooks/usePosition";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { cliff, mETH, mUSD, pool } from "@/lib/contracts";
import { formatHealth, formatToken, parseAmount } from "@/lib/format";
import { H_OPEN, health, LT, WAD } from "@/lib/sim/glide";
import { approveIfNeeded, send } from "@/lib/tx";
import { TxProgress } from "./TxProgress";
import { Button } from "./ui";

type Tab = "deposit" | "borrow" | "repay" | "withdraw";
const TABS: { id: Tab; label: string }[] = [
  { id: "deposit", label: "Deposit" },
  { id: "borrow", label: "Borrow" },
  { id: "repay", label: "Repay" },
  { id: "withdraw", label: "Withdraw" },
];

/** Max debt that keeps health ≥ H_OPEN, minus existing debt. */
function maxBorrow(c: bigint, d: bigint, price: bigint) {
  const cap = ((c * price) / WAD) * LT / H_OPEN;
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

function OpenPositionForm({
  user,
  price,
  onDraftChange,
}: {
  user: Address;
  price?: bigint;
  onDraftChange: (draft: { collateral: bigint; debt: bigint }) => void;
}) {
  const [colIn, setColIn] = useState("4");
  const [debtIn, setDebtIn] = useState("8000");
  const [withGhost, setWithGhost] = useState(true);
  const { meth } = useBalances(user);
  const tx = useTxSequence();
  const ids = { col: useId(), debt: useId(), colHelp: useId(), debtHelp: useId(), ghost: useId() };

  const c = parseAmount(colIn);
  const d = parseAmount(debtIn) ?? 0n;
  const need = c ? (withGhost ? c * 2n : c) : 0n;
  const h = c && price ? health(c, d, price) : undefined;
  const limit = c && price ? maxBorrow(c, 0n, price) : undefined;

  const colError = !c || c === 0n ? "Enter how much mETH to deposit." : need > meth ? `You need ${formatToken(need, "mETH")}${withGhost ? " (half for the ghost)" : ""}. Use “Get test tokens” first.` : undefined;
  const debtError = h !== undefined && d > 0n && h < H_OPEN ? `Health would be ${formatHealth(h)}. Borrow at most ${formatToken(limit ?? 0n, "mUSD")} to stay above 1.40.` : undefined;
  const invalid = !!colError || !!debtError || !price;

  const update = (col: string, debt: string) => {
    setColIn(col);
    setDebtIn(debt);
    onDraftChange({ collateral: parseAmount(col) ?? 0n, debt: parseAmount(debt) ?? 0n });
  };

  const submit = () => {
    if (invalid || !c) return;
    const steps: TxStep[] = [
      { label: "Approve mETH", run: () => approveIfNeeded(mETH.address, pool.address, c, user) },
      { label: `Deposit ${formatToken(c, "mETH")}`, run: () => send({ ...pool, functionName: "deposit", args: [c], account: user }) },
    ];
    if (d > 0n) steps.push({ label: `Borrow ${formatToken(d, "mUSD")}`, run: () => send({ ...pool, functionName: "borrow", args: [d], account: user }) });
    if (withGhost) {
      steps.push(
        { label: "Ghost: approve mETH for the cliff pool", run: () => approveIfNeeded(mETH.address, cliff.address, c, user) },
        { label: "Ghost: deposit the same amount", run: () => send({ ...cliff, functionName: "deposit", args: [c], account: user }) },
      );
      if (d > 0n) steps.push({ label: "Ghost: borrow the same amount", run: () => send({ ...cliff, functionName: "borrow", args: [d], account: user }) });
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
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField id={ids.col} helpId={ids.colHelp} label="Collateral" unit="mETH" value={colIn} onChange={(v) => update(v, debtIn)} error={colError}
          help={`In wallet: ${formatToken(meth, "mETH")}`} />
        <AmountField id={ids.debt} helpId={ids.debtHelp} label="Borrow" unit="mUSD" value={debtIn} onChange={(v) => update(colIn, v)} error={debtError}
          help={h !== undefined ? `Health after: ${formatHealth(h)} (must stay ≥ 1.40)` : "Borrowing is optional"} />
      </div>
      <div className="mt-4 flex items-start gap-3">
        <input id={ids.ghost} type="checkbox" checked={withGhost} onChange={(e) => setWithGhost(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--safe)]" />
        <label htmlFor={ids.ghost} className="text-sm">
          Open a ghost position for comparison
          <span className="block text-muted">Same amounts in a normal (cliff) pool, so you can watch what it would do to you.</span>
        </label>
      </div>
      <Button type="submit" variant="primary" className="mt-4 w-full sm:w-auto" disabled={invalid || tx.running}>
        {tx.running ? "Opening…" : "Open position"}
      </Button>
      <TxProgress steps={tx.steps} error={tx.error} onRetry={submit} />
    </form>
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

  const amt = parseAmount(amount);
  const c = soft.collateral;
  const d = soft.debt;

  const after = (() => {
    if (!amt || !price) return undefined;
    if (tab === "deposit") return health(c + amt, d, price);
    if (tab === "borrow") return health(c, d + amt, price);
    if (tab === "repay") return health(c, amt >= d ? 0n : d - amt, price);
    return amt > c ? undefined : health(c - amt, d, price);
  })();

  const max = tab === "deposit" ? meth : tab === "borrow" ? (price ? maxBorrow(c, d, price) : 0n) : tab === "repay" ? (musd < d ? musd : d) : c;
  const unit = tab === "deposit" || tab === "withdraw" ? "mETH" : "mUSD";

  const error = (() => {
    if (!amount) return undefined;
    if (!amt || amt === 0n) return "Enter an amount above zero.";
    if (tab === "deposit" && amt > meth) return "More than you have in your wallet. Use “Get test tokens” first.";
    if (tab === "repay" && amt > musd) return "More mUSD than you have in your wallet.";
    if (tab === "repay" && d === 0n) return "You have no debt to repay.";
    if (tab === "withdraw" && amt > c) return "More than your collateral.";
    if ((tab === "borrow" || tab === "withdraw") && d + (tab === "borrow" ? amt : 0n) > 0n && after !== undefined && after < H_OPEN)
      return `Health would be ${formatHealth(after)}. Stay above 1.40 (max ${formatToken(max, unit)}).`;
    return undefined;
  })();

  const help = (() => {
    const base = `Available: ${formatToken(max, unit)}`;
    return after !== undefined ? `${base} · health after: ${formatHealth(after)}` : base;
  })();

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

  return (
    <div>
      <div role="tablist" aria-label="Position actions" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={ids.panel}
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => onTabKey(e, i)}
            onClick={() => {
              setTab(t.id);
              setAmount("");
              tx.reset();
            }}
            className={`-mb-px min-h-11 cursor-pointer border-b-2 px-4 text-sm transition-colors duration-150 ${
              tab === t.id ? "border-safe font-medium text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        id={ids.panel}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="pt-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <AmountField
          id={ids.input}
          helpId={ids.help}
          label={`${TABS.find((t) => t.id === tab)!.label} amount`}
          unit={unit}
          value={amount}
          onChange={setAmount}
          error={error}
          help={help}
          action={
            <Button type="button" variant="quiet" className="min-h-9 px-2 text-xs underline underline-offset-4" onClick={() => setAmount(formatInput(max))}>
              Max
            </Button>
          }
        />
        <Button type="submit" variant="primary" className="mt-4 w-full sm:w-auto" disabled={!amt || !!error || tx.running}>
          {tx.running ? "Working…" : TABS.find((t) => t.id === tab)!.label}
        </Button>
        {!hasGhost && tab === "deposit" && (
          <p className="mt-3 text-sm text-muted">This position has no ghost. The comparison chart needs one opened at the same time.</p>
        )}
        <TxProgress steps={tx.steps} error={tx.error} onRetry={submit} />
      </form>
    </div>
  );
}

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
  action,
}: {
  id: string;
  helpId: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  help?: string;
  action?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {action}
      </div>
      <div
        className={`mt-1 flex items-center rounded-sm border bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-focus ${
          error ? "border-glide" : "border-border"
        }`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={helpId}
          className="num min-h-11 w-full min-w-0 bg-transparent px-3 text-base outline-none"
          placeholder="0.00"
        />
        <span className="px-3 text-sm text-muted">{unit}</span>
      </div>
      <p id={helpId} className={`num mt-1 text-sm ${error ? "text-glide" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? help}
      </p>
    </div>
  );
}
