// INVARIANT: admin-signing path; never moves user VirtualUSD. Pulls the
// active recurring case per group, checks on-chain close_time, and settles
// + clears active-group slot.
//
// Resolve path is ENV-configurable via `ORACLE_RESOLVE_MODE`:
//   - "oracle" : on-chain Pyth via `case_vault::resolve_oracle(case_id, vaa)`.
//                PRODUCTION PATH — fully non-custodial, outcome computed on
//                chain from a Pyth VAA. Requires PYTH_HERMES_URL + feed ids
//                to match the deployment chain's Pyth/Wormhole channel
//                (Aptos testnet → hermes-beta + beta feed ids; mainnet →
//                hermes + stable feed ids). See README "Oracle path".
//   - "admin"  : admin backend computes outcome off-chain from stable
//                Hermes → `case_vault::admin_resolve(case_id, outcome)`.
//                Emergency escape hatch only; admin still can NOT move
//                user funds (Move module enforces), but the outcome bit
//                is trusted. Used for one-shot zombie cleanup.
//   - "auto"   : (future) try oracle, fall back to admin on abort.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { markets } from "@/db/schema";
import {
  aptos,
  buildAdminResolveTxn,
  buildClearActiveGroupTxn,
  buildResolveOracleTxn,
  fetchPythPrice,
  fetchResolvedEventForTxn,
  getActiveCaseIdForGroup,
  getPythVAA,
  moduleAddress,
  readCaseState,
  submitAdminTxnsParallel,
  type InputTransactionData,
  type OutcomeCode,
} from "@/lib/aptos";
import { invalidateCache } from "@/lib/aptos-cache";
import {
  pythFeedForGroup,
  resolvableGroupsByCadence,
} from "@/lib/market-groups";
import {
  outcomeCodeToLabel,
  settlementDisplayPrices,
  type OutcomeLabel,
} from "@/lib/market-settlement";
import { isCloseMoment } from "@/lib/cron-gate";

// Matches Move `case_vault.move`: STATE_RESOLVED = 2, STATE_INVALID = 3.
const STATE_RESOLVED = 2;
const STATE_INVALID = 3;

// Matches Move threshold_type constants:
//   0 = ABOVE → YES iff price > strike
//   1 = BELOW → YES iff price < strike
const THRESHOLD_ABOVE = 0;
const THRESHOLD_BELOW = 1;
const OUTCOME_YES: OutcomeCode = 0;
const OUTCOME_NO: OutcomeCode = 1;

type ResolveMode = "oracle" | "admin" | "auto";
function getResolveMode(): ResolveMode {
  const raw = (process.env.ORACLE_RESOLVE_MODE ?? "admin").toLowerCase();
  if (raw === "oracle" || raw === "admin" || raw === "auto") return raw;
  return "admin";
}

export const dynamic = "force-dynamic";

type GroupPrep =
  | { groupId: string; kind: "skip"; reason: string; nextCloseTime?: number }
  | { groupId: string; kind: "clear-only"; caseId: bigint; outcomeCode: number }
  | {
      groupId: string;
      kind: "admin-resolve";
      caseId: bigint;
      outcome: OutcomeCode;
    }
  | {
      groupId: string;
      kind: "oracle-resolve";
      caseId: bigint;
      vaa: Uint8Array;
    };

/**
 * Write resolved state into the markets DB row. Independent of clear-tx
 * success — if resolve succeeded, the market is resolved whether or not
 * the factory's active slot was cleared.
 */
async function applyResolvedDbUpdate(
  caseId: bigint,
  groupId: string,
  outcomeLabel: OutcomeLabel,
): Promise<boolean> {
  const now = new Date();
  const prices = settlementDisplayPrices("RESOLVED", outcomeLabel, {
    yesPrice: 0.5,
    noPrice: 0.5,
  });
  const base = {
    state: "RESOLVED" as const,
    resolvedOutcome: outcomeLabel,
    resolvedAt: now,
    yesPrice: String(prices.yesPrice),
    noPrice: String(prices.noPrice),
    updatedAt: now,
  };

  const primary = await db
    .update(markets)
    .set(base)
    .where(eq(markets.caseId, caseId))
    .returning({ id: markets.id });
  if (primary.length > 0) return true;

  // Fallback: earlier spawn failed to write caseId onto the row. Update any
  // OPEN row in the group as a last resort.
  const fallback = await db
    .update(markets)
    .set({ ...base, caseId })
    .where(
      and(
        eq(markets.recurringGroupId, groupId),
        eq(markets.state, "OPEN"),
      ),
    )
    .returning({ id: markets.id });
  if (fallback.length > 0) {
    console.warn(
      `[resolve-onchain] DB row for case ${caseId} found via groupId fallback (${groupId})`,
    );
    return true;
  }
  return false;
}

function computeOutcome(
  price: bigint,
  strike: bigint,
  thresholdType: number,
): OutcomeCode {
  if (thresholdType === THRESHOLD_ABOVE) {
    return price > strike ? OUTCOME_YES : OUTCOME_NO;
  }
  if (thresholdType === THRESHOLD_BELOW) {
    return price < strike ? OUTCOME_YES : OUTCOME_NO;
  }
  return OUTCOME_NO; // v0 stub for EQ_ROUNDED
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Close-moment gate: same logic as spawn-recurring. Resolution can only
  // fire after a round closes, which only happens on cadence-aligned minutes.
  const gate = isCloseMoment();
  if (!gate.isCloseMoment) {
    return NextResponse.json({
      skipped: "not a close moment",
      minute: gate.minuteOfHour,
    });
  }

  const mode = getResolveMode();
  // resolvableGroupsByCadence includes legacy-cleanup groups so lingering
  // cases (e.g. old xau-daily after the 1g up/down pivot) still get resolved
  // and cleared. Spawn + UI never see those legacy groups.
  const groups = resolvableGroupsByCadence("on-resolve")
    .filter((g) => g.resolutionKind === "pyth")
    .map((g) => ({ ...g, feedId: pythFeedForGroup(g) }));

  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  // Parallel prep: view active → readCaseState → (if expired) fetch VAA
  // (oracle mode) or parsed price (admin mode).
  const preps: GroupPrep[] = await Promise.all(
    groups.map(async (group): Promise<GroupPrep> => {
      try {
        const caseId = await getActiveCaseIdForGroup(group.groupId);
        if (caseId === null) {
          return { groupId: group.groupId, kind: "skip", reason: "no active case" };
        }
        const state = await readCaseState(caseId);

        if (state.state === STATE_RESOLVED || state.state === STATE_INVALID) {
          // Chain already resolved — cron just needs to clear the active
          // slot. Capture the outcome for DB sync.
          return {
            groupId: group.groupId,
            kind: "clear-only",
            caseId,
            outcomeCode: state.resolvedOutcome,
          };
        }
        if (state.closeTime > nowSec) {
          return {
            groupId: group.groupId,
            kind: "skip",
            reason: "not yet expired",
            nextCloseTime: Number(state.closeTime),
          };
        }

        // Expired → branch by mode.
        if (mode === "oracle" || mode === "auto") {
          const vaa = await getPythVAA(group.feedId);
          return { groupId: group.groupId, kind: "oracle-resolve", caseId, vaa };
        }
        // admin mode: off-chain compute.
        const { price } = await fetchPythPrice(group.feedId);
        const outcome = computeOutcome(
          price,
          state.strikePrice,
          state.thresholdType,
        );
        return { groupId: group.groupId, kind: "admin-resolve", caseId, outcome };
      } catch (err) {
        return {
          groupId: group.groupId,
          kind: "skip",
          reason: (err as Error).message,
        };
      }
    }),
  );

  // Build payloads. Each resolving group → [resolve_tx, clear_tx] pair,
  // seq-number ordered so clear always executes after resolve.
  const payloads: InputTransactionData[] = [];
  const payloadMeta: Array<
    | { kind: "oracle-resolve"; groupId: string; caseId: bigint }
    | { kind: "admin-resolve"; groupId: string; caseId: bigint; outcome: OutcomeCode }
    | { kind: "clear"; groupId: string; caseId: bigint }
  > = [];
  for (const p of preps) {
    if (p.kind === "clear-only") {
      payloads.push(buildClearActiveGroupTxn(p.groupId));
      payloadMeta.push({ kind: "clear", groupId: p.groupId, caseId: p.caseId });
    } else if (p.kind === "oracle-resolve") {
      payloads.push(buildResolveOracleTxn(p.caseId, p.vaa));
      payloadMeta.push({ kind: "oracle-resolve", groupId: p.groupId, caseId: p.caseId });
      payloads.push(buildClearActiveGroupTxn(p.groupId));
      payloadMeta.push({ kind: "clear", groupId: p.groupId, caseId: p.caseId });
    } else if (p.kind === "admin-resolve") {
      payloads.push(buildAdminResolveTxn(p.caseId, p.outcome));
      payloadMeta.push({
        kind: "admin-resolve",
        groupId: p.groupId,
        caseId: p.caseId,
        outcome: p.outcome,
      });
      payloads.push(buildClearActiveGroupTxn(p.groupId));
      payloadMeta.push({ kind: "clear", groupId: p.groupId, caseId: p.caseId });
    }
  }

  const results = await submitAdminTxnsParallel(payloads);

  const resolved: Array<{
    group: string;
    caseId: string;
    mode: "oracle" | "admin";
    outcome?: OutcomeLabel;
    resolveHash: string;
    clearHash?: string;
    clearError?: string;
    dbUpdated: boolean;
  }> = [];
  const cleared: Array<{
    group: string;
    caseId: string;
    txnHash?: string;
    clearError?: string;
    dbUpdated: boolean;
  }> = [];
  const skipped: Array<{ group: string; reason: string }> = [];
  const closeTimes: number[] = [];

  for (const p of preps) {
    if (p.kind === "skip") {
      skipped.push({ group: p.groupId, reason: p.reason });
      if (typeof p.nextCloseTime === "number") closeTimes.push(p.nextCloseTime);
    }
  }

  // Pass 1 — record resolve outcomes, update DB independently of clear-tx.
  const dbUpdateTasks: Array<Promise<void>> = [];
  for (let i = 0; i < payloadMeta.length; i++) {
    const meta = payloadMeta[i];
    const r = results[i];

    if (meta.kind === "oracle-resolve" || meta.kind === "admin-resolve") {
      const resolveMode = meta.kind === "oracle-resolve" ? "oracle" : "admin";
      if (!r.success || !r.txnHash) {
        skipped.push({
          group: meta.groupId,
          reason: `${resolveMode}-resolve failed: ${r.error ?? "unknown"}`,
        });
        continue;
      }

      // Resolve succeeded → both the case state and the group's active slot
      // changed on chain. Drop both cache keys so the next cron tick or list
      // request reads fresh.
      invalidateCache(`caseState:${meta.caseId}`);
      invalidateCache(`activeMarket:${meta.groupId}`);

      const clearMeta = payloadMeta[i + 1];
      const clearResult = results[i + 1];
      const clearPaired =
        clearMeta?.kind === "clear" && clearMeta.groupId === meta.groupId;

      const entry: (typeof resolved)[number] = {
        group: meta.groupId,
        caseId: meta.caseId.toString(),
        mode: resolveMode as "oracle" | "admin",
        resolveHash: r.txnHash,
        dbUpdated: false,
      };
      if (clearPaired && clearResult?.success && clearResult.txnHash) {
        entry.clearHash = clearResult.txnHash;
      } else if (clearPaired) {
        entry.clearError = clearResult?.error ?? "clear tx failed";
      }

      resolved.push(entry);

      // DB sync — independent of clear outcome. For oracle mode, pull the
      // authoritative outcome from the resolve tx events; for admin mode,
      // we already have it locally.
      const resolveTxHash = r.txnHash;
      dbUpdateTasks.push(
        (async () => {
          let outcomeLabel: OutcomeLabel;
          if (meta.kind === "admin-resolve") {
            outcomeLabel = outcomeCodeToLabel(meta.outcome);
            entry.outcome = outcomeLabel;
          } else {
            try {
              const evt = await fetchResolvedEventForTxn(resolveTxHash);
              if (evt) {
                outcomeLabel = outcomeCodeToLabel(evt.outcome);
              } else {
                // Event missing (rare) — fall back to readCaseState.
                const st = await readCaseState(meta.caseId);
                outcomeLabel = outcomeCodeToLabel(st.resolvedOutcome);
              }
            } catch (err) {
              console.error(
                `[resolve-onchain] failed to read outcome for case ${meta.caseId}:`,
                err,
              );
              return;
            }
            entry.outcome = outcomeLabel;
          }
          try {
            entry.dbUpdated = await applyResolvedDbUpdate(
              meta.caseId,
              meta.groupId,
              outcomeLabel,
            );
          } catch (err) {
            console.error(
              `[resolve-onchain] DB update failed for case ${meta.caseId}:`,
              err,
            );
          }
        })(),
      );
    } else if (meta.kind === "clear") {
      const prev = payloadMeta[i - 1];
      const isPaired =
        (prev?.kind === "oracle-resolve" || prev?.kind === "admin-resolve") &&
        prev.groupId === meta.groupId;
      if (isPaired) continue; // handled above

      // clear-only entry — chain was already resolved; sync DB from the
      // prep's cached outcomeCode regardless of clear tx success.
      const prep = preps.find(
        (p): p is Extract<GroupPrep, { kind: "clear-only" }> =>
          p.kind === "clear-only" && p.caseId === meta.caseId,
      );
      const outcomeLabel: OutcomeLabel = prep
        ? outcomeCodeToLabel(prep.outcomeCode)
        : "INVALID";

      const entry: (typeof cleared)[number] = {
        group: meta.groupId,
        caseId: meta.caseId.toString(),
        dbUpdated: false,
      };
      if (r.success && r.txnHash) {
        entry.txnHash = r.txnHash;
      } else {
        entry.clearError = r.error ?? "clear-only tx failed";
      }
      cleared.push(entry);

      dbUpdateTasks.push(
        (async () => {
          try {
            entry.dbUpdated = await applyResolvedDbUpdate(
              meta.caseId,
              meta.groupId,
              outcomeLabel,
            );
          } catch (err) {
            console.error(
              `[resolve-onchain] clear-only DB update failed for case ${meta.caseId}:`,
              err,
            );
          }
        })(),
      );
    }
  }

  await Promise.all(dbUpdateTasks);

  const nextCloseTime = closeTimes.length ? Math.min(...closeTimes) : null;
  return NextResponse.json({ mode, resolved, cleared, skipped, nextCloseTime });
}
