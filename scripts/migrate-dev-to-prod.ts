/**
 * One-shot migration: copy local dev data → Neon prod.
 *
 * What this moves:
 *   user_balances_v3, cases_v3 (filtered), positions_v3, orders_v3,
 *   faucet_claims_v3
 *
 * Skipped:
 *   - cases whose series_id is not in Neon's series_v3 (local-only series
 *     like sol-15m-strike-down were never seeded in prod)
 *   - positions/orders whose case row was skipped above
 *   - price_ticks_v3 (regenerates organically from cron tick)
 *
 * Idempotent — every insert uses ON CONFLICT DO NOTHING. Safe to re-run.
 *
 * Usage:
 *   vercel env pull .env.production.local --environment=production --yes
 *   set -a && source .env.production.local && set +a   # gives POSTGRES_URL
 *   npx tsx scripts/migrate-dev-to-prod.ts
 *   rm .env.production.local                            # contains secrets
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, inArray, and, eq } from "drizzle-orm";
import {
  casesV3,
  positionsV3,
  ordersV3,
  userBalancesV3,
  faucetClaimsV3,
  seriesV3,
} from "../src/db/schema";

const LOCAL_URL = "postgresql://isaaczhang@localhost:5432/basement";
const NEON_URL = process.env.POSTGRES_URL;

if (!NEON_URL) {
  console.error("❌ POSTGRES_URL not set. Run: vercel env pull .env.production.local --yes && source it");
  process.exit(1);
}
if (!NEON_URL.includes("neon.tech") && !NEON_URL.includes("vercel-storage")) {
  console.error(`❌ POSTGRES_URL doesn't look like Neon (${NEON_URL.slice(0, 40)}...). Aborting for safety.`);
  process.exit(1);
}

const localPool = new pg.Pool({ connectionString: LOCAL_URL });
const prodPool = new pg.Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false },
});
const local = drizzle(localPool);
const prod = drizzle(prodPool);

async function main() {
  console.log("=== migrate-dev-to-prod ===");
  console.log(`local: ${LOCAL_URL}`);
  console.log(`prod:  ${NEON_URL.slice(0, 50)}...`);
  console.log("");

  // ── 1. Series compatibility check ────────────────────────────────
  const localCaseSeries = await local
    .selectDistinct({ id: casesV3.seriesId })
    .from(casesV3);
  const prodSeries = await prod.select({ id: seriesV3.seriesId }).from(seriesV3);
  const prodSet = new Set(prodSeries.map((r) => r.id));

  const allowedSeries = localCaseSeries.filter((s) => prodSet.has(s.id)).map((s) => s.id);
  const droppedSeries = localCaseSeries.filter((s) => !prodSet.has(s.id)).map((s) => s.id);

  console.log(`series in prod: ${prodSet.size}`);
  console.log(`local cases reference ${localCaseSeries.length} series`);
  console.log(`  ✓ migratable: ${allowedSeries.join(", ")}`);
  if (droppedSeries.length > 0) {
    console.log(`  ✗ skipping (not in prod): ${droppedSeries.join(", ")}`);
  }
  console.log("");

  // ── 2. user_balances_v3 (no FK) ──────────────────────────────────
  const balances = await local.select().from(userBalancesV3);
  if (balances.length > 0) {
    await prod.insert(userBalancesV3).values(balances).onConflictDoNothing();
    console.log(`user_balances_v3: ${balances.length} rows pushed (ON CONFLICT DO NOTHING)`);
  } else {
    console.log("user_balances_v3: 0 rows in local, skipped");
  }

  // ── 3. cases_v3 (FK: series_v3) ──────────────────────────────────
  // Filter to migratable series only.
  const allCases = await local.select().from(casesV3);
  const cases = allCases.filter((c) => prodSet.has(c.seriesId));
  console.log(`cases_v3: ${cases.length}/${allCases.length} rows pass series filter`);
  if (cases.length > 0) {
    // Insert in chunks to avoid pg parameter-limit explosion (each row has ~25 params).
    const CHUNK = 100;
    for (let i = 0; i < cases.length; i += CHUNK) {
      const chunk = cases.slice(i, i + CHUNK);
      await prod.insert(casesV3).values(chunk).onConflictDoNothing();
    }
    console.log(`  pushed ${cases.length} cases`);
  }

  // Build set of (series, round) keys that survived for downstream filter.
  const caseKey = (s: string, r: number | bigint) => `${s}#${String(r)}`;
  const validCases = new Set(cases.map((c) => caseKey(c.seriesId, c.roundIdx)));

  // ── 4. positions_v3 (logical FK: cases + user) ───────────────────
  const allPositions = await local.select().from(positionsV3);
  const positions = allPositions.filter((p) => validCases.has(caseKey(p.seriesId, p.roundIdx)));
  console.log(`positions_v3: ${positions.length}/${allPositions.length} rows pass case filter`);
  if (positions.length > 0) {
    await prod.insert(positionsV3).values(positions).onConflictDoNothing();
    console.log(`  pushed ${positions.length} positions`);
  }

  // ── 5. orders_v3 (logical FK: cases + user, PK = orderId UUID) ───
  const allOrders = await local.select().from(ordersV3);
  const orders = allOrders.filter((o) => validCases.has(caseKey(o.seriesId, o.roundIdx)));
  console.log(`orders_v3: ${orders.length}/${allOrders.length} rows pass case filter`);
  if (orders.length > 0) {
    await prod.insert(ordersV3).values(orders).onConflictDoNothing();
    console.log(`  pushed ${orders.length} orders`);
  }

  // ── 6. faucet_claims_v3 (no FK enforcement) ──────────────────────
  const claims = await local.select().from(faucetClaimsV3);
  if (claims.length > 0) {
    await prod.insert(faucetClaimsV3).values(claims).onConflictDoNothing();
    console.log(`faucet_claims_v3: ${claims.length} rows pushed`);
  }

  console.log("");
  console.log("=== migration complete ===");
}

main()
  .catch((err) => {
    console.error("migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await localPool.end();
    await prodPool.end();
  });
