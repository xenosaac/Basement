// INVARIANT: admin-signing path; never moves user VirtualUSD. Pulls the
// active recurring case per group, checks on-chain close_time, and settles
// + clears active-group slot.
//
// Resolve path is ENV-configurable via `ORACLE_RESOLVE_MODE`:
//   - "oracle" : on-chain Pyth via `case_vault::resolve_oracle(case_id, vaa)`.
//                Requires admin to have legacy `0x1::coin::CoinStore<AptosCoin>`
//                for Pyth fee (1 octa). If admin has FA-APT only, aborts
//                `0x1::table 0x6507` (ENOT_FOUND on CoinStore lookup).
//   - "admin"  : off-chain Pyth Hermes parsed price → compute outcome →
//                `case_vault::admin_resolve(case_id, outcome)`. Fallback when
//                `oracle` path is unavailable. Outcome trust = admin signature.
//   - "auto"   : (future) try oracle first, fall back to admin on abort.
// Default: "admin" (current workaround — non-custodial, works without admin
// CoinStore setup).

import { NextResponse } from "next/server";

import {
  aptos,
  buildAdminResolveTxn,
  buildClearActiveGroupTxn,
  buildResolveOracleTxn,
  fetchPythPrice,
  getPythVAA,
  moduleAddress,
  readCaseState,
  submitAdminTxnsParallel,
  type InputTransactionData,
  type OutcomeCode,
} from "@/lib/aptos";
import {
  activeGroupsByCadence,
  pythFeedForGroup,
} from "@/lib/market-groups";

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
  | { groupId: string; kind: "clear-only"; caseId: bigint }
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

  const mode = getResolveMode();
  const groups = activeGroupsByCadence("on-resolve")
    .filter((g) => g.resolutionKind === "pyth" && g.active)
    .map((g) => ({ ...g, feedId: pythFeedForGroup(g) }));

  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  // Parallel prep: view active → readCaseState → (if expired) fetch VAA
  // (oracle mode) or parsed price (admin mode).
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
        if (!Array.isArray(vec) || vec.length === 0) {
          return { groupId: group.groupId, kind: "skip", reason: "no active case" };
        }
        const caseId = BigInt(vec[0] as string);
        const state = await readCaseState(caseId);

        if (state.state === STATE_RESOLVED || state.state === STATE_INVALID) {
          return { groupId: group.groupId, kind: "clear-only", caseId };
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
    outcome?: OutcomeCode;
    resolveHash: string;
    clearHash?: string;
    clearError?: string;
  }> = [];
  const cleared: Array<{ group: string; caseId: string; txnHash: string }> = [];
  const skipped: Array<{ group: string; reason: string }> = [];
  const closeTimes: number[] = [];

  for (const p of preps) {
    if (p.kind === "skip") {
      skipped.push({ group: p.groupId, reason: p.reason });
      if (typeof p.nextCloseTime === "number") closeTimes.push(p.nextCloseTime);
    }
  }

  for (let i = 0; i < payloadMeta.length; i++) {
    const meta = payloadMeta[i];
    const r = results[i];
    if (meta.kind === "oracle-resolve" || meta.kind === "admin-resolve") {
      const resolveMode = meta.kind === "oracle-resolve" ? "oracle" : "admin";
      if (r.success && r.txnHash) {
        const clearMeta = payloadMeta[i + 1];
        const clearResult = results[i + 1];
        const base = {
          group: meta.groupId,
          caseId: meta.caseId.toString(),
          mode: resolveMode as "oracle" | "admin",
          resolveHash: r.txnHash,
          ...(meta.kind === "admin-resolve" ? { outcome: meta.outcome } : {}),
        };
        if (clearMeta?.kind === "clear" && clearResult?.success && clearResult.txnHash) {
          resolved.push({ ...base, clearHash: clearResult.txnHash });
        } else {
          resolved.push({
            ...base,
            clearError: clearResult?.error ?? "clear tx failed",
          });
        }
      } else {
        skipped.push({
          group: meta.groupId,
          reason: `${resolveMode}-resolve failed: ${r.error ?? "unknown"}`,
        });
      }
    } else if (meta.kind === "clear") {
      const prev = payloadMeta[i - 1];
      const isPaired =
        (prev?.kind === "oracle-resolve" || prev?.kind === "admin-resolve") &&
        prev.groupId === meta.groupId;
      if (!isPaired) {
        if (r.success && r.txnHash) {
          cleared.push({
            group: meta.groupId,
            caseId: meta.caseId.toString(),
            txnHash: r.txnHash,
          });
        } else {
          skipped.push({
            group: meta.groupId,
            reason: r.error ?? "clear-only tx failed",
          });
        }
      }
    }
  }

  const nextCloseTime = closeTimes.length ? Math.min(...closeTimes) : null;
  return NextResponse.json({ mode, resolved, cleared, skipped, nextCloseTime });
}
