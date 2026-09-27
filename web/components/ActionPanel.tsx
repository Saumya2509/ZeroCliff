"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Address } from "viem";
import { useBalances, type Position } from "@/hooks/usePosition";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { cliff, mETH, mUSD, pool } from "@/lib/contracts";
import { formatHealth, formatPrice, formatToken, parseAmount } from "@/lib/format";
import { H_COMFORT, H_OPEN, health, LT, WAD } from "@/lib/sim/glide";
import { approveIfNeeded, send } from "@/lib/tx";
import { Sparkles, Bot, Zap, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { TxProgress } from "./TxProgress";
import { Button } from "./ui";

type Tab = "deposit" | "borrow" | "repay" | "withdraw";
const TABS: { id: Tab; label: string }[] = [
  { id: "deposit", label: "Deposit" },
  { id: "borrow", label: "Borrow" },
  { id: "repay", label: "Repay" },
  { id: "withdraw", label: "Withdraw" },
];

const TAB_DESCRIPTIONS: Record<Tab, { hint: string; cta: string }> = {
  deposit: {
    hint: "Deposit mETH to strengthen collateral backing and raise your safety score.",
    cta: "Deposit Collateral",
  },
  borrow: {
    hint: "Borrow mUSD stablecoins against collateral. The system keeps you safely above the 1.40 limit.",
    cta: "Borrow mUSD",
  },
  repay: {
    hint: "Repay borrowed mUSD debt to increase your safety score and lower liquidation risk.",
    cta: "Repay Debt",
  },
  withdraw: {
    hint: "Safely withdraw surplus mETH collateral back to your wallet.",
    cta: "Withdraw Collateral",
  },
};

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
  const { meth } = useBalances(user);
  const tx = useTxSequence();
  const ids = { col: useId(), debt: useId(), colHelp: useId(), debtHelp: useId(), ghost: useId() };

  const [colIn, setColIn] = useState("1");
  const [debtIn, setDebtIn] = useState("1450");
  const [withGhost, setWithGhost] = useState(true);
  const initializedRef = useRef(false);

  const calculateAiParams = useCallback((ethBal: bigint, currentPrice?: bigint, ghost: boolean = true) => {
    const p = currentPrice ?? (2500n * WAD);
    // AI Default target collateral: 1 mETH
    let targetCol = 1n * WAD;
    const multiplier = ghost ? 2n : 1n;
    if (ethBal > 0n && ethBal < targetCol * multiplier) {
      targetCol = (ethBal * 9n) / (10n * multiplier);
    }
    if (targetCol <= 0n) targetCol = 1n * WAD;

    // Comfort health target = 1.45 (Optimal risk/reward)
    // Debt = (C * P * 0.85) / 1.45
    const colValUsd = (targetCol * p) / WAD;
    const maxSafeDebt = (colValUsd * LT) / H_COMFORT;
    const debtUnits = maxSafeDebt / WAD;
    const roundedDebtUnits = (debtUnits / 10n) * 10n;
    const targetDebt = roundedDebtUnits > 0n ? roundedDebtUnits * WAD : maxSafeDebt;

    return {
      colStr: formatInput(targetCol),
      debtStr: roundedDebtUnits > 0n ? roundedDebtUnits.toString() : formatInput(targetDebt),
      targetCol,
      targetDebt,
    };
  }, []);

  // Autonomous auto-configuration on load
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      const { colStr, debtStr, targetCol, targetDebt } = calculateAiParams(meth, price, withGhost);
      setColIn(colStr);
      setDebtIn(debtStr);
      onDraftChange({ collateral: targetCol, debt: targetDebt });
    }
  }, [price, meth, withGhost, calculateAiParams, onDraftChange]);

  const c = parseAmount(colIn);
  const d = parseAmount(debtIn) ?? 0n;
  const need = c ? (withGhost ? c * 2n : c) : 0n;
  const h = c && price ? health(c, d, price) : undefined;
  const limit = c && price ? maxBorrow(c, 0n, price) : undefined;

  const colError = !c || c === 0n ? "Enter collateral amount." : need > meth ? `Requires ${formatToken(need, "mETH")}. Claim test tokens first.` : undefined;
  const debtError = h !== undefined && d > 0n && h < H_OPEN ? `Health ${formatHealth(h)} below 1.40 limit (max ${formatToken(limit ?? 0n, "mUSD")}).` : undefined;
  const invalid = !!colError || !!debtError || !price;

  const update = (col: string, debt: string) => {
    setColIn(col);
    setDebtIn(debt);
    onDraftChange({ collateral: parseAmount(col) ?? 0n, debt: parseAmount(debt) ?? 0n });
  };

  const applyAiOptimal = () => {
    const { colStr, debtStr, targetCol, targetDebt } = calculateAiParams(meth, price, withGhost);
    update(colStr, debtStr);
  };

  const colChips = [
    { label: "25%", onClick: () => meth > 0n && update(formatInput(withGhost ? meth / 8n : meth / 4n), debtIn) },
    { label: "50%", onClick: () => meth > 0n && update(formatInput(withGhost ? meth / 4n : meth / 2n), debtIn) },
    { label: "75%", onClick: () => meth > 0n && update(formatInput(withGhost ? (meth * 3n) / 8n : (meth * 3n) / 4n), debtIn) },
    { label: "MAX", onClick: () => meth > 0n && update(formatInput(withGhost ? meth / 2n : meth), debtIn) },
  ];

  const debtChips = limit && limit > 0n ? [
    { label: "25%", onClick: () => update(colIn, formatInput(limit / 4n)) },
    { label: "50%", onClick: () => update(colIn, formatInput(limit / 2n)) },
    { label: "75%", onClick: () => update(colIn, formatInput((limit * 3n) / 4n)) },
    { label: "MAX SAFE", onClick: () => update(colIn, formatInput(limit)) },
  ] : undefined;

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
      className="space-y-4"
    >
      {/* AI Autonomous Autopilot HUD */}
      <div className="rounded-xl border border-safe/40 bg-gradient-to-br from-safe/10 via-surface/60 to-surface/90 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-safe/25 text-safe shadow-inner">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-text">AI Autonomous Autopilot</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-safe/20 text-safe border border-safe/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-safe animate-ping" />
                  Auto-Configured
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={applyAiOptimal}
            className="text-[11px] font-mono text-safe hover:underline flex items-center gap-1 cursor-pointer"
            title="Recalculate AI optimal parameters"
          >
            <Sparkles className="h-3 w-3" />
            Re-Analyze
          </button>
        </div>

        <p className="text-xs text-muted leading-relaxed">
          AI analyzed live ETH price (<span className="text-text font-mono font-medium">${price ? formatPrice(price) : "2,500.00"}</span>) and wallet balance. Optimal safe parameters have been pre-filled.
        </p>

        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
          <div className="rounded-lg bg-bg/80 border border-border/70 p-2">
            <span className="text-muted block text-[10px] uppercase">Collateral</span>
            <span className="text-text font-bold">{colIn || "1"} mETH</span>
          </div>
          <div className="rounded-lg bg-bg/80 border border-border/70 p-2">
            <span className="text-muted block text-[10px] uppercase">Auto-Borrow</span>
            <span className="text-text font-bold">${debtIn || "1,450"} mUSD</span>
          </div>
          <div className="rounded-lg bg-bg/80 border border-border/70 p-2">
            <span className="text-muted block text-[10px] uppercase">Target Health</span>
            <span className="text-safe font-bold">1.45 (Optimal)</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted pt-1 border-t border-border/40">
          <ShieldCheck className="h-4 w-4 text-safe shrink-0" />
          <span>Just confirm on the website & MetaMask below. The AI does everything else.</span>
        </div>
      </div>

      <div className="space-y-4">
        <AmountField
          id={ids.col}
          helpId={ids.colHelp}
          label="Deposit Collateral"
          unit="mETH"
          value={colIn}
          onChange={(v) => update(v, debtIn)}
          error={colError}
          help={`Available in wallet: ${formatToken(meth, "mETH")}`}
          chips={colChips}
        />
        <AmountField
          id={ids.debt}
          helpId={ids.debtHelp}
          label="Borrow Amount"
          unit="mUSD"
          value={debtIn}
          onChange={(v) => update(colIn, v)}
          error={debtError}
          help={h !== undefined ? `Health: ${formatHealth(h)} (Safe limit: ≥ 1.40)` : "Borrowing is optional"}
          chips={debtChips}
        />
      </div>

      {/* Ghost Twin Switch */}
      <div className="flex items-center justify-between rounded-lg border border-border/80 bg-surface/40 p-3">
        <div className="space-y-0.5">
          <label htmlFor={ids.ghost} className="flex items-center gap-1.5 text-xs font-semibold text-text cursor-pointer">
            <span className="text-safe">✦</span> Mirror Ghost Position (Classic Cliff)
          </label>
          <p className="text-[11px] text-muted">
            Duplicates position in a classic pool to compare live liquidation vs glide.
          </p>
        </div>
        <input
          id={ids.ghost}
          type="checkbox"
          checked={withGhost}
          onChange={(e) => setWithGhost(e.target.checked)}
          className="h-4 w-4 rounded accent-[var(--safe)] cursor-pointer"
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full justify-center py-3 font-semibold text-sm active:scale-[0.98] transition-transform flex items-center gap-2 shadow-md shadow-safe/10"
        disabled={invalid || tx.running}
      >
        {tx.running ? (
          "Executing Onchain (Confirm in MetaMask)…"
        ) : (
          <>
            <Sparkles className="h-4 w-4 text-bg" />
            Confirm AI Parameters & Launch Position
          </>
        )}
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
  const h = soft.health;

  // AI Autopilot Guardian Status
  const isOptimal = h >= H_COMFORT; // >= 1.45
  const isTurbulent = h < H_COMFORT && h >= H_OPEN; // 1.40 - 1.45
  const isDanger = h < H_OPEN; // < 1.40

  const aiRebalanceSuggestion = (() => {
    if (!price || h >= H_COMFORT || d === 0n) return null;
    const dTarget = ((c * price) / WAD) * LT / H_COMFORT;
    if (d > dTarget) {
      const repayNeeded = d - dTarget;
      return {
        type: "repay" as Tab,
        amountWad: repayNeeded,
        amountStr: formatInput(repayNeeded),
        reason: "Repay debt to restore safe 1.45 health buffer",
      };
    }
    return null;
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

  const error = (() => {
    if (!amount) return undefined;
    if (!amt || amt === 0n) return "Enter an amount above zero.";
    if (tab === "deposit" && amt > meth) return "Exceeds wallet balance.";
    if (tab === "repay" && amt > musd) return "Exceeds wallet balance.";
    if (tab === "repay" && d === 0n) return "No debt to repay.";
    if (tab === "withdraw" && amt > c) return "Exceeds collateral balance.";
    if ((tab === "borrow" || tab === "withdraw") && d + (tab === "borrow" ? amt : 0n) > 0n && after !== undefined && after < H_OPEN)
      return `Health would drop to ${formatHealth(after)} (limit ≥ 1.40).`;
    return undefined;
  })();

  const help = (() => {
    const base = `Max: ${formatToken(max, unit)}`;
    return after !== undefined ? `${base} · Health after: ${formatHealth(after)}` : base;
  })();

  const quickChips = max > 0n ? [
    { label: "25%", onClick: () => setAmount(formatInput(max / 4n)) },
    { label: "50%", onClick: () => setAmount(formatInput(max / 2n)) },
    { label: "75%", onClick: () => setAmount(formatInput((max * 3n) / 4n)) },
    { label: "MAX", onClick: () => setAmount(formatInput(max)) },
  ] : undefined;

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
      {/* Show alert banner ONLY if turbulence or danger is detected, avoiding duplicate 'nominal' health boxes */}
      {(isTurbulent || isDanger) && (
        <div
          className={`mb-4 rounded-xl border p-3.5 space-y-2 transition-all ${
            isDanger ? "border-cliff/40 bg-cliff/10" : "border-glide/40 bg-glide/10"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className={`h-4 w-4 ${isDanger ? "text-cliff" : "text-glide"}`} />
              <span className="text-xs font-semibold text-text">
                {isDanger ? "AI Guardian: Position Under Stress" : "AI Guardian: Market Volatility Detected"}
              </span>
            </div>
            <span className={`font-mono text-xs font-bold ${isDanger ? "text-cliff" : "text-glide"}`}>
              Health: {formatHealth(h)}
            </span>
          </div>

          <p className="text-xs text-muted">
            {isDanger
              ? "Health is below 1.40 threshold. Soft liquidation glide is gently protecting your loan."
              : "Position is in caution zone. AI recommends slight rebalancing to maintain optimal 1.45 buffer."}
          </p>

          {aiRebalanceSuggestion && (
            <div className="pt-1 flex items-center justify-between">
              <span className="text-[11px] text-text font-mono">
                Recommended: Repay ~${aiRebalanceSuggestion.amountStr} mUSD
              </span>
              <button
                type="button"
                onClick={() => {
                  setTab("repay");
                  setAmount(aiRebalanceSuggestion.amountStr);
                }}
                className="rounded bg-safe/20 border border-safe/40 px-2 py-0.5 text-[11px] font-semibold text-safe hover:bg-safe/30 transition-all flex items-center gap-1 cursor-pointer"
              >
                <Zap className="h-3 w-3" />
                1-Click AI Fill
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modern Tabs */}
      <div role="tablist" aria-label="Position actions" className="flex gap-1 overflow-x-auto border-b border-border pb-1">
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
            className={`min-h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold transition-all ${
              tab === t.id ? "bg-safe/10 text-safe border border-safe/30" : "text-muted hover:text-text hover:bg-surface/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Friendly Tab Hint */}
      <p className="mt-2 text-xs text-muted">
        {TAB_DESCRIPTIONS[tab].hint}
      </p>

      <form
        id={ids.panel}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
        className="mt-3.5 space-y-4"
      >
        <AmountField
          id={ids.input}
          helpId={ids.help}
          label={`${tab.slice(0, 1).toUpperCase()}${tab.slice(1)} Amount`}
          unit={unit}
          value={amount}
          onChange={setAmount}
          error={error}
          help={help}
          chips={quickChips}
        />

        {after !== undefined && (
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-bg/50 px-3 py-2 text-xs">
            <span className="text-muted">Estimated Safety Score After:</span>
            <span className={`font-mono font-bold ${after >= H_OPEN ? "text-safe" : "text-rose-400"}`}>
              {formatHealth(after)} {after >= H_OPEN ? "🟢 (Safe)" : "🔴 (Below 1.40 Limit)"}
            </span>
          </div>
        )}

        <Button type="submit" variant="primary" className="w-full justify-center py-2.5 active:scale-[0.98] transition-transform font-semibold text-sm" disabled={!amt || !!error || tx.running}>
          {tx.running ? "Settling Onchain…" : `${TAB_DESCRIPTIONS[tab].cta}${amount ? " (" + amount + " " + unit + ")" : ""}`}
        </Button>
        <TxProgress steps={tx.steps} error={tx.error} onRetry={submit} />
      </form>

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
        <span className="text-muted">Need to exit completely?</span>
        <button
          type="button"
          onClick={closePosition}
          disabled={tx.running}
          className="text-xs font-semibold text-muted hover:text-rose-400 underline underline-offset-2 transition-colors disabled:opacity-50"
        >
          {tx.running ? "Closing…" : "Close & Repay Full Loan"}
        </button>
      </div>
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
  action?: ReactNode;
  chips?: { label: string; onClick: () => void }[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </label>
        {action}
      </div>
      <div
        className={`mt-1.5 flex items-center rounded-lg border bg-surface/60 focus-within:border-safe focus-within:ring-1 focus-within:ring-safe transition-all ${
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
          className="num min-h-10 w-full min-w-0 bg-transparent px-3 text-sm outline-none font-mono"
          placeholder="0.00"
        />
        <span className="px-3 font-mono text-xs font-semibold text-muted">{unit}</span>
      </div>

      {chips && chips.length > 0 && (
        <div className="mt-1.5 flex items-center justify-between">
          <p id={helpId} className={`num text-[11px] ${error ? "text-glide font-medium" : "text-muted"}`} role={error ? "alert" : undefined}>
            {error ?? help}
          </p>
          <div className="flex gap-1">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                className="rounded border border-border/80 bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-safe hover:text-text active:scale-95 transition-all"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(!chips || chips.length === 0) && (
        <p id={helpId} className={`num mt-1 text-[11px] ${error ? "text-glide font-medium" : "text-muted"}`} role={error ? "alert" : undefined}>
          {error ?? help}
        </p>
      )}
    </div>
  );
}
