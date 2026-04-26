/**
 * Seed series_v3 table. One-time (idempotent via onConflictDoNothing).
 * Run with: `npx tsx scripts/seed-series-v3.ts`
 *
 * Two layers:
 *   1. Legacy SERIES_CONFIG rows (BTC/ETH 3m + the old qqq-usdc-1d row).
 *      These predate the v0.5 dynamic-strike registry — kept for backward
 *      compatibility with installs that pin to the old seriesId scheme.
 *   2. v0.5 dynamic-strike rows whose seriesId == groupId (Phase D
 *      convention). For these we seed strikeKind / groupId so a fresh DB
 *      can render barrier questions immediately, without waiting for
 *      `ensureSeriesV3RowForGroup` to lazy-create on the first spawn.
 */
import "dotenv/config";
import { db } from "../src/db";
import { seriesV3 } from "../src/db/schema";
import {
  SERIES_CONFIG,
  SERIES_START_ANCHOR_SEC,
  resolveSeriesFeedId,
} from "../src/lib/series-config";
import { pythFeedIdForSymbol } from "../src/lib/aptos";

/** v0.5 dynamic-strike series seed. seriesId == groupId by convention.
 *  Active flag here mirrors `MARKET_GROUPS[].active` — the registry stays
 *  the source of truth at runtime; this just pre-populates DB rows so a
 *  fresh dev environment doesn't depend on the cron lazy-create path. */
interface DynamicStrikeSeed {
  seriesId: string;
  groupId: string;
  assetSymbol: string;
  pair: string;
  category: "quick_play" | "commodity" | "stocks" | "crypto_ext";
  cadenceSec: number;
  durationSec: number;
  marketHoursGated: 0 | 1;
  strikeKind: "absolute_above" | "absolute_below" | "barrier_two_sided";
  active: 0 | 1;
  sortOrder: number;
}

const DYNAMIC_STRIKE_SEEDS: readonly DynamicStrikeSeed[] = [
  {
    // SOL 15m strike — already active in market-groups (Phase D batch 1).
    seriesId: "sol-15m-strike-up",
    groupId: "sol-15m-strike-up",
    assetSymbol: "SOL",
    pair: "SOL/USDC",
    category: "quick_play",
    cadenceSec: 15 * 60,
    durationSec: 15 * 60,
    marketHoursGated: 0,
    strikeKind: "absolute_above",
    active: 1,
    sortOrder: 3,
  },
  {
    seriesId: "hype-1h-up",
    groupId: "hype-1h-up",
    assetSymbol: "HYPE",
    pair: "HYPE/USDC",
    category: "crypto_ext",
    cadenceSec: 60 * 60,
    durationSec: 60 * 60,
    marketHoursGated: 0,
    strikeKind: "absolute_above",
    active: 1,
    sortOrder: 7,
  },
  {
    seriesId: "xau-1h-up",
    groupId: "xau-1h-up",
    assetSymbol: "XAU",
    pair: "XAU/USDC",
    category: "commodity",
    cadenceSec: 60 * 60,
    durationSec: 60 * 60,
    marketHoursGated: 0, // XAU spot 24/5; no hard gate
    strikeKind: "absolute_above",
    active: 1,
    sortOrder: 4,
  },
  {
    seriesId: "xag-1h-up",
    groupId: "xag-1h-up",
    assetSymbol: "XAG",
    pair: "XAG/USDC",
    category: "commodity",
    cadenceSec: 60 * 60,
    durationSec: 60 * 60,
    marketHoursGated: 0,
    strikeKind: "absolute_above",
    active: 1,
    sortOrder: 5,
  },
  {
    // QQQ tracked as breakdown only (user spec 2026-04-25).
    seriesId: "qqq-1d-down",
    groupId: "qqq-1d-down",
    assetSymbol: "QQQ",
    pair: "QQQ/USDC",
    category: "stocks",
    cadenceSec: 24 * 60 * 60,
    durationSec: 24 * 60 * 60,
    marketHoursGated: 1, // RTH-only via NYSE gate
    strikeKind: "absolute_below",
    active: 1,
    sortOrder: 8,
  },
  {
    // NVDA breakdown — added 2026-04-25 to fill the 8-card stocks tab.
    seriesId: "nvda-1d-down",
    groupId: "nvda-1d-down",
    assetSymbol: "NVDA",
    pair: "NVDA/USDC",
    category: "stocks",
    cadenceSec: 24 * 60 * 60,
    durationSec: 24 * 60 * 60,
    marketHoursGated: 1,
    strikeKind: "absolute_below",
    active: 1,
    sortOrder: 9,
  },
];

/** Resolve feed id for a dynamic-strike seed by asset. Returns "" for
 *  assets without an env mapping (e.g. NVDA pre-Slot-C); the column is
 *  notNull so we tolerate this with an empty string and let the live
 *  resolver (`pythFeedIdForSymbol`) take over at runtime once env is set. */
function resolveSeedFeedId(assetSymbol: string): string {
  return pythFeedIdForSymbol(assetSymbol) ?? "";
}

async function main() {
  // Snapshot the env-resolved feed id at seed time. Live consumers
  // (cron/tick, /api/series) re-resolve via env on every read, so the
  // DB column is just a bootstrap convenience for cold starts.
  // Legacy rows: BTC/ETH 3m directional (rise_fall semantics — strikeKind NULL).
  // The historical qqq-usdc-1d row is folded in as inactive: QQQ moved to the
  // dynamic-strike `qqq-1d-down` seriesId (see DYNAMIC_STRIKE_SEEDS below).
  const legacyRows = SERIES_CONFIG.map((s) => {
    const isRetiredQqq = s.seriesId === "qqq-usdc-1d";
    return {
      seriesId: s.seriesId,
      assetSymbol: s.assetSymbol,
      pair: s.pair,
      category: s.category,
      cadenceSec: s.cadenceSec,
      pythFeedId: resolveSeriesFeedId(s),
      seriesStartSec: s.seriesStartSec,
      marketHoursGated: s.marketHoursGated ? 1 : 0,
      feeBps: s.feeBps,
      sortOrder: s.sortOrder,
      isActive: isRetiredQqq ? 0 : 1,
    };
  });

  const dynamicRows = DYNAMIC_STRIKE_SEEDS.map((d) => ({
    seriesId: d.seriesId,
    assetSymbol: d.assetSymbol,
    pair: d.pair,
    category: d.category,
    cadenceSec: d.cadenceSec,
    pythFeedId: resolveSeedFeedId(d.assetSymbol),
    seriesStartSec: SERIES_START_ANCHOR_SEC,
    marketHoursGated: d.marketHoursGated,
    feeBps: 200,
    sortOrder: d.sortOrder,
    isActive: d.active,
    groupId: d.groupId,
    durationSecHint: d.durationSec,
    strikeKind: d.strikeKind,
    kind: "rolling" as const,
  }));

  const allRows = [...legacyRows, ...dynamicRows];
  const inserted = await db
    .insert(seriesV3)
    .values(allRows)
    .onConflictDoNothing()
    .returning({ seriesId: seriesV3.seriesId });
  console.log(
    `Seeded ${inserted.length} series (${allRows.length - inserted.length} already existed).`,
  );
  for (const s of SERIES_CONFIG) {
    console.log(`  ${s.seriesId}  ${s.pair}  ${s.cadenceSec}s  ${s.category}`);
  }
  for (const d of DYNAMIC_STRIKE_SEEDS) {
    console.log(
      `  ${d.seriesId}  ${d.pair}  ${d.cadenceSec}s  ${d.category}  ${d.strikeKind}${d.active === 0 ? "  [inactive]" : ""}`,
    );
  }
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
