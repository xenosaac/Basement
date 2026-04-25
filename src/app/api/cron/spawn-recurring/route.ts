// INVARIANT: admin-signing path; never moves user VirtualUSD; only calls
// on-chain `market_factory::spawn_recurring_3min`. Double-spawn guarded by
// on-chain `E_GROUP_ALREADY_OPEN` — this route is a thin scheduling loop
// that peeks `get_active_market_in_group` view then submits only when empty.

import { NextResponse } from "next/server";

import { db } from "@/db";
import { priceTicksV3 } from "@/db/schema";
import {
  aptos,
  buildCreateMarketTxn,
  buildSpawnRecurring3minTxn,
  fetchMarketCreatedEventsForTxn,
  fetchPythPrice,
  getActiveCaseIdForGroup,
  getPythVAA,
  moduleAddress,
  pythHermesUrl,
  readCaseState,
  submitAdminTxnsParallel,
  type InputTransactionData,
} from "@/lib/aptos";
import { invalidateCache } from "@/lib/aptos-cache";
import {
  activeGroupsByCadence,
  deriveMarketParams,
  isMarketOpen,
  nextNyFourPmUtc,
  nextNyMidnightUtc,
  nextNyNoonUtc,
  nextQuarterHourUtc,
  nextTopOfHourUtc,
  pythFeedForGroup,
  THRESHOLD_ABOVE,
  THRESHOLD_BELOW,
  type MarketGroupSpec,
} from "@/lib/market-groups";
import {
  upsertRecurringMarketRowFromChain,
  type DynamicStrikeUpsert,
} from "@/lib/markets-query";
import { computeBarrierStrike } from "@/lib/quant/barrier-strike";
import { isMacroBlackout } from "@/lib/quant/macro-calendar";
import { computeRealizedVol7d } from "@/lib/quant/vol-estimator";
import { isCloseMoment } from "@/lib/cron-gate";

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

/**
 * Map a `closeAnchor` literal to the corresponding "next anchor" computer.
 * Centralised so both the spawn cron and any future caller share the same
 * mapping. `daily-ny-midnight` keeps backward compat with the legacy XAU
 * daily strikes — same anchor, same UTC-second result.
 */
function nextAnchorUtc(
  anchor:
    | "next-15m"
    | "next-1h"
    | "daily-ny-noon"
    | "daily-ny-4pm"
    | "daily-ny-midnight",
  nowUtcSec: number,
): number {
  switch (anchor) {
    case "next-15m":
      return nextQuarterHourUtc(nowUtcSec);
    case "next-1h":
      return nextTopOfHourUtc(nowUtcSec);
    case "daily-ny-noon":
      return nextNyNoonUtc(nowUtcSec);
    case "daily-ny-4pm":
      return nextNyFourPmUtc(nowUtcSec);
    case "daily-ny-midnight":
      return nextNyMidnightUtc(nowUtcSec);
  }
}

/** Map a registry `Category` to the `series_v3.category` enum. The seriesV3
 *  enum lacks an `others` value — forex falls into `crypto_ext` for v0.5 (a
 *  proper enum extension is Phase F's territory). */
function seriesCategoryFor(spec: MarketGroupSpec):
  | "quick_play"
  | "commodity"
  | "stocks"
  | "crypto_ext" {
  if (spec.category === "commodity") return "commodity";
  if (spec.category === "stocks") return "stocks";
  return "crypto_ext"; // crypto + forex(others)
}

/**
 * Phase D: derive a dynamic-strike spawn payload using vol-estimator +
 * barrier-strike. Async because vol-estimator hits the DB. Returns `null`
 * to signal "skip this round" (e.g. macro blackout). All numbers in USD
 * floats internally; chain-side `strikePriceRaw` is rebuilt from the chosen
 * strike at the end.
 */
interface DynamicSpawnDerivation {
  strikePriceRaw: bigint;
  thresholdType: 0 | 1;
  closeTime: number;
  durationSec: number;
  /** Captured for casesV3 shadow row. */
  shadow: {
    strikeKind: string;
    strikePriceE8: bigint;
    barrierLowPriceE8: bigint | null;
    barrierHighPriceE8: bigint | null;
    volSourceTag: string;
    volIsFresh: 0 | 1;
  };
}

async function deriveDynamicSpawnParams(
  spec: MarketGroupSpec,
  priceRaw: bigint,
  priceExpo: number,
  nowUtcSec: number,
): Promise<DynamicSpawnDerivation | { skip: string }> {
  if (spec.spawnStrategy.kind !== "create_market_dynamic_strike") {
    throw new Error(
      `[spawn-recurring] deriveDynamicSpawnParams called for non-dynamic ` +
        `strategy ${spec.spawnStrategy.kind} (${spec.groupId})`,
    );
  }
  const strategy = spec.spawnStrategy;
  if (priceExpo !== strategy.pythExpo) {
    throw new Error(
      `[spawn-recurring] expo mismatch for ${spec.groupId}: feed=${priceExpo} ` +
        `spec=${strategy.pythExpo}`,
    );
  }

  // 1. Compute closeTime + tenor from the anchor.
  const closeTime = nextAnchorUtc(strategy.closeAnchor, nowUtcSec);
  const tenorSec = closeTime - nowUtcSec;
  if (tenorSec <= 0) {
    throw new Error(
      `[spawn-recurring] anchor returned non-positive tenor (${tenorSec}s) ` +
        `for ${spec.groupId} (${strategy.closeAnchor})`,
    );
  }

  // 2. Macro blackout — skip spawn cleanly so the next cron tick retries.
  const blackout = isMacroBlackout(spec.assetSymbol, nowUtcSec);
  if (blackout.blackout) {
    return { skip: `macro blackout: ${blackout.reason ?? "unknown"}` };
  }

  // 3. Vol estimate. Falls back to ASSET_PARAMS default σ when there are <5
  //    samples — `isFresh=false` flags the audit but doesn't block spawn.
  const vol = await computeRealizedVol7d(spec.groupId, nowUtcSec);

  // 4. P0 in USD float — used by computeBarrierStrike. priceExpo is negative
  //    for crypto/commodity (-8), QQQ/forex (-5).
  const P0Usd = Number(priceRaw) * Math.pow(10, priceExpo);
  if (!(P0Usd > 0)) {
    throw new Error(
      `[spawn-recurring] non-positive P0Usd ${P0Usd} from priceRaw=${priceRaw} ` +
        `expo=${priceExpo} for ${spec.groupId}`,
    );
  }

  // 5. Branch by strike kind.
  const expoPower = Math.pow(10, -priceExpo); // priceExpo=-8 → 1e8
  const e8Power = 1e8;

  if (strategy.strikeKind === "barrier_two_sided") {
    const up = computeBarrierStrike({
      asset: spec.assetSymbol,
      side: "UP",
      tenorSec,
      P0: P0Usd,
      sigmaAnnual: vol.sigmaAnnual,
      asOfSec: nowUtcSec,
    });
    const down = computeBarrierStrike({
      asset: spec.assetSymbol,
      side: "DOWN",
      tenorSec,
      P0: P0Usd,
      sigmaAnnual: vol.sigmaAnnual,
      asOfSec: nowUtcSec,
    });
    // chain-side strike_price placeholder = upper barrier (at feed expo).
    // v0 settles in DB; chain settle is unused for barrier_two_sided.
    const strikePriceRaw = BigInt(Math.round(up.strikePrice * expoPower));
    const upperE8 = BigInt(Math.round(up.strikePrice * e8Power));
    const lowerE8 = BigInt(Math.round(down.strikePrice * e8Power));
    return {
      strikePriceRaw,
      thresholdType: THRESHOLD_ABOVE as 0,
      closeTime,
      durationSec: tenorSec,
      shadow: {
        strikeKind: "barrier_two_sided",
        strikePriceE8: upperE8, // chain-display parity; settle uses both barriers
        barrierLowPriceE8: lowerE8,
        barrierHighPriceE8: upperE8,
        volSourceTag: vol.source,
        volIsFresh: vol.isFresh ? 1 : 0,
      },
    };
  }

  // absolute_above / absolute_below
  const side = strategy.strikeKind === "absolute_above" ? "UP" : "DOWN";
  const strike = computeBarrierStrike({
    asset: spec.assetSymbol,
    side,
    tenorSec,
    P0: P0Usd,
    sigmaAnnual: vol.sigmaAnnual,
    asOfSec: nowUtcSec,
  });
  const strikePriceRaw = BigInt(Math.round(strike.strikePrice * expoPower));
  const strikePriceE8 = BigInt(Math.round(strike.strikePrice * e8Power));
  const thresholdType: 0 | 1 =
    strategy.strikeKind === "absolute_above"
      ? (THRESHOLD_ABOVE as 0)
      : (THRESHOLD_BELOW as 1);

  return {
    strikePriceRaw,
    thresholdType,
    closeTime,
    durationSec: tenorSec,
    shadow: {
      strikeKind: strategy.strikeKind,
      strikePriceE8,
      barrierLowPriceE8: null,
      barrierHighPriceE8: null,
      volSourceTag: vol.source,
      volIsFresh: vol.isFresh ? 1 : 0,
    },
  };
}

/** Insert a Pyth tick into `price_ticks_v3` (idempotent on the unique
 *  `(feedId, publishTimeSec)` index). Best-effort — feeds the vol-estimator
 *  rolling window for the next spawn cycle. Failure is logged + swallowed
 *  because spawn success doesn't depend on tick history persistence. */
async function recordPriceTickBestEffort(
  feedId: string,
  priceRaw: bigint,
  priceExpo: number,
  publishTimeSec: number,
): Promise<void> {
  try {
    // priceTicksV3 stores priceE8 (Pyth canonical scale). When Pyth's expo
    // differs from -8 (e.g. -5 for QQQ/forex), rescale to e8 so all rows
    // share a unit and the vol-estimator's log-return math stays correct.
    const priceE8 =
      priceExpo === -8
        ? priceRaw
        : BigInt(Math.round(Number(priceRaw) * Math.pow(10, 8 + priceExpo)));
    const lower =
      feedId.startsWith("0x") ? feedId.slice(2).toLowerCase() : feedId.toLowerCase();
    await db
      .insert(priceTicksV3)
      .values({
        pythFeedId: lower,
        priceE8,
        publishTimeSec,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error(
      `[spawn-recurring] price_ticks_v3 insert failed for ${feedId}:`,
      err,
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Close-moment gate: skip early on minutes where no cadence hits its close.
  // ~80% of cron ticks return here without touching Aptos RPC.
  const gate = isCloseMoment();
  if (!gate.isCloseMoment) {
    return NextResponse.json({
      skipped: "not a close moment",
      minute: gate.minuteOfHour,
    });
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
        durationSec: number;
        spec: MarketGroupSpec;
        /** Phase D dynamic-strike payload to plumb through to the DB upsert. */
        dynamic?: DynamicStrikeUpsert;
      };

  const nowUtcSec = Math.floor(Date.now() / 1000);

  // Parallel prep: view + price + VAA prefetch per group.
  const preps: GroupPrep[] = await Promise.all(
    groups.map(async (group): Promise<GroupPrep> => {
      try {
        // Commodity / stocks gate: skip spawning outside market hours so
        // new cases don't spend their lifetime on a stale frozen price.
        // For v0.5 dynamic-strike groups, isMarketOpen consults the
        // strategy.marketHours field (rth-only / fx-24x5 / always).
        if (!isMarketOpen(group, nowUtcSec)) {
          return {
            groupId: group.groupId,
            kind: "skip",
            reason: `market closed (${group.category})`,
          };
        }
        const activeCaseId = await getActiveCaseIdForGroup(group.groupId);
        if (activeCaseId !== null) {
          let nextCloseTime: number | undefined;
          try {
            const state = await readCaseState(activeCaseId);
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

        // Branch by spawnStrategy. Legacy spawn_recurring_3min keeps the
        // hardcoded 180s close; create_market pulls expo-aware price from
        // Hermes and runs it through deriveMarketParams. v0.5 Phase D adds
        // create_market_dynamic_strike — async derivation with quant hooks.
        const strategy = group.spawnStrategy;
        if (strategy.kind === "spawn_recurring_3min") {
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
            durationSec: 180,
            spec: group,
          };
        }

        if (strategy.kind === "create_market_dynamic_strike") {
          // v0.5 Phase D — quant-driven strike + barrier write.
          const { price, expo, publishTime } = await fetchPythPrice(group.feedId);
          // Best-effort: feed the vol-estimator rolling window. Doesn't
          // block this spawn but unlocks the next cycle's σ samples.
          await recordPriceTickBestEffort(
            group.feedId,
            price,
            expo,
            publishTime,
          );

          const derived = await deriveDynamicSpawnParams(
            group,
            price,
            expo,
            nowUtcSec,
          );
          if ("skip" in derived) {
            return {
              groupId: group.groupId,
              kind: "skip",
              reason: derived.skip,
            };
          }

          const dynamicPayload: DynamicStrikeUpsert = {
            strikeKind: derived.shadow.strikeKind,
            durationSec: derived.durationSec,
            startTimeSec: nowUtcSec,
            seriesCategory: seriesCategoryFor(group),
            pythFeedId: group.feedId.startsWith("0x")
              ? group.feedId.slice(2).toLowerCase()
              : group.feedId.toLowerCase(),
            strikePriceE8: derived.shadow.strikePriceE8,
            barrierLowPriceE8: derived.shadow.barrierLowPriceE8,
            barrierHighPriceE8: derived.shadow.barrierHighPriceE8,
            volSourceTag: derived.shadow.volSourceTag,
            volIsFresh: derived.shadow.volIsFresh,
          };

          return {
            groupId: group.groupId,
            kind: "ready",
            payload: buildCreateMarketTxn({
              assetPythFeedId: group.feedId,
              strikePriceRaw: derived.strikePriceRaw,
              closeTimeSec: derived.closeTime,
              recurringGroupId: group.groupId,
              recurringAutoSpawn: false,
              recurringDurationSeconds: derived.durationSec,
              marketType: strategy.marketType,
              thresholdType: derived.thresholdType,
              feeBps: strategy.feeBps,
              poolDepth: group.poolDepth,
              maxTradeBps: strategy.maxTradeBps,
              maxStalenessSec: strategy.maxStalenessSec,
            }),
            durationSec: derived.durationSec,
            spec: group,
            dynamic: dynamicPayload,
          };
        }

        // Legacy create_market path — XAU up/down, future strike-based groups.
        const { price, expo, publishTime } = await fetchPythPrice(group.feedId);
        await recordPriceTickBestEffort(group.feedId, price, expo, publishTime);
        const derived = deriveMarketParams(group, price, expo, nowUtcSec);
        return {
          groupId: group.groupId,
          kind: "ready",
          payload: buildCreateMarketTxn({
            assetPythFeedId: group.feedId,
            strikePriceRaw: derived.strikeRaw,
            closeTimeSec: derived.closeTime,
            recurringGroupId: group.groupId,
            recurringAutoSpawn: false, // backend cron handles, not on-chain auto
            recurringDurationSeconds: derived.durationSec,
            marketType: strategy.marketType,
            thresholdType: derived.thresholdType,
            feeBps: strategy.feeBps,
            poolDepth: group.poolDepth,
            maxTradeBps: strategy.maxTradeBps,
            maxStalenessSec: strategy.maxStalenessSec,
          }),
          durationSec: derived.durationSec,
          spec: group,
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

  const spawned: Array<{
    group: string;
    txnHash: string;
    caseId: string | null;
    dbWritten: boolean;
  }> = [];
  const skipped: Array<{ group: string; reason: string }> = [];
  const closeTimes: number[] = [];

  for (const p of preps) {
    if (p.kind === "skip") {
      skipped.push({ group: p.groupId, reason: p.reason });
      if (typeof p.nextCloseTime === "number") closeTimes.push(p.nextCloseTime);
    }
  }

  // For successful spawns, parse `market_factory::MarketCreatedEvent` from
  // the committed tx and materialize the DB row keyed by on-chain caseId.
  // On event-fetch miss, log + skip; `ensureActiveRecurringMarkets` will
  // reconcile via view + readCaseState on the next `/api/markets` hit.
  await Promise.all(
    readyPreps.map(async (p, i) => {
      const r = results[i];
      if (!r.success || !r.txnHash) {
        skipped.push({
          group: p.groupId,
          reason: r.error ?? "spawn tx failed",
        });
        return;
      }

      // Spawn succeeded → group's active case id changed. Invalidate the
      // cache entry so next reader picks up the new case instead of the
      // stale "no active" result.
      invalidateCache(`activeMarket:${p.groupId}`);

      let caseId: string | null = null;
      let dbWritten = false;
      try {
        const events = await fetchMarketCreatedEventsForTxn(r.txnHash);
        const event =
          events.find((e) => e.recurringGroupId === p.spec.groupId) ?? events[0];
        if (event) {
          caseId = event.caseId.toString();
          await upsertRecurringMarketRowFromChain({
            spec: p.spec,
            event,
            dynamic: p.dynamic,
          });
          dbWritten = true;
        } else {
          console.warn(
            `[spawn-recurring] MarketCreatedEvent missing for ${p.groupId} txn=${r.txnHash}`,
          );
        }
      } catch (err) {
        console.error(
          `[spawn-recurring] event/upsert failed for ${p.groupId}:`,
          err,
        );
      }

      spawned.push({
        group: p.groupId,
        txnHash: r.txnHash,
        caseId,
        dbWritten,
      });
      closeTimes.push(Math.floor(Date.now() / 1000) + p.durationSec);
    }),
  );

  const nextCloseTime = closeTimes.length ? Math.min(...closeTimes) : null;
  return NextResponse.json({ spawned, skipped, nextCloseTime });
}
