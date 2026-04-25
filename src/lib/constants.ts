export const FAUCET_AMOUNT = 50;
export const FAUCET_COOLDOWN_SECONDS = 86400;
export const AMM_SMOOTHING_K = 1;
export const INITIAL_DEMAND = 1;

/**
 * pm-AMM liquidity parameter L (dollars). Paradigm's static pm-AMM uses L
 * as the scaling parameter in the invariant
 *   (y-x)·Φ((y-x)/L) + L·φ((y-x)/L) - y = 0
 * Larger L = deeper liquidity, smaller price impact per trade, larger
 * initial reserves (x₀ = y₀ = L/√(2π)). Tune via env for deeper feel.
 */
export const PM_AMM_L_DOLLARS = Number(process.env.PM_AMM_L_DOLLARS ?? 100);
export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
export const CRON_SECRET = process.env.CRON_SECRET ?? "";

// Aptos auth constants.
// Testnet chain id is 2 per Aptos testnet genesis. T4 will fetch this
// dynamically via `aptos.getLedgerInfo()` and cross-check at startup;
// this constant is the fallback / expected value.
export const APTOS_AUTH_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_APTOS_CHAIN_ID ?? "2",
);
export const APTOS_NETWORK = (
  process.env.NEXT_PUBLIC_APTOS_NETWORK ?? "testnet"
).toLowerCase();
export const AUTH_STATEMENT = "Sign in to Basement";

/** Chain id used in the 5-field auth message (red line R-4). */
export function getAuthChainId(): number {
  return APTOS_AUTH_CHAIN_ID;
}

/** Domain bound into the auth message. Server side uses request host;
 *  client side uses window.location.host. This getter is a fallback for
 *  server-only code paths that don't have a request in scope. */
export function getAuthDomain(): string {
  return process.env.NEXT_PUBLIC_AUTH_DOMAIN ?? "basement.localhost";
}

// Recurring markets
export const RECURRING_DURATION_MINUTES = 3;
export const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
export const BTC_STRIKE_ROUNDING = 500;
export const ETH_STRIKE_ROUNDING = 25;
