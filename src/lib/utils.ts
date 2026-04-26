export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format the time remaining until `closeTime`. Pass a live `nowMs` for a
 * countdown that ticks every second (callers should re-render via a state
 * that updates from `setInterval`); omit it for a static snapshot.
 *
 * Scale-aware output:
 *   > 24h → "Xd Yh"           (XAU-daily when fresh)
 *   >= 1h → "Xh Ym Zs"        (XAU-daily mid-life)
 *   <  1h → "Ym Zs"           (BTC/ETH 3-min, XAU last hour)
 *   <= 0  → "Closed"
 */
export function timeRemaining(
  closeTime: string | null,
  nowMs: number = Date.now(),
): string {
  if (!closeTime) return "No deadline";
  const diff = new Date(closeTime).getTime() - nowMs;
  if (diff <= 0) return "Closed";
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * v3 product framing: prediction market = YES/NO on a question.
 * Internal BetSide "UP" | "DOWN" maps to YES / NO labels:
 *   - Side "UP" → Price will rise → YES on "will rise"
 *   - Side "DOWN" → Price will not rise → NO on "will rise"
 *
 * Engine math unchanged; this is label-only for the UI.
 */
export function sideLabel(side: "UP" | "DOWN"): "YES" | "NO" {
  return side === "UP" ? "YES" : "NO";
}

export function outcomeLabel(
  outcome: "UP" | "DOWN" | "INVALID" | null,
): "YES" | "NO" | "VOID" | null {
  if (!outcome) return null;
  if (outcome === "INVALID") return "VOID";
  return outcome === "UP" ? "YES" : "NO";
}

/**
 * Render the question for a series round.
 *
 * v0.5 barrier-rollout: the question copy now branches on `strikeKind`:
 *   - `rise_fall` (or undefined / null)  → "Will X rise in the next N?"
 *     Preserves legacy BTC/ETH 3-min copy. This is the safe default for any
 *     caller that hasn't been updated to pass strikeKind yet.
 *   - `absolute_above` + strike known    → "Will X break above $Y in the next N?"
 *   - `absolute_below` + strike known    → "Will X break below $Y in the next N?"
 *   - `absolute_*` but strike not yet captured (pre-spawn / NULL) →
 *     "Will X break {above|below} a dynamic level in the next N?" so we never
 *     surface "$NaN" / "$undefined".
 *
 * `strikePriceE8` is the case row's `strike_price_e8` column. DESPITE the
 * "e8" name, the value is stored at the feed's native expo (XAU: -3,
 * QQQ/NVDA: -5, crypto: -8) — not at e-8. The "e8" suffix is a historical
 * naming bug we keep for backwards compat with the schema column.
 *
 * Caller MUST pass `priceExpo` so the formatter can divide by 10^|priceExpo|.
 * Slot F-2 (spawn-helpers) writes at feed expo; Slot F-3 (this file) reads
 * at feed expo.
 */
export function renderSeriesQuestion(opts: {
  pair: string; // e.g. "BTC/USDC"
  cadenceSec: number;
  strikeKind?: "rise_fall" | "absolute_above" | "absolute_below" | null;
  strikePriceE8?: string | bigint | null;
  priceExpo?: number;
}): string {
  const asset = opts.pair.split("/")[0] ?? opts.pair;
  const readable =
    opts.cadenceSec >= 86400
      ? `${Math.round(opts.cadenceSec / 86400)}-day`
      : opts.cadenceSec >= 3600
        ? `${Math.round(opts.cadenceSec / 3600)}-hour`
        : `${Math.round(opts.cadenceSec / 60)}-min`;

  const kind = opts.strikeKind ?? "rise_fall";
  if (kind === "rise_fall") {
    return `Will ${asset} rise in the next ${readable}?`;
  }

  const direction = kind === "absolute_above" ? "above" : "below";
  const formatted = formatStrikeFromE8(opts.strikePriceE8, opts.priceExpo ?? -8);
  if (
    process.env.NODE_ENV !== "production" &&
    opts.priceExpo === undefined &&
    opts.strikePriceE8 != null
  ) {
    // dev-only nudge: caller hasn't migrated to pass priceExpo
    console.warn(
      `[renderSeriesQuestion] caller for ${opts.pair} did not pass priceExpo; defaulting to -8 which will misformat XAU/QQQ/NVDA`,
    );
  }
  if (formatted == null) {
    return `Will ${asset} break ${direction} a dynamic level in the next ${readable}?`;
  }
  return `Will ${asset} break ${direction} ${formatted} in the next ${readable}?`;
}

/**
 * Local helper — convert a Pyth strike (stringified bigint, bigint, or
 * number) at the given `priceExpo` to a USD display string `$1,234.56`.
 * Returns `null` when the input is missing / unparseable so the caller can
 * render a "dynamic level" fallback instead of a literal "$—".
 *
 * `priceExpo` MUST be a non-positive integer matching the Pyth feed:
 *   XAU/XAG: -3, QQQ/NVDA: -5, crypto (BTC/ETH/SOL/HYPE): -8.
 * Despite this helper's name, the input is stored at the feed's native
 * expo, not at e-8 — the "E8" suffix is a historical naming bug.
 *
 * Slot F-2 (spawn-helpers) writes `strike_price_e8` at feed expo; this
 * helper is the read-side mirror.
 */
function formatStrikeFromE8(
  raw: bigint | string | number | null | undefined,
  priceExpo: number,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(priceExpo) || priceExpo > 0) {
    // dev-time guard: priceExpo MUST be a non-positive integer (-8, -5, -3 …)
    throw new Error(
      `formatStrikeFromE8: priceExpo must be a non-positive number, got ${priceExpo}`,
    );
  }
  let big: bigint;
  try {
    big = typeof raw === "bigint" ? raw : BigInt(raw as string | number);
  } catch {
    return null;
  }
  if (big === 0n) return "$0";
  const scale = Math.pow(10, -priceExpo); // -3 → 1000, -5 → 100000, -8 → 1e8
  const usd = Number(big) / scale;
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
