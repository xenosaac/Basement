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
export * from "./types";
export * from "./asset-params";
export * from "./barrier-strike";
export * from "./macro-calendar";
export * from "./market-maker";

// NB: vol-estimator.ts intentionally NOT re-exported here. It imports the
// Drizzle/`pg` DB client which is server-only — re-exporting it pulls `pg`
// into the client bundle (`tls`/`net` build errors). Server callers import
// it directly:  import { computeRealizedVol7d } from "@/lib/quant/vol-estimator";
