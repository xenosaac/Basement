/**
 * Paradigm pm-AMM (Static, Uniform): a CFMM tailored to binary prediction
 * markets. Source: https://www.paradigm.xyz/2024/11/pm-amm
 *
 * Invariant:
 *   (y − x)·Φ((y − x)/L) + L·φ((y − x)/L) − y = 0
 *
 * Single-parameter state z = (y − x)/L = Φ⁻¹(P), where P is the marginal
 * YES price. Reserves at any z are:
 *   x(z) = L · {z·Φ(z) + φ(z) − z}
 *   y(z) = L · {z·Φ(z) + φ(z)}
 *   pool value V = L · φ(z)
 *
 * Trade mechanics (USDC numeraire, complete-set mint/burn):
 *   Buy Δ YES with $C:
 *     find z' with y(z') = y(z) + C → Δ = L·(z' − z)
 *   Sell Δ YES for $C:
 *     z' = z − Δ/L → C = y(z) − y(z')
 *   (Symmetric for NO.)
 *
 * Round-trip is exactly break-even modulo float precision (no
 * self-arbitrage on a static pool).
 *
 * Initial state at P=0.5: x₀ = y₀ = L·φ(0) = L/√(2π) ≈ 0.39894·L.
 * The pool MUST be seeded at creation; (0,0) does NOT satisfy invariant.
 *
 * Future extension: dynamic pm-AMM with L_t = L₀·√(T−t) gives constant
 * expected LVR through the round (Paradigm §3). For 3-min rounds the LVR
 * delta is small; static pm-AMM is sufficient for v0.
 */

import { PM_AMM_L_DOLLARS } from "./constants";

export const DEFAULT_L = PM_AMM_L_DOLLARS;

// ───────────────────── Gaussian primitives ─────────────────────

const SQRT_2 = Math.SQRT2;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Standard normal PDF φ(z). */
export function phi(z: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * z * z);
}

/** Abramowitz & Stegun 7.1.26 — max abs error 1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(z). */
export function Phi(z: number): number {
  return 0.5 * (1 + erf(z / SQRT_2));
}

/**
 * Inverse standard normal Φ⁻¹(p). Beasley-Springer-Moro / Acklam algorithm.
 * Max relative error ~1.15e-9 on p ∈ (1e-15, 1 − 1e-15).
 */
export function PhiInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

// ───────────────────── pm-AMM math ─────────────────────

/** y reserve at state z. y(z) = L·{z·Φ(z) + φ(z)}. */
export function yOfZ(z: number, L: number = DEFAULT_L): number {
  return L * (z * Phi(z) + phi(z));
}

/** x reserve at state z. x(z) = L·{z·Φ(z) + φ(z) − z}. */
export function xOfZ(z: number, L: number = DEFAULT_L): number {
  return L * (z * Phi(z) + phi(z) - z);
}

/** State z from reserves: z = (y − x) / L. */
export function zOf(x: number, y: number, L: number = DEFAULT_L): number {
  return (y - x) / L;
}

/** Marginal YES price = Φ(z). */
export function priceYes(x: number, y: number, L: number = DEFAULT_L): number {
  return Phi(zOf(x, y, L));
}

export function priceNo(x: number, y: number, L: number = DEFAULT_L): number {
  return 1 - priceYes(x, y, L);
}

/** Pool value V(z) = L · φ(z). Equals max LP loss at this state. */
export function poolValue(x: number, y: number, L: number = DEFAULT_L): number {
  return L * phi(zOf(x, y, L));
}

/** Initial seeded reserves at z=0 (P=0.5). */
export function initialReserves(L: number = DEFAULT_L): { x: number; y: number } {
  const r = L * INV_SQRT_2PI;
  return { x: r, y: r };
}

/** Pool considered "uninitialized" (caller should treat as fresh z=0 state). */
export function isUninitialized(x: number, y: number): boolean {
  return x === 0 && y === 0;
}

// ───────────────────── trade quotes ─────────────────────

export interface PmBuyResult {
  sharesBought: number;
  cost: number; // = input amount (echoed)
  newX: number;
  newY: number;
  newZ: number;
  newPriceYes: number;
  newPriceNo: number;
  avgPrice: number;
}

export interface PmSellResult {
  proceeds: number;
  sharesSold: number;
  newX: number;
  newY: number;
  newZ: number;
  newPriceYes: number;
  newPriceNo: number;
  avgPrice: number;
}

/**
 * Newton-solve f(z) = sideReserve(z) − target = 0.
 *   side="YES": f(z) = y(z) − targetY  (buying YES grows y by C)
 *   side="NO":  f(z) = x(z) − targetX  (buying NO grows x by C)
 * Derivatives: dy/dz = L·Φ(z); dx/dz = L·(Φ(z) − 1).
 */
function newtonSolveZ(
  z0: number,
  target: number,
  side: "YES" | "NO",
  L: number,
): number {
  let z = z0;
  // Linear initial guess from the marginal derivative at z0.
  if (side === "YES") {
    const slope = L * Math.max(Phi(z0), 1e-9);
    z = z0 + (target - yOfZ(z0, L)) / slope;
  } else {
    const slope = L * Math.max(1 - Phi(z0), 1e-9);
    z = z0 - (target - xOfZ(z0, L)) / slope;
  }

  for (let iter = 0; iter < 60; iter++) {
    const f = side === "YES" ? yOfZ(z, L) - target : xOfZ(z, L) - target;
    if (Math.abs(f) < 1e-11 * Math.max(1, Math.abs(target))) return z;
    const fPrime = side === "YES" ? L * Phi(z) : L * (Phi(z) - 1);
    if (Math.abs(fPrime) < 1e-15) break;
    z = z - f / fPrime;
  }
  return z;
}

/** Pay `amount` USDC, receive Δ YES (or Δ NO). */
export function buy(
  xCurr: number,
  yCurr: number,
  side: "YES" | "NO",
  amount: number,
  L: number = DEFAULT_L,
): PmBuyResult {
  if (!(amount > 0)) throw new Error("pmAmm.buy: amount must be positive");

  // Lazy init: pool stored as (0, 0) means fresh round, seed at z=0.
  let x0 = xCurr;
  let y0 = yCurr;
  if (isUninitialized(x0, y0)) {
    const init = initialReserves(L);
    x0 = init.x;
    y0 = init.y;
  }

  const z0 = zOf(x0, y0, L);
  const targetSideReserve =
    side === "YES" ? yOfZ(z0, L) + amount : xOfZ(z0, L) + amount;
  const z1 = newtonSolveZ(z0, targetSideReserve, side, L);

  // Δ = L · |z1 − z0| with sign per side.
  const sharesBought = side === "YES" ? L * (z1 - z0) : L * (z0 - z1);

  const newX = xOfZ(z1, L);
  const newY = yOfZ(z1, L);

  return {
    sharesBought,
    cost: amount,
    newX,
    newY,
    newZ: z1,
    newPriceYes: Phi(z1),
    newPriceNo: 1 - Phi(z1),
    avgPrice: amount / sharesBought,
  };
}

/** Burn `shares` of `side`, receive proceeds in USDC. */
export function sell(
  xCurr: number,
  yCurr: number,
  side: "YES" | "NO",
  shares: number,
  L: number = DEFAULT_L,
): PmSellResult {
  if (!(shares > 0)) throw new Error("pmAmm.sell: shares must be positive");

  let x0 = xCurr;
  let y0 = yCurr;
  if (isUninitialized(x0, y0)) {
    const init = initialReserves(L);
    x0 = init.x;
    y0 = init.y;
  }

  const z0 = zOf(x0, y0, L);
  // Sell YES: z decreases by shares/L. Sell NO: z increases.
  const z1 = side === "YES" ? z0 - shares / L : z0 + shares / L;

  const newX = xOfZ(z1, L);
  const newY = yOfZ(z1, L);
  const proceeds = side === "YES" ? y0 - newY : x0 - newX;

  return {
    proceeds,
    sharesSold: shares,
    newX,
    newY,
    newZ: z1,
    newPriceYes: Phi(z1),
    newPriceNo: 1 - Phi(z1),
    avgPrice: proceeds / shares,
  };
}
