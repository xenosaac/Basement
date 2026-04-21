/**
 * Next.js instrumentation — runs once on server startup.
 * Sets up a background interval that calls /api/cron/resolve every 2 minutes
 * to auto-resolve expired markets and create new recurring rounds.
 *
 * CRITICAL: must skip during build phase. `next build` also invokes register();
 * a lingering setInterval keeps the build process alive indefinitely, pegging CPU
 * as the interval retries fetch() against a non-existent server.
 */

// Module-level guard — prevents double-register if Next invokes twice
let cronRegistered = false;

export async function register() {
  // Only run in the Node.js server runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skip during build phase — setInterval would hold the build hostage
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Skip if already registered (belt-and-suspenders against double-invocation)
  if (cronRegistered) return;
  cronRegistered = true;

  const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
  const CRON_SECRET = process.env.CRON_SECRET ?? "";
  const PORT = process.env.PORT ?? "3000";
  const BASE_URL = `http://localhost:${PORT}`;

  // Wait for server to be ready before first call
  setTimeout(async () => {
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/cron/resolve`, {
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
        });
        if (res.ok) {
          const data = await res.json();
          console.log(
            `[cron] Auto-resolve: recurring=${data.recurring?.resolved ?? 0}/${data.recurring?.created ?? 0}`
          );
        }
      } catch {
        // Server not ready yet or network error — silent, will retry
      }
    };

    await tick(); // First run
    setInterval(tick, INTERVAL_MS); // Then every 2 minutes
  }, 5000); // 5s delay for server startup
}
