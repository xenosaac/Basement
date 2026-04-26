/**
 * Pyth Hermes REST client for Basement v3 — fetches the latest batch of
 * price updates for configured Pyth feeds. Used by the cron/tick endpoint
 * to refresh prices every 30s.
 *
 * Hermes endpoints:
 *   - Mainnet/stable: https://hermes.pyth.network
 *   - Testnet/beta:   https://hermes-beta.pyth.network
 *
 * Batch call: `/v2/updates/price/latest?ids[]=FEED1&ids[]=FEED2&...`
 * Returns a single Wormhole-signed VAA containing N price updates +
 * parsed price/confidence/exponent per feed.
 */

export interface PythPriceTick {
  feedId: string; // 64-char hex, no 0x
  priceE8: bigint; // price scaled to the feed's native exponent (usually -8)
  conf: bigint; // confidence interval, same exponent
  expo: number; // should be -8 for crypto
  publishTimeSec: number;
}

export interface HermesBatchResponse {
  binary: {
    encoding: "base64" | "hex";
    data: string[];
  };
  parsed: Array<{
    id: string;
    price: {
      price: string;
      conf: string;
      expo: number;
      publish_time: number;
    };
    ema_price?: {
      price: string;
      conf: string;
      expo: number;
      publish_time: number;
    };
    metadata?: { slot?: number };
  }>;
}

function hermesBase(): string {
  return (
    process.env.PYTH_HERMES_URL ||
    process.env.NEXT_PUBLIC_PYTH_HERMES_URL ||
    "https://hermes-beta.pyth.network"
  );
}

/** Canonical lookup against a priceMap returned by `fetchPythBatchPrices`.
 *  The map is keyed by lowercase feedId without the `0x` prefix; callers may
 *  pass a feedId in either form. Always go through this helper to avoid the
 *  silent miss that froze the v3 resolve loop. */
export function lookupTick(
  map: Map<string, PythPriceTick>,
  feedId: string,
): PythPriceTick | undefined {
  return map.get(feedId.toLowerCase().replace(/^0x/, ""));
}

/**
 * Resilient batch fetch — wraps `fetchPythBatchPrices` with auto-retry on
 * partial response. Hermes-beta sometimes returns 200 with `parsed[]` short
 * a few feeds (TradFi feeds XAU/XAG/QQQ/NVDA disproportionately), and the
 * silent miss historically left `price_ticks_v3` empty for those assets even
 * while spawn-recurring's separate retry path kept them tradable.
 *
 * Strategy: re-fetch only the feeds still missing, up to `maxRetries` extra
 * attempts. Returns a merged map; persistent misses are warned (not thrown)
 * so the caller can still use whatever did come back.
 */
export async function fetchPythBatchPricesResilient(
  feedIds: string[],
  maxRetries = 2,
): Promise<Map<string, PythPriceTick>> {
  const merged = new Map<string, PythPriceTick>();
  let remaining = feedIds.slice();
  for (let attempt = 0; attempt <= maxRetries && remaining.length > 0; attempt++) {
    const batch = await fetchPythBatchPrices(remaining);
    for (const [k, v] of batch) merged.set(k, v);
    remaining = feedIds.filter(
      (id) => !merged.has(id.toLowerCase().replace(/^0x/, "")),
    );
  }
  if (remaining.length > 0) {
    console.warn(
      `[pyth-hermes] partial response after ${maxRetries + 1} attempts: ` +
        `${remaining.length} feed(s) still missing — ${remaining.join(", ")}`,
    );
  }
  return merged;
}

/** Fetch latest Pyth price for N feed IDs in one batch call.
 *  Returns a map keyed by feed_id (lowercase, no 0x). */
export async function fetchPythBatchPrices(
  feedIds: string[],
  options?: { signal?: AbortSignal },
): Promise<Map<string, PythPriceTick>> {
  if (feedIds.length === 0) return new Map();
  const base = hermesBase();
  const qs = feedIds
    .map((id) => `ids%5B%5D=${id.toLowerCase().replace(/^0x/, "")}`)
    .join("&");
  const url = `${base}/v2/updates/price/latest?${qs}&encoding=base64`;

  const res = await fetch(url, {
    signal: options?.signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Hermes ${res.status}: ${await res.text().catch(() => res.statusText)}`,
    );
  }
  const body = (await res.json()) as HermesBatchResponse;
  const out = new Map<string, PythPriceTick>();
  for (const row of body.parsed ?? []) {
    const id = row.id.toLowerCase().replace(/^0x/, "");
    out.set(id, {
      feedId: id,
      priceE8: BigInt(row.price.price),
      conf: BigInt(row.price.conf),
      expo: row.price.expo,
      publishTimeSec: row.price.publish_time,
    });
  }
  return out;
}

/**
 * Convert a Pyth e8 price into cents (integer, 2 decimals).
 * USDC uses 6 decimals on-chain but we keep DB/API in cents for simplicity.
 *   price_e8 = raw * 10^(-expo), assume expo = -8
 *   usd = price_e8 / 1e8
 *   cents = round(usd * 100) = round(price_e8 / 1e6)
 */
export function pythE8ToCents(priceE8: bigint, expo: number): bigint {
  // Normalize to expo = -8 if different
  if (expo === -8) return priceE8 / 1_000_000n;
  if (expo === -6) return priceE8 / 10_000n;
  if (expo === -5) return priceE8 / 1_000n;
  if (expo === -4) return priceE8 / 100n;
  // Generic
  const factor = Math.pow(10, -expo - 2); // scaling so result is cents
  if (factor >= 1) return priceE8 / BigInt(Math.round(factor));
  return priceE8 * BigInt(Math.round(1 / factor));
}

/** Simple in-memory cache with TTL — survives across Vercel serverless
 *  warm invocations but not cold starts. Good enough for 30s cadence. */
const TICK_CACHE = new Map<string, { tick: PythPriceTick; expiresAt: number }>();

export async function getCachedPrice(
  feedId: string,
  ttlMs = 20_000,
): Promise<PythPriceTick | null> {
  const key = feedId.toLowerCase().replace(/^0x/, "");
  const hit = TICK_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.tick;
  try {
    const batch = await fetchPythBatchPrices([key]);
    const tick = batch.get(key);
    if (tick) {
      TICK_CACHE.set(key, { tick, expiresAt: Date.now() + ttlMs });
    }
    return tick ?? null;
  } catch {
    return hit?.tick ?? null; // stale-OK on error
  }
}
