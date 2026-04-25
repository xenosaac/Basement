/**
 * Quant module — Basement v0.5
 *
 * 单一目录承载所有数值/定价/做市相关代码：
 *   - pm-amm.ts       Paradigm pm-AMM static invariant + buy/sell quoter
 *   - v3-pricing.ts   cents↔shares E8 wrapper, BuyQuote/SellQuote/curvePrices
 *   - vol-estimator.ts (Phase B) realized vol from price_ticks_v3
 *   - barrier-strike.ts (Phase B) X = z·σ_tenor·k_fat
 *   - asset-params.ts (Phase B) per-asset σ_default/k_fat/clamp bps
 *   - macro-calendar.ts (Phase B) FOMC/CPI/NFP blackout windows
 *   - market-maker.ts (Phase B stub) future v1 quant engine interface
 *   - brent-rollover.ts (Phase C) front-month Brent feed id mapping
 *
 * Importers should `from "@/lib/quant"` and rely on the barrel below.
 */

export * from "./pm-amm";
export * from "./v3-pricing";
