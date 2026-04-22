// INVARIANT: admin-signing path; never moves user VirtualUSD; only calls
// on-chain `case_vault::admin_resolve`. Runbook: invoke ONLY when Pyth feed
// fails for a specific market — otherwise use the permissionless
// `case_vault::resolve_oracle` path instead.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withAdminAuth } from "@/lib/admin-auth";
import { buildAdminResolveTxn, submitAdminTxn } from "@/lib/aptos";

interface Body {
  caseId?: unknown;
  outcome?: unknown;
}

export const dynamic = "force-dynamic";

export const POST = withAdminAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const caseIdRaw = body.caseId;
  const outcomeRaw = body.outcome;
  if (typeof caseIdRaw !== "number" && typeof caseIdRaw !== "string") {
    return NextResponse.json(
      { error: "caseId required (number or string)" },
      { status: 400 },
    );
  }
  if (typeof outcomeRaw !== "number" || ![0, 1, 2].includes(outcomeRaw)) {
    return NextResponse.json(
      { error: "outcome must be 0 (YES) | 1 (NO) | 2 (INVALID)" },
      { status: 400 },
    );
  }

  const caseId = BigInt(caseIdRaw);
  const outcome = outcomeRaw as 0 | 1 | 2;

  try {
    const { txnHash, success } = await submitAdminTxn(
      buildAdminResolveTxn(caseId, outcome),
    );
    return NextResponse.json({ success, txnHash });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
});
