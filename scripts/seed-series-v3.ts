/**
 * Seed series_v3 table from SERIES_CONFIG. One-time (idempotent via
 * onConflictDoNothing). Run with: `npx tsx scripts/seed-series-v3.ts`
 */
import "dotenv/config";
import { db } from "../src/db";
import { seriesV3 } from "../src/db/schema";
import { SERIES_CONFIG } from "../src/lib/series-config";

async function main() {
  const rows = SERIES_CONFIG.map((s) => ({
    seriesId: s.seriesId,
    assetSymbol: s.assetSymbol,
    pair: s.pair,
    category: s.category,
    cadenceSec: s.cadenceSec,
    pythFeedId: s.pythFeedId,
    seriesStartSec: s.seriesStartSec,
    marketHoursGated: s.marketHoursGated ? 1 : 0,
    feeBps: s.feeBps,
    sortOrder: s.sortOrder,
    isActive: 1,
  }));
  const inserted = await db
    .insert(seriesV3)
    .values(rows)
    .onConflictDoNothing()
    .returning({ seriesId: seriesV3.seriesId });
  console.log(
    `Seeded ${inserted.length} series (${rows.length - inserted.length} already existed).`,
  );
  for (const s of SERIES_CONFIG) {
    console.log(`  ${s.seriesId}  ${s.pair}  ${s.cadenceSec}s  ${s.category}`);
  }
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
