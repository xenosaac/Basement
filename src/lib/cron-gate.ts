/**
 * Close-moment gate for cron routes.
 *
 * Vercel cron fires every minute (every-1-minute schedule), but rolling rounds only
 * close on aligned minutes:
 *   - 3-min cadence (BTC/ETH): :00 :03 :06 ... :57
 *   - 15-min cadence (SOL): :00 :15 :30 :45
 *   - 1-h / daily cadence (XAU/XAG/XPT/HYPE/MATIC/APT/forex/QQQ/Brent): :00
 *
 * On non-close minutes the cron has nothing to do — every group's active
 * case still has time remaining. Skipping early avoids ~80% of needless
 * Aptos RPC view calls (`get_active_market_in_group` × N groups).
 *
 * NOTE: when adding a new cadence in market-groups.ts (e.g. 5-min round),
 * extend the boolean below or callers will silently skip the new cadence's
 * close moment.
 */
export interface CloseMomentResult {
  isCloseMoment: boolean;
  /** Which cadence buckets this minute hits (debug). */
  hits: { c3min: boolean; c15min: boolean; c1h: boolean };
  minuteOfHour: number;
}

export function isCloseMoment(now: Date = new Date()): CloseMomentResult {
  const m = now.getUTCMinutes();
  const c3min = m % 3 === 0;
  const c15min = m % 15 === 0;
  const c1h = m === 0;
  return {
    isCloseMoment: c3min || c15min || c1h,
    hits: { c3min, c15min, c1h },
    minuteOfHour: m,
  };
}
