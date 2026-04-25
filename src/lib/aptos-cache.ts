/**
 * Aptos RPC view-call cache.
 *
 * In-memory TTL Map keyed by an arbitrary string (typically `kind:id`).
 * Designed to be wrapped around chain reads that don't change between
 * trades / spawns / settles — `readCaseState`, `get_active_market_in_group`,
 * user FA balances, etc.
 *
 * Properties:
 *   - TTL per entry (ms)
 *   - Stampede defense: concurrent misses share one in-flight Promise
 *   - LRU-ish eviction at MAX_ENTRIES (oldest expiresAt drops first)
 *   - Pattern invalidation (`prefix*` clears all keys under that prefix)
 *
 * Vercel Fluid Compute reuses lambda instances across invocations, so
 * a 60s TTL typically sees a high hit rate even though each cron tick
 * is a new HTTP request.
 *
 * Set `DEBUG_RPC_CACHE=1` to log every hit / miss / invalidation.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  inFlight?: Promise<T>;
}

const CACHE = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 500;

function debugEnabled(): boolean {
  return process.env.DEBUG_RPC_CACHE === "1";
}

function evictOldestIfNeeded(): void {
  if (CACHE.size <= MAX_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestExpires = Infinity;
  for (const [k, v] of CACHE) {
    if (v.expiresAt < oldestExpires) {
      oldestExpires = v.expiresAt;
      oldestKey = k;
    }
  }
  if (oldestKey) CACHE.delete(oldestKey);
}

/**
 * Cache wrapper for an async fetcher. Returns the cached value if it
 * hasn't expired; otherwise calls fetcher, stores, and returns. Concurrent
 * cache misses on the same key share one in-flight Promise.
 */
export async function cachedView<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = CACHE.get(key) as CacheEntry<T> | undefined;

  if (entry && entry.expiresAt > now) {
    if (debugEnabled()) console.log(`[cache-hit] ${key}`);
    return entry.value;
  }

  if (entry?.inFlight) {
    if (debugEnabled()) console.log(`[cache-stampede-share] ${key}`);
    return entry.inFlight;
  }

  if (debugEnabled()) console.log(`[cache-miss] ${key}`);
  const promise = fetcher().then(
    (value) => {
      CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
      evictOldestIfNeeded();
      return value;
    },
    (err) => {
      // On error, drop the in-flight marker so the next call retries.
      CACHE.delete(key);
      throw err;
    },
  );

  CACHE.set(key, {
    value: undefined as unknown as T,
    expiresAt: 0,
    inFlight: promise,
  });
  return promise;
}

/**
 * Invalidate one key (`"caseState:123"`) or a prefix (`"caseState:*"`).
 * Patterns are simple `prefix + *` form; `*` only allowed as final char.
 */
export function invalidateCache(pattern: string): void {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    let removed = 0;
    for (const key of Array.from(CACHE.keys())) {
      if (key.startsWith(prefix)) {
        CACHE.delete(key);
        removed++;
      }
    }
    if (debugEnabled())
      console.log(`[cache-invalidate-prefix] ${pattern} (${removed} removed)`);
    return;
  }
  const had = CACHE.delete(pattern);
  if (debugEnabled() && had) console.log(`[cache-invalidate] ${pattern}`);
}

/** Clear the entire cache. Test helper; not for production code paths. */
export function _clearCacheForTests(): void {
  CACHE.clear();
}

/** Snapshot for debugging. Test helper. */
export function _cacheStatsForTests(): { size: number; keys: string[] } {
  return { size: CACHE.size, keys: Array.from(CACHE.keys()) };
}
