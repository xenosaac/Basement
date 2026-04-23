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
  pythHermesUrl,
  readCaseState,
  submitAdminTxnsParallel,
  type InputTransactionData,
} from "@/lib/aptos";
import {
  activeGroupsByCadence,
  pythFeedForGroup,
} from "@/lib/market-groups";

/**
 * Parse a Pyth Hermes VAA and extract the current price (signed i64 scaled
 * to Pyth exponent). For v0 we take the Hermes JSON alongside the VAA via
 * the `/v2/updates/price/latest` endpoint instead of raw VAA decoding —
 * much simpler, and we already have the VAA bytes for the on-chain update
 * submission when resolve runs.
 */
async function fetchCurrentPrice(feedId: string): Promise<bigint> {
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  // Resolve the Hermes base URL at call-time — do NOT hardcode, because the
  // stable vs beta channel swap is env-driven (see PYTH_HERMES_URL docs in
  // .env.example). Aptos testnet must use beta; mainnet uses stable.
  const url = `${pythHermesUrl()}/v2/updates/price/latest?ids[]=${id}`;
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
  const priceBig = BigInt(priceStr);
  // Pyth returns a signed i64 — crypto feeds are always positive, but guard
  // against edge cases so `buildSpawnRecurring3minTxn` doesn't BCS-fail on
  // a negative u64 encode.
  if (priceBig <= 0n) {
    throw new Error(
      `Pyth feed ${feedId} returned non-positive price ${priceStr}`,
    );
  }
  return priceBig;
}

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Registry-driven: every active `on-resolve` Pyth group spawns here.
  // Adding a new pair (e.g. sol-3m) only requires editing market-groups.ts.
  const groups = activeGroupsByCadence("on-resolve")
    .filter((g) => g.resolutionKind === "pyth" && g.active)
    .map((g) => ({ ...g, feedId: pythFeedForGroup(g) }));

  type GroupPrep =
    | { groupId: string; kind: "skip"; reason: string; nextCloseTime?: number }
    | {
        groupId: string;
        kind: "ready";
        payload: InputTransactionData;
      };

  // Parallel prep: view + price + VAA prefetch per group.
  const preps: GroupPrep[] = await Promise.all(
    groups.map(async (group): Promise<GroupPrep> => {
      try {
        const groupBytes = Array.from(new TextEncoder().encode(group.groupId));
        const active = (await aptos.view({
          payload: {
            function: `${moduleAddress()}::market_factory::get_active_market_in_group`,
            typeArguments: [],
            functionArguments: [groupBytes],
          },
        })) as [{ vec?: unknown[] }];
        const vec = active[0]?.vec;
        if (Array.isArray(vec) && vec.length > 0) {
          let nextCloseTime: number | undefined;
          try {
            const caseId = BigInt(vec[0] as string);
            const state = await readCaseState(caseId);
            nextCloseTime = Number(state.closeTime);
          } catch {
            /* best-effort */
          }
          return {
            groupId: group.groupId,
            kind: "skip",
            reason: "active market exists",
            nextCloseTime,
          };
        }

        // Fetch current price + prefetch VAA in parallel (Pyth Hermes).
        const [price] = await Promise.all([
          fetchCurrentPrice(group.feedId),
          getPythVAA(group.feedId).catch(() => undefined),
        ]);

        return {
          groupId: group.groupId,
          kind: "ready",
          payload: buildSpawnRecurring3minTxn(
            group.groupId,
            group.feedId,
            price,
            group.tickSize,
            group.poolDepth,
          ),
        };
      } catch (err) {
        return {
          groupId: group.groupId,
          kind: "skip",
          reason: (err as Error).message,
        };
      }
    }),
  );

  // Batch-submit all spawn payloads in one call.
  const readyPreps = preps.filter(
    (p): p is Extract<GroupPrep, { kind: "ready" }> => p.kind === "ready",
  );
  const results = await submitAdminTxnsParallel(
    readyPreps.map((p) => p.payload),
  );

  const spawned: Array<{ group: string; txnHash: string }> = [];
  const skipped: Array<{ group: string; reason: string }> = [];
  const closeTimes: number[] = [];

  for (const p of preps) {
    if (p.kind === "skip") {
      skipped.push({ group: p.groupId, reason: p.reason });
      if (typeof p.nextCloseTime === "number") closeTimes.push(p.nextCloseTime);
    }
  }
  readyPreps.forEach((p, i) => {
    const r = results[i];
    if (r.success && r.txnHash) {
      spawned.push({ group: p.groupId, txnHash: r.txnHash });
      closeTimes.push(Math.floor(Date.now() / 1000) + 180);
    } else {
      skipped.push({
        group: p.groupId,
        reason: r.error ?? "spawn tx failed",
      });
    }
  });

  const nextCloseTime = closeTimes.length ? Math.min(...closeTimes) : null;
  return NextResponse.json({ spawned, skipped, nextCloseTime });
}
