// Losses Avoided (06 §5), defined precisely so it can be checked:
//
//   equity(position) = collateral − debt / price (+ refunded / price for Soft Landing), in mETH
//   advantage(user)  = equity(soft) − equity(cliff ghost), at the same oracle price
//   Losses Avoided   = Σ advantage over every user with both positions (signed: negatives are kept)
//
// Net equity, not collateral lost: a glide sells collateral but also repays debt, so counting
// collateral alone would exaggerate. Refunds are mUSD the user actually received from Soft Landing
// sales, so they count as theirs.

export const WAD = 10n ** 18n;
/** |advantage| below this (0.000001 mETH) counts as equal, so wei-level rounding isn't "better". */
export const EQUAL_EPSILON = 10n ** 12n;

export type Pos = { user: string; collateral: bigint; debt: bigint; refunded: bigint };

export function equity(p: Pos, price: bigint): bigint {
  return p.collateral - (p.debt * WAD) / price + (p.refunded * WAD) / price;
}

export type LossesAvoided = {
  totalWei: bigint;
  pairedUsers: number;
  usersBetter: number;
  usersWorse: number;
  usersEqual: number;
  seededUsers: number;
};

export function lossesAvoided(soft: Pos[], cliff: Pos[], price: bigint, seeded: Set<string> = new Set()): LossesAvoided {
  if (price <= 0n) throw new Error("price must be positive");
  const ghosts = new Map(cliff.map((p) => [p.user.toLowerCase(), p]));
  const r: LossesAvoided = { totalWei: 0n, pairedUsers: 0, usersBetter: 0, usersWorse: 0, usersEqual: 0, seededUsers: 0 };
  const seededLower = new Set([...seeded].map((s) => s.toLowerCase()));
  for (const s of soft) {
    const g = ghosts.get(s.user.toLowerCase());
    if (!g) continue;
    const adv = equity(s, price) - equity(g, price);
    r.totalWei += adv;
    r.pairedUsers++;
    if (seededLower.has(s.user.toLowerCase())) r.seededUsers++;
    if (adv > EQUAL_EPSILON) r.usersBetter++;
    else if (adv < -EQUAL_EPSILON) r.usersWorse++;
    else r.usersEqual++;
  }
  return r;
}

/** Signed WAD → decimal string with `dp` places, truncated towards zero. */
export function formatWad(x: bigint, dp = 4): string {
  const neg = x < 0n;
  const a = neg ? -x : x;
  const whole = a / WAD;
  const frac = ((a % WAD) * 10n ** BigInt(dp)) / WAD;
  const s = dp > 0 ? `${whole}.${frac.toString().padStart(dp, "0")}` : `${whole}`;
  return neg && (whole > 0n || frac > 0n) ? `-${s}` : s;
}
