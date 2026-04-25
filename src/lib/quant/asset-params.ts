/**
 * Per-asset quant defaults — Basement v0.5 Phase B.
 *
 * Single source for fallback σ (annualised, realized-vol estimator can't
 * trust < 5 samples), tail-fattening multiplier `kFat`, and clamp range
 * `[minStrikeBps, maxStrikeBps]` used by `computeBarrierStrike`.
 *
 * Lookup order in `getAssetParams(idOrSeries)`:
 *   1. Upper-case the input.
 *   2. Direct match against ASSET_PARAMS keys ("BTC", "EURUSD"...).
 *   3. Take prefix before first "-" and try again ("btc-usdc-3m" → "BTC").
 *   4. Otherwise throw — callers must register new assets here first.
 *
 * Numbers are calibrated for ~80% expected seller win-rate at z=1.28 (the
 * one-tail 90% quantile). See plan §"最终决策" — "Strike 计算".
 */

import type { AssetParams } from "./types";

export const ASSET_PARAMS: Record<string, AssetParams> = {
  // ─── Crypto / 高波动 ─────────────────────────────────
  BTC:    { asset: "BTC",    defaultSigmaAnnual: 0.45, kFat: 1.10, minStrikeBps: 20, maxStrikeBps: 80  },
  ETH:    { asset: "ETH",    defaultSigmaAnnual: 0.65, kFat: 1.10, minStrikeBps: 30, maxStrikeBps: 90  },
  SOL:    { asset: "SOL",    defaultSigmaAnnual: 0.85, kFat: 1.10, minStrikeBps: 40, maxStrikeBps: 120 },
  HYPE:   { asset: "HYPE",   defaultSigmaAnnual: 1.20, kFat: 1.10, minStrikeBps: 60, maxStrikeBps: 250 },
  MATIC:  { asset: "MATIC",  defaultSigmaAnnual: 0.95, kFat: 1.10, minStrikeBps: 50, maxStrikeBps: 200 },
  APT:    { asset: "APT",    defaultSigmaAnnual: 1.00, kFat: 1.10, minStrikeBps: 50, maxStrikeBps: 200 },

  // ─── Commodity ───────────────────────────────────────
  XAU:    { asset: "XAU",    defaultSigmaAnnual: 0.16, kFat: 1.05, minStrikeBps: 8,  maxStrikeBps: 40  },
  XAG:    { asset: "XAG",    defaultSigmaAnnual: 0.28, kFat: 1.05, minStrikeBps: 12, maxStrikeBps: 60  },
  XPT:    { asset: "XPT",    defaultSigmaAnnual: 0.22, kFat: 1.05, minStrikeBps: 10, maxStrikeBps: 50  },
  BRENT:  { asset: "BRENT",  defaultSigmaAnnual: 0.40, kFat: 1.05, minStrikeBps: 15, maxStrikeBps: 80  },

  // ─── Stocks (QQQ ETF proxy for NDX) ──────────────────
  QQQ:    { asset: "QQQ",    defaultSigmaAnnual: 0.20, kFat: 1.10, minStrikeBps: 10, maxStrikeBps: 60  },

  // ─── Forex (24/5) ────────────────────────────────────
  // Bare currency entries (legacy single-currency lookups).
  EUR:    { asset: "EUR",    defaultSigmaAnnual: 0.08, kFat: 1.05, minStrikeBps: 5,  maxStrikeBps: 30  },
  USD:    { asset: "USD",    defaultSigmaAnnual: 0.10, kFat: 1.05, minStrikeBps: 5,  maxStrikeBps: 30  },
  // Pair-form lookups for series ids like "eurusd-1h-up". Plan §"FX 资产" calls
  // out adding these explicitly because the split-on-dash heuristic produces
  // "EURUSD" / "USDJPY" / "USDCNH" which won't match bare currency keys.
  EURUSD: { asset: "EURUSD", defaultSigmaAnnual: 0.08, kFat: 1.05, minStrikeBps: 5,  maxStrikeBps: 30  },
  USDJPY: { asset: "USDJPY", defaultSigmaAnnual: 0.10, kFat: 1.05, minStrikeBps: 5,  maxStrikeBps: 30  },
  USDCNH: { asset: "USDCNH", defaultSigmaAnnual: 0.10, kFat: 1.05, minStrikeBps: 5,  maxStrikeBps: 30  },
};

/**
 * Resolve `idOrSeries` (case-insensitive, accepts series ids like
 * "btc-usdc-3m" or bare symbols like "BTC") to its ASSET_PARAMS row.
 * Throws if neither a direct match nor a prefix match succeeds.
 */
export function getAssetParams(idOrSeries: string): AssetParams {
  if (!idOrSeries) {
    throw new Error("getAssetParams: empty input");
  }
  const upper = idOrSeries.toUpperCase();
  const direct = ASSET_PARAMS[upper];
  if (direct) return direct;

  const head = upper.split("-")[0];
  const headMatch = ASSET_PARAMS[head];
  if (headMatch) return headMatch;

  throw new Error(`getAssetParams: unknown asset "${idOrSeries}"`);
}
