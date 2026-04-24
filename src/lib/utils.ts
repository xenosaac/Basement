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
