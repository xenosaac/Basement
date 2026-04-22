// INVARIANT: admin-signing path; never moves user VirtualUSD; only calls
// on-chain `market_factory::spawn_recurring_3min`. Double-spawn guarded by
// on-chain `E_GROUP_ALREADY_OPEN` — this route is a thin scheduling loop
// that peeks `get_active_market_in_group` view then submits only when empty.

import { NextResponse } from "next/server";

import {
  aptos,
  buildSpawnRecurring3minTxn,
  getPythVAA,
  moduleAddress,
  pythBtcFeedId,
  pythEthFeedId,
  submitAdminTxn,
} from "@/lib/aptos";

interface GroupSpec {
  groupId: string;
  feedId: string;
  tickSize: bigint;
}

// tick_size at Pyth 1e8 fixed-point: BTC = $500 => 500 * 1e8 = 5_0000_0000_0.
// ETH = $25 => 25 * 1e8 = 25_0000_0000.
const GROUPS: GroupSpec[] = [
  { groupId: "btc-3m", feedId: "", tickSize: 50_000_000_000n },
  { groupId: "eth-3m", feedId: "", tickSize: 2_500_000_000n },
];

const POOL_DEPTH_VUSD = 500_000_000n; // 500 vUSD at 6 decimals

function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Parse a Pyth Hermes VAA and extract the current price (signed i64 scaled
 * to Pyth exponent). For v0 we take the Hermes JSON alongside the VAA via
 * the `/v2/updates/price/latest` endpoint instead of raw VAA decoding —
 * much simpler, and we already have the VAA bytes for the on-chain update
 * submission when resolve runs.
 */
async function fetchCurrentPrice(feedId: string): Promise<bigint> {
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Pyth Hermes price fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    parsed?: Array<{ price?: { price?: string; expo?: number } }>;
  };
  const priceStr = body.parsed?.[0]?.price?.price;
  if (!priceStr) throw new Error(`Pyth Hermes returned no price for ${feedId}`);
  // price is fixed-point at Pyth exponent; case_vault assumes 1e8 scale
  // (expo = -8), which is standard for crypto price feeds. We pass through
  // the raw integer and trust Pyth's canonical exponent per the on-chain
  // assertion in oracle.move.
  return BigInt(priceStr);
}

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fill feedIds from env (requires real testnet values from Session C).
  const groups = GROUPS.map((g) => ({
    ...g,
    feedId: g.groupId.startsWith("btc") ? pythBtcFeedId() : pythEthFeedId(),
  }));

  const spawned: Array<{ group: string; txnHash: string }> = [];
  const skipped: Array<{ group: string; reason: string }> = [];

  for (const group of groups) {
    try {
      // Peek the on-chain active-group table. If occupied, skip.
      const active = (await aptos.view({
        payload: {
          function: `${moduleAddress()}::market_factory::get_active_market_in_group`,
          typeArguments: [],
          functionArguments: [utf8ToHex(group.groupId)],
        },
      })) as [{ vec?: unknown[] }];
      const vec = active[0]?.vec;
      if (Array.isArray(vec) && vec.length > 0) {
        skipped.push({ group: group.groupId, reason: "active market exists" });
        continue;
      }

      const price = await fetchCurrentPrice(group.feedId);
      // Prefetch VAA into cache (not strictly required for spawn — only resolve
      // needs VAA — but fetching confirms Hermes is alive this cycle).
      await getPythVAA(group.feedId).catch(() => undefined);

      const payload = buildSpawnRecurring3minTxn(
        group.groupId,
        group.feedId,
        price,
        group.tickSize,
        POOL_DEPTH_VUSD,
      );
      const { txnHash } = await submitAdminTxn(payload);
      spawned.push({ group: group.groupId, txnHash });
    } catch (err) {
      skipped.push({ group: group.groupId, reason: (err as Error).message });
    }
  }

  return NextResponse.json({ spawned, skipped });
}
