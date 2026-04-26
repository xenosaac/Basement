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
 * `strikePriceE8` is the Pyth-native price scaled by 10^8 (NOT by `priceExpo`).
 * `priceExpo` is kept on the contract for forward-compat with feeds whose
 * native exponent isn't -8 (e.g. equities at -5); the e8 normalization here
 * matches what cases_v3 stores and what `formatBarrierPriceFromE8` consumes.
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
  const formatted = formatStrikeFromE8(opts.strikePriceE8);
  if (formatted == null) {
    return `Will ${asset} break ${direction} a dynamic level in the next ${readable}?`;
  }
  return `Will ${asset} break ${direction} ${formatted} in the next ${readable}?`;
}

/**
 * Local helper — convert a Pyth-native e8 strike (stringified bigint or
 * bigint) to a USD display string `$1,234.56`. Returns `null` when the
 * strike is missing / unparseable so the caller can render a "dynamic
 * level" fallback instead of a literal "$—".
 *
 * Mirrors `formatBarrierPriceFromE8` from `case-copy.ts` but returns null
 * (rather than the sentinel "$—") so the caller can branch cleanly. We
 * inline rather than import to keep `utils.ts` free of cross-module deps —
 * the formatting math is tiny and stable.
 */
function formatStrikeFromE8(
  priceE8: string | bigint | null | undefined,
): string | null {
  if (priceE8 == null) return null;
  let n: bigint;
  try {
    n = typeof priceE8 === "bigint" ? priceE8 : BigInt(priceE8);
  } catch {
    return null;
  }
  if (n === 0n) return null;
  const SCALE = 100_000_000n;
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const intUsd = abs / SCALE;
  const fracE8 = abs % SCALE;
  const ROUND_HALF = 500_000n; // 0.5 cent in e8 units
  let cents = (fracE8 + ROUND_HALF) / 1_000_000n; // 0..100
  let intPart = intUsd;
  if (cents >= 100n) {
    intPart = intUsd + 1n;
    cents = 0n;
  }
  const intFmt = intPart.toLocaleString("en-US");
  const centsStr = cents.toString().padStart(2, "0");
  return `${sign}$${intFmt}.${centsStr}`;
}
