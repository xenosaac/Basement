// Local dev parity for the /api/cron/tick endpoint that vercel.json runs in
// production. Run alongside `npm run dev` in a second terminal:
//
//   npx tsx watch scripts/dev-tick.ts
//
// Reads CRON_SECRET from .env / .env.local. Override URL/interval via
// DEV_TICK_URL / DEV_TICK_INTERVAL_MS env vars if needed.

import "dotenv/config";

const URL = process.env.DEV_TICK_URL ?? "http://localhost:3000/api/cron/tick";
const SECRET = process.env.CRON_SECRET ?? "";
const INTERVAL_MS = Number(process.env.DEV_TICK_INTERVAL_MS ?? 30_000);

if (!SECRET) {
  console.error("[dev-tick] CRON_SECRET missing — set it in .env.local");
  process.exit(1);
}

async function tick() {
  const startedAt = new Date().toISOString();
  try {
    const res = await fetch(URL, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const text = await res.text();
    let summary = text;
    try {
      const json = JSON.parse(text);
      summary = JSON.stringify({
        priceRefreshed: json.priceRefreshed,
        roundsSpawned: json.roundsSpawned?.length ?? 0,
        roundsResolved: json.roundsResolved?.length ?? 0,
        errors: json.errors?.length ?? 0,
      });
    } catch {
      // not JSON — keep raw text
    }
    console.log(`[dev-tick ${startedAt}] ${res.status} ${summary.slice(0, 240)}`);
  } catch (err) {
    console.error(`[dev-tick ${startedAt}] ${(err as Error).message}`);
  }
}

console.log(`[dev-tick] polling ${URL} every ${INTERVAL_MS}ms`);
void tick();
setInterval(tick, INTERVAL_MS);
