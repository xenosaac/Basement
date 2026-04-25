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

/** Render the question for a series round. */
export function renderSeriesQuestion(opts: {
  pair: string; // e.g. "BTC/USDC"
  cadenceSec: number;
}): string {
  const asset = opts.pair.split("/")[0] ?? opts.pair;
  const readable =
    opts.cadenceSec >= 3600
      ? `${Math.round(opts.cadenceSec / 3600)}-hour`
      : `${Math.round(opts.cadenceSec / 60)}-min`;
  return `Will ${asset} rise in the next ${readable}?`;
}
