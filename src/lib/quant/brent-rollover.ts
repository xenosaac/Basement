/**
 * Brent front-month feed-id rollover (v0.5 Phase C).
 *
 * Pyth doesn't ship one canonical "Brent" feed — each delivery month is its
 * own feed id. The active contract changes monthly; if our cron keeps using
 * an expired month's feed id we'll start serving stale prices. This file is
 * the manual mapping of `YYYYMM` → `feed_id` (hermes-beta channel) plus a
 * 5-day pre-rollover buffer so the cron switches to the next month's feed
 * BEFORE the active contract expires.
 *
 * Operations:
 *   - Each month, fill the next entry in `BRENT_ROLLOVER_TABLE` from
 *     https://www.pyth.network/price-feeds (search "Brent YYYYMM").
 *   - For deployments where you'd rather override the table entirely (e.g.
 *     mainnet), set the env var `PYTH_BRENT_FRONT_MONTH_FEED_ID` — that
 *     wins over the table. See `src/lib/aptos.ts::pythBrentFrontMonthFeedId`.
 *
 * Discipline (per CLAUDE.md): hermes-beta channel only on Aptos testnet;
 * stable channel feed ids will throw `0x6507` at the Wormhole guardian
 * verifier.
 */

/**
 * `YYYYMM` → 64-char hex feed id (no `0x` prefix).
 *
 * Empty values are intentional — they signal "operations has not yet
 * filled this month". `resolveBrentFeedId` falls back to the env override
 * (`PYTH_BRENT_FRONT_MONTH_FEED_ID`) and only throws if BOTH are empty.
 *
 * Add new months at the END of the file's deploy cycle; do not delete past
 * months (keeps a rollover audit trail in git history).
 */
export const BRENT_ROLLOVER_TABLE: Record<string, string> = {
  // YYYYMM → 64-char feed id (no 0x prefix). TODO: ops to fill in.
  "202604": "",
  "202605": "",
  "202606": "",
  "202607": "",
  "202608": "",
  "202609": "",
};

/** Switch to the NEXT month's feed N seconds before the current month's
 *  contract is meant to expire. 5 days = comfortably before the typical
 *  Brent expiry window (last business day of the month before delivery). */
export const BRENT_ROLLOVER_BUFFER_SEC = 5 * 86_400;

/**
 * Compute the YYYYMM key for a given Unix-seconds timestamp in the
 * America/New_York timezone (matches our daily anchors). Pure function;
 * no side effects.
 */
export function yyyymmInNyTz(nowSec: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(nowSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}${get("month")}`;
}

/**
 * Resolve the Brent front-month Pyth feed id for the given moment.
 *
 * Resolution order:
 *   1. Env override `PYTH_BRENT_FRONT_MONTH_FEED_ID` (via the aptos.ts
 *      getter) — when set, wins over the table.
 *   2. `BRENT_ROLLOVER_TABLE[YYYYMM_with_buffer]` — looks ahead by
 *      `BRENT_ROLLOVER_BUFFER_SEC` so the cron rolls forward 5 days
 *      before the on-the-books expiry.
 *   3. Throws — operations needs to update the table or set the env.
 *
 * NOTE: This intentionally does NOT call into `aptos.ts` to read the env
 * override directly, to keep a one-way dependency edge from market-groups
 * → quant. The env override is read at the `pythFeedForGroup` boundary
 * (see `src/lib/market-groups.ts`).
 */
export function resolveBrentFeedId(nowSec: number): string {
  // 1. env override (read directly to keep this module standalone-testable).
  const envOverride =
    (process.env.PYTH_BRENT_FRONT_MONTH_FEED_ID || "").trim() ||
    (process.env.NEXT_PUBLIC_PYTH_BRENT_FRONT_MONTH_FEED_ID || "").trim();
  if (envOverride) return envOverride;

  // 2. table lookup with rollover buffer.
  const lookupSec = nowSec + BRENT_ROLLOVER_BUFFER_SEC;
  const key = yyyymmInNyTz(lookupSec);
  const fromTable = BRENT_ROLLOVER_TABLE[key];
  if (fromTable && fromTable.trim().length > 0) {
    return fromTable.trim();
  }

  // 3. nothing configured.
  throw new Error(
    `[brent-rollover] BRENT feed not configured for ${key}. ` +
      `Either set PYTH_BRENT_FRONT_MONTH_FEED_ID (env override) or add ` +
      `the entry to BRENT_ROLLOVER_TABLE in src/lib/quant/brent-rollover.ts.`,
  );
}
