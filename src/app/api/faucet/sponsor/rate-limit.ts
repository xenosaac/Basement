// In-memory rate limiter for /api/faucet/sponsor. v1 -> Redis.
// Kept in its own module so the Next.js route file only exports HTTP verbs
// (route files are forbidden from exporting arbitrary symbols).

export const RATE_LIMIT_MS = 10_000;

const rateMap = new Map<string, number>();

export function rateLimitCheckAndRecord(ip: string, now = Date.now()): boolean {
  const last = rateMap.get(ip) ?? 0;
  if (now - last < RATE_LIMIT_MS) return false;
  rateMap.set(ip, now);
  return true;
}

export function __resetRateLimitForTests() {
  rateMap.clear();
}
