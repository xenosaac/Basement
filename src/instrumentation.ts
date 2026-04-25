/**
 * Next.js instrumentation — runs once on server startup (dev + `next start`).
 * Self-scheduling setTimeout chain: each tick calls resolve-onchain then
 * spawn-recurring, reads the earliest upcoming `close_time` from the
 * responses, and schedules the next tick to fire just after that moment.
 *
 * Production Vercel serverless does not run long-lived timers — the
 * `vercel.json` cron at every-minute schedule is the independent backstop.
 *
 * CRITICAL: must skip during build phase. `next build` also invokes register().
 */

let cronRegistered = false;

const STARTUP_DELAY_MS = 5_000;
const FALLBACK_DELAY_MS = 60_000; // when nextCloseTime is null
const ERROR_RETRY_MS = 30_000;    // when tick throws
const MIN_DELAY_MS = 1_000;       // prevent busy loop
const MAX_DELAY_MS = 3 * 60_000;  // 3min safety cap
const POST_CLOSE_BUFFER_MS = 500;

interface ResolveResp {
  resolved?: unknown[];
  skipped?: unknown[];
  nextCloseTime?: number | null;
}
interface SpawnResp {
  spawned?: unknown[];
  skipped?: unknown[];
  nextCloseTime?: number | null;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Opt-out for local dev: skip the auto-refresh tick chain entirely.
  // Production Vercel never sees this code path (instrumentation runs once
  // per server boot; Vercel cron is the source of truth there).
  if (process.env.DISABLE_DEV_CRON === "1") {
    console.log(
      "[cron] dev auto-refresh disabled via DISABLE_DEV_CRON=1 — Vercel cron still runs in production",
    );
    return;
  }
  if (cronRegistered) return;
  cronRegistered = true;

  const CRON_SECRET = process.env.CRON_SECRET ?? "";
  const PORT = process.env.PORT ?? "3000";
  const BASE_URL = `http://localhost:${PORT}`;
  const auth = { Authorization: `Bearer ${CRON_SECRET}` };

  const runOnce = async (): Promise<void> => {
    let nextCloseTime: number | null = null;
    try {
      const r1 = await fetch(`${BASE_URL}/api/cron/resolve-onchain`, { headers: auth });
      if (r1.ok) {
        const d = (await r1.json()) as ResolveResp;
        console.log(
          `[cron] resolve-onchain: resolved=${d.resolved?.length ?? 0} skipped=${d.skipped?.length ?? 0}`
        );
        if (typeof d.nextCloseTime === "number") nextCloseTime = d.nextCloseTime;
      }
    } catch {
      /* server not ready / RPC hiccup — fall through to spawn */
    }

    try {
      const r2 = await fetch(`${BASE_URL}/api/cron/spawn-recurring`, { headers: auth });
      if (r2.ok) {
        const d = (await r2.json()) as SpawnResp;
        console.log(
          `[cron] spawn-recurring: spawned=${d.spawned?.length ?? 0} skipped=${d.skipped?.length ?? 0}`
        );
        // spawn runs after resolve; its nextCloseTime is more authoritative
        if (typeof d.nextCloseTime === "number") nextCloseTime = d.nextCloseTime;
      }
    } catch {
      /* ditto */
    }

    let delayMs: number;
    if (nextCloseTime === null) {
      delayMs = FALLBACK_DELAY_MS;
    } else {
      const nowMs = Date.now();
      delayMs = nextCloseTime * 1000 - nowMs + POST_CLOSE_BUFFER_MS;
    }
    delayMs = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, delayMs));
    console.log(
      `[tick] next in ${Math.round(delayMs / 1000)}s${
        nextCloseTime !== null ? ` (nextCloseTime=${nextCloseTime})` : " (fallback)"
      }`
    );
    scheduleNextTick(delayMs);
  };

  const scheduleNextTick = (delayMs: number): void => {
    setTimeout(() => {
      runOnce().catch((err) => {
        console.error(`[tick] error: ${(err as Error).message}; retrying in ${ERROR_RETRY_MS / 1000}s`);
        scheduleNextTick(ERROR_RETRY_MS);
      });
    }, delayMs);
  };

  scheduleNextTick(STARTUP_DELAY_MS);
}
