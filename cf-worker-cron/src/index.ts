// Basement cron trigger — Cloudflare Workers Cron Triggers fire on schedule
// and POST to the Vercel-hosted cron routes with Bearer auth. Substitutes
// for Vercel Hobby's missing minute-frequency cron support.
//
// Schedules (declared in wrangler.toml [triggers].crons):
//   "* * * * *"     → MINUTE_ROUTES (4 routes, every minute)
//   "* / 5 * * * *" → FIVE_MIN_ROUTES (eco-settle; written with spaces here
//                     because JSDoc terminator clashes with literal cron syntax)
//   "0 13 * * *"    → DAILY_ROUTES (eco-spawn at 13:00 UTC)
//
// Free tier budget: ~7.5k req/day = 7.5% of Cloudflare Workers free quota.

export interface Env {
  /** Production base URL of the Vercel deployment, e.g. https://basement.xiangliu.net */
  VERCEL_BASE: string;
  /** Same value as Vercel CRON_SECRET env var — used as Bearer token. */
  CRON_SECRET: string;
}

const MINUTE_ROUTES = [
  "/api/cron/tick",
  "/api/cron/spawn-recurring",
  "/api/cron/resolve-onchain",
  "/api/cron/indexer",
];

const FIVE_MIN_ROUTES = ["/api/cron/eco-settle"];

const DAILY_ROUTES = ["/api/cron/eco-spawn"];

interface FetchResultLog {
  path: string;
  status: number | "error";
  ms: number;
  detail?: string;
}

async function callRoute(
  base: string,
  path: string,
  secret: string,
): Promise<FetchResultLog> {
  const start = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      // Vercel function default timeout is 60s on Hobby; 30s here gives the
      // Worker headroom to log a clean failure rather than CF terminating.
      signal: AbortSignal.timeout(30_000),
    });
    return { path, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return {
      path,
      status: "error",
      ms: Date.now() - start,
      detail: (err as Error).message,
    };
  }
}

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    let routes: string[];
    switch (event.cron) {
      case "* * * * *":
        routes = MINUTE_ROUTES;
        break;
      case "*/5 * * * *":
        routes = FIVE_MIN_ROUTES;
        break;
      case "0 13 * * *":
        routes = DAILY_ROUTES;
        break;
      default:
        console.warn(`[cron] unknown schedule: ${event.cron}`);
        return;
    }

    const results = await Promise.all(
      routes.map((path) => callRoute(env.VERCEL_BASE, path, env.CRON_SECRET)),
    );

    // Single log line per tick (CF Workers Logs limit + cost-friendly).
    const summary = results.map((r) => `${r.path}=${r.status}(${r.ms}ms)`).join(" ");
    console.log(`[cron ${event.cron}] ${summary}`);

    const failures = results.filter((r) => r.status !== 200);
    if (failures.length > 0) {
      for (const f of failures) {
        console.error(
          `[cron-fail] ${f.path} status=${f.status} detail=${f.detail ?? "-"}`,
        );
      }
    }
  },
};
