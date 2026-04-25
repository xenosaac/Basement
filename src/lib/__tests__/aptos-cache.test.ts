import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cachedView,
  invalidateCache,
  _clearCacheForTests,
  _cacheStatsForTests,
} from "@/lib/aptos-cache";

describe("aptos-cache", () => {
  beforeEach(() => {
    _clearCacheForTests();
  });

  it("returns cached value on second call within TTL", async () => {
    const fetcher = vi.fn(async () => ({ caseId: 1n, state: "OPEN" }));
    const a = await cachedView("test:1", 60_000, fetcher);
    const b = await cachedView("test:1", 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("re-fetches after TTL expires", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const v1 = await cachedView("test:ttl", 1, fetcher);
    await new Promise((r) => setTimeout(r, 5));
    const v2 = await cachedView("test:ttl", 1, fetcher);
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares in-flight Promise on concurrent misses (stampede defense)", async () => {
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { v: "ok" };
    };
    const [a, b, c] = await Promise.all([
      cachedView("stampede", 60_000, slow),
      cachedView("stampede", 60_000, slow),
      cachedView("stampede", 60_000, slow),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("drops in-flight entry on fetcher error so next call retries", async () => {
    let attempts = 0;
    const flaky = async () => {
      attempts++;
      if (attempts === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cachedView("flaky", 60_000, flaky)).rejects.toThrow("boom");
    const v = await cachedView("flaky", 60_000, flaky);
    expect(v).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("invalidateCache removes a single key", async () => {
    const fetcher = vi.fn(async () => "v");
    await cachedView("k:1", 60_000, fetcher);
    invalidateCache("k:1");
    await cachedView("k:1", 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidateCache(prefix*) removes all matching keys", async () => {
    const fetcher = vi.fn(async (n: number) => `v${n}`);
    await cachedView("group:a", 60_000, () => fetcher(1));
    await cachedView("group:b", 60_000, () => fetcher(2));
    await cachedView("other:c", 60_000, () => fetcher(3));
    expect(_cacheStatsForTests().size).toBe(3);
    invalidateCache("group:*");
    const after = _cacheStatsForTests();
    expect(after.size).toBe(1);
    expect(after.keys).toEqual(["other:c"]);
  });

  it("eviction does not corrupt smaller caches", async () => {
    // Just verify the no-evict path stays sane under heavy use
    for (let i = 0; i < 100; i++) {
      await cachedView(`fill:${i}`, 60_000, async () => i);
    }
    expect(_cacheStatsForTests().size).toBe(100);
  });
});
